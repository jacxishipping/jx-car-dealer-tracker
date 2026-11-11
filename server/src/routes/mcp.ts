// MCP endpoint (REST shape over the same tools the frontend documents in
// src/pages/Mcp.tsx): GET /api/mcp/tools lists the 19 tools with input
// schemas; POST /api/mcp/tools/:tool executes one. READ tools need mcp.read,
// WRITE tools need mcp.write plus the underlying permission. Sensitive
// writes (create_purchase, create_sale, record_payment, Paid record_expense)
// require confirm:true, otherwise they return { requiresConfirmation: true,
// preview } and write nothing. Every write is audit-logged.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { roleHasPermission, type Permission } from '../middleware/rbac';
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors';
import { insertAudit } from '../lib/audit';
import { dealProfit } from '../lib/fifo';
import { money, num } from '../lib/money';
import * as m from '../lib/mappers';
import { getOrgSettings, vehicleAllInCostDb, vehicleDirectExpenses, vehiclePartsCost } from '../lib/costing';
import { insertVehicleTx, type VehicleInput } from '../lib/vehicles';
import {
  allocatePartTx, createDealTx, finalizeSaleTx, recordExpenseTx,
  recordPaymentTx, recordPurchaseTx, today,
} from '../lib/services';
import { getDashboardData } from './dashboard';
import type { Role } from '../lib/types';

export const mcpRouter = Router();
mcpRouter.use(authenticate);

interface ToolDef {
  name: string;
  kind: 'READ' | 'WRITE';
  description: string;
  inputSchema: Record<string, unknown>;
  permission: Permission;
  sensitive?: boolean;
}

const S = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const MCP_TOOLS: ToolDef[] = [
  { name: 'get_inventory_summary', kind: 'READ', description: 'Dealership KPIs: stock count, inventory value (all-in cost), acquisition cost, sales revenue, gross/net profit, cash, receivables/payables, counts by status.', inputSchema: S({}), permission: 'mcp.read' },
  { name: 'search_vehicles', kind: 'READ', description: 'Search vehicles by stock number, VIN, make, model or status, with optional status filter.', inputSchema: S({ query: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } }), permission: 'mcp.read' },
  { name: 'get_vehicle_details', kind: 'READ', description: 'Full record for one vehicle: specs, status, purchase, transport orders, expenses, recon jobs, parts allocated, documents.', inputSchema: S({ vehicleId: { type: 'string' }, stockNumber: { type: 'string' } }), permission: 'mcp.read' },
  { name: 'get_vehicle_profit', kind: 'READ', description: 'Profitability for one vehicle: all-in cost breakdown, asking/min price, and (for a deal) gross/net profit and margin.', inputSchema: S({ vehicleId: { type: 'string' }, dealId: { type: 'string' } }, ['vehicleId']), permission: 'mcp.read' },
  { name: 'get_sales_summary', kind: 'READ', description: 'Sales totals for a period: revenue, gross/net profit, margin, deals by status, top vehicles.', inputSchema: S({ from: { type: 'string' }, to: { type: 'string' } }), permission: 'mcp.read' },
  { name: 'get_expenses', kind: 'READ', description: 'Expenses filtered by category, vehicle, kind (Direct/Overhead) or date range.', inputSchema: S({ vehicleId: { type: 'string' }, category: { type: 'string' }, kind: { type: 'string', enum: ['Direct', 'Overhead'] }, from: { type: 'string' }, to: { type: 'string' } }), permission: 'mcp.read' },
  { name: 'get_customer_details', kind: 'READ', description: 'One customer with leads, interactions, offers and deals.', inputSchema: S({ customerId: { type: 'string' } }, ['customerId']), permission: 'mcp.read' },
  { name: 'get_followups', kind: 'READ', description: 'Open leads whose follow-up date is in the past (overdue), oldest first.', inputSchema: S({ salesperson: { type: 'string' } }), permission: 'mcp.read' },
  { name: 'get_account_balances', kind: 'READ', description: 'Per-account balances (opening balance + signed transactions) and total cash.', inputSchema: S({}), permission: 'mcp.read' },
  { name: 'get_low_stock_parts', kind: 'READ', description: 'Parts whose remaining stock (sum of batch qtyRemaining) is at or below minStock.', inputSchema: S({}), permission: 'mcp.read' },
  { name: 'get_aged_inventory', kind: 'READ', description: 'Unsold vehicles held longer than a threshold (default = settings.targetHoldDays, 45).', inputSchema: S({ days: { type: 'number' } }), permission: 'mcp.read' },
  { name: 'create_vehicle', kind: 'WRITE', description: 'Register a vehicle. VIN must be unique per organization — a duplicate VIN is rejected.', inputSchema: S({ stockNumber: { type: 'string' }, vin: { type: 'string' }, year: { type: 'number' }, make: { type: 'string' }, model: { type: 'string' }, purchasePrice: { type: 'number' }, askingPrice: { type: 'number' }, purchaseDate: { type: 'string' }, purchaseSource: { type: 'string' } }, ['vin', 'year', 'make', 'model', 'purchaseDate']), permission: 'vehicle.create' },
  { name: 'record_expense', kind: 'WRITE', description: 'Record a Direct or Overhead expense. A Paid expense also posts a transaction + journal entry (requires confirmation).', inputSchema: S({ description: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, date: { type: 'string' }, vehicleId: { type: ['string', 'null'] }, kind: { type: 'string', enum: ['Direct', 'Overhead'] }, status: { type: 'string', enum: ['Paid', 'Pending'] } }, ['description', 'amount', 'category', 'date', 'kind']), permission: 'expense.create', sensitive: true },
  { name: 'create_customer', kind: 'WRITE', description: 'Create a customer record.', inputSchema: S({ name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, budget: { type: 'number' }, leadSource: { type: 'string' }, salesperson: { type: 'string' } }, ['name']), permission: 'customer.create' },
  { name: 'create_lead', kind: 'WRITE', description: 'Create a lead for an existing customer with a follow-up date.', inputSchema: S({ customerId: { type: 'string' }, stage: { type: 'string' }, followUpDate: { type: 'string' }, notes: { type: 'string' } }, ['customerId', 'followUpDate']), permission: 'lead.create' },
  { name: 'create_purchase', kind: 'WRITE', description: 'Record a vehicle purchase (creates the vehicle + purchase; Paid/Partial also posts transaction, journal entry and a vendor payable). Requires confirmation.', inputSchema: S({ seller: { type: 'string' }, vehiclePrice: { type: 'number' }, buyerFees: { type: 'number' }, auctionFees: { type: 'number' }, taxes: { type: 'number' }, paymentStatus: { type: 'string', enum: ['Paid', 'Partial', 'Unpaid'] }, vehicle: { type: 'object' } }, ['seller', 'vehiclePrice', 'paymentStatus', 'vehicle']), permission: 'purchase.create', sensitive: true },
  { name: 'create_sale', kind: 'WRITE', description: 'Create a deal (Draft) and finalise it: vehicle Sold, sale transaction + journal entry, lead closed, receivable opened for any outstanding balance. Requires confirmation.', inputSchema: S({ vehicleId: { type: 'string' }, customerId: { type: 'string' }, sellingPrice: { type: 'number' }, discount: { type: 'number' }, taxes: { type: 'number' }, fees: { type: 'number' }, deposit: { type: 'number' }, paymentMethod: { type: 'string' } }, ['vehicleId', 'customerId', 'sellingPrice']), permission: 'sale.finalize', sensitive: true },
  { name: 'record_payment', kind: 'WRITE', description: 'Record a payment against a receivable. Amount must be positive and not exceed the outstanding balance. Requires confirmation.', inputSchema: S({ receivableId: { type: 'string' }, amount: { type: 'number' }, accountId: { type: 'string' } }, ['receivableId', 'amount', 'accountId']), permission: 'payment.record', sensitive: true },
  { name: 'allocate_part_to_vehicle', kind: 'WRITE', description: 'Allocate part stock to a vehicle at FIFO cost (oldest batch first). Fails on insufficient stock.', inputSchema: S({ partId: { type: 'string' }, vehicleId: { type: 'string' }, qty: { type: 'number' } }, ['partId', 'vehicleId', 'qty']), permission: 'part.allocate' },
];

mcpRouter.get('/tools', (_req: Request, res: Response) => {
  res.json({
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      kind: t.kind,
      description: t.description,
      inputSchema: t.inputSchema,
      requiresConfirmation: t.sensitive === true,
    })),
  });
});

function requireToolPermission(req: Request, tool: ToolDef): void {
  const role = req.role as Role | undefined;
  if (!role) throw forbidden('Authentication required');
  if (!roleHasPermission(role, 'mcp.read') && !roleHasPermission(role, 'mcp.write')) {
    throw forbidden(`Role ${role} cannot call MCP tools`);
  }
  if (tool.kind === 'READ' && !roleHasPermission(role, 'mcp.read')) {
    throw forbidden(`Role ${role} cannot call READ tools`);
  }
  if (tool.kind === 'WRITE') {
    if (!roleHasPermission(role, 'mcp.write')) {
      throw forbidden(`Role ${role} cannot call WRITE tools`);
    }
    if (!roleHasPermission(role, tool.permission)) {
      throw forbidden(`Role ${role} lacks the ${tool.permission} permission for ${tool.name}`);
    }
  }
}

// --- READ implementations ---------------------------------------------------
async function runReadTool(orgId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case 'get_inventory_summary': {
      const data = await getDashboardData(orgId);
      return data.kpis;
    }
    case 'search_vehicles': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      const status = typeof args.status === 'string' ? args.status : undefined;
      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100);
      const params: unknown[] = [orgId];
      const where = ['organization_id = $1', 'deleted_at IS NULL'];
      if (status) { params.push(status); where.push(`status = $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        const idx = params.length;
        where.push(`(stock_number ILIKE $${idx} OR vin ILIKE $${idx} OR make ILIKE $${idx} OR model ILIKE $${idx})`);
      }
      const res = await query(
        `SELECT * FROM dealer.vehicles WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
        [...params, limit],
      );
      return res.rows.map((r) => {
        const v = m.mapVehicle(r as Record<string, unknown>);
        return {
          id: v.id, stockNumber: v.stockNumber, vin: v.vin, year: v.year, make: v.make,
          model: v.model, status: v.status, askingPrice: v.askingPrice,
          minPrice: v.minPrice, purchaseDate: v.purchaseDate,
        };
      });
    }
    case 'get_vehicle_details': {
      const vehicleId = typeof args.vehicleId === 'string' ? args.vehicleId : undefined;
      const stockNumber = typeof args.stockNumber === 'string' ? args.stockNumber : undefined;
      if (!vehicleId && !stockNumber) throw badRequest('vehicleId or stockNumber is required');
      const res = await query(
        `SELECT * FROM dealer.vehicles WHERE organization_id = $1 AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR id = $2) AND ($3::text IS NULL OR stock_number = $3)`,
        [orgId, vehicleId ?? null, stockNumber ?? null],
      );
      if (res.rows.length === 0) throw notFound('Vehicle not found');
      const vehicle = res.rows[0] as Record<string, unknown>;
      const vid = vehicle.id as string;
      const [transport, expenses, recon, allocations, documents] = await Promise.all([
        query(`SELECT * FROM dealer.transportation_orders WHERE organization_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL`, [orgId, vid]),
        query(`SELECT e.*, u.display_name AS created_by_name FROM dealer.expenses e LEFT JOIN dealer.users u ON u.id = e.created_by WHERE e.organization_id = $1 AND e.vehicle_id = $2 AND e.deleted_at IS NULL`, [orgId, vid]),
        query(`SELECT r.*, ec.name AS category_name FROM dealer.reconditioning_jobs r LEFT JOIN dealer.expense_categories ec ON ec.id = r.category_id WHERE r.organization_id = $1 AND r.vehicle_id = $2 AND r.deleted_at IS NULL`, [orgId, vid]),
        query(`SELECT * FROM dealer.part_allocations WHERE organization_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL`, [orgId, vid]),
        query(`SELECT * FROM dealer.documents WHERE organization_id = $1 AND entity_type = 'Vehicle' AND entity_id = $2 AND deleted_at IS NULL`, [orgId, vid]),
      ]);
      const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));
      const allIn = await withTransaction(async (client) =>
        vehicleAllInCostDb(client, orgId, vid, {
          purchasePrice: num(vehicle.purchase_price),
          auctionFees: num(vehicle.auction_fees),
          transportCost: num(vehicle.transport_cost),
        }, settings.overheadPerVehicle),
      );
      return {
        vehicle: m.mapVehicle(vehicle),
        allInCost: allIn,
        transport: transport.rows.map((r) => m.mapTransport(r as Record<string, unknown>)),
        expenses: expenses.rows.map((r) => m.mapExpense(r as Record<string, unknown>)),
        reconJobs: recon.rows.map((r) => m.mapRecon(r as Record<string, unknown>)),
        partAllocations: allocations.rows.map((r) => m.mapPartAllocation(r as Record<string, unknown>)),
        documents: documents.rows.map((r) => m.mapDocument(r as Record<string, unknown>)),
      };
    }
    case 'get_vehicle_profit': {
      const vehicleId = args.vehicleId as string | undefined;
      if (!vehicleId) throw badRequest('vehicleId is required');
      const vRes = await query(
        `SELECT * FROM dealer.vehicles WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [orgId, vehicleId],
      );
      if (vRes.rows.length === 0) throw notFound('Vehicle not found');
      const vehicle = vRes.rows[0] as Record<string, unknown>;
      const breakdown = await withTransaction(async (client) => {
        const settings = await getOrgSettings(client, orgId);
        const direct = await vehicleDirectExpenses(client, orgId, vehicleId);
        const parts = await vehiclePartsCost(client, orgId, vehicleId);
        const allIn = await vehicleAllInCostDb(client, orgId, vehicleId, {
          purchasePrice: num(vehicle.purchase_price),
          auctionFees: num(vehicle.auction_fees),
          transportCost: num(vehicle.transport_cost),
        }, settings.overheadPerVehicle);
        return { direct, parts, overhead: settings.overheadPerVehicle, allIn };
      });
      const out: Record<string, unknown> = {
        vehicleId,
        purchasePrice: num(vehicle.purchase_price),
        auctionFees: num(vehicle.auction_fees),
        transportCost: num(vehicle.transport_cost),
        directExpenses: breakdown.direct,
        partsCost: breakdown.parts,
        overhead: breakdown.overhead,
        allInCost: breakdown.allIn,
        askingPrice: num(vehicle.asking_price),
        minPrice: num(vehicle.min_price),
      };
      if (typeof args.dealId === 'string') {
        const dRes = await query(
          `SELECT * FROM dealer.deals WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [orgId, args.dealId],
        );
        if (dRes.rows.length === 0) throw notFound('Deal not found');
        const deal = dRes.rows[0] as Record<string, unknown>;
        out.deal = m.mapDeal(deal);
        out.profit = dealProfit({
          sellingPrice: num(deal.selling_price),
          discount: num(deal.discount),
          taxes: num(deal.taxes),
          fees: num(deal.fees),
        }, breakdown.allIn);
      }
      return out;
    }
    case 'get_sales_summary': {
      const params: unknown[] = [orgId];
      const clauses: string[] = ['organization_id = $1', 'deleted_at IS NULL'];
      if (typeof args.from === 'string') { params.push(args.from); clauses.push(`date >= $${params.length}`); }
      if (typeof args.to === 'string') { params.push(args.to); clauses.push(`date <= $${params.length}`); }
      const res = await query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(selling_price), 0) AS revenue,
                COALESCE(SUM(gross_profit), 0) AS gross_profit,
                COALESCE(SUM(net_profit), 0) AS net_profit
           FROM dealer.sales WHERE ${clauses.join(' AND ')}`,
        params,
      );
      const row = res.rows[0];
      const deals = await query(
        `SELECT status, COUNT(*)::int AS count FROM dealer.deals
          WHERE organization_id = $1 AND deleted_at IS NULL GROUP BY status`,
        [orgId],
      );
      const revenue = num(row.revenue);
      const netProfit = num(row.net_profit);
      return {
        sales: Number(row.count),
        revenue: money(revenue),
        grossProfit: money(num(row.gross_profit)),
        netProfit: money(netProfit),
        marginPct: revenue > 0 ? money((netProfit / revenue) * 100) : 0,
        dealsByStatus: deals.rows,
      };
    }
    case 'get_expenses': {
      const params: unknown[] = [orgId];
      const clauses: string[] = ['e.organization_id = $1', 'e.deleted_at IS NULL'];
      if (typeof args.vehicleId === 'string') { params.push(args.vehicleId); clauses.push(`e.vehicle_id = $${params.length}`); }
      if (typeof args.category === 'string') { params.push(args.category); clauses.push(`e.category_name = $${params.length}`); }
      if (typeof args.kind === 'string') { params.push(args.kind); clauses.push(`e.kind = $${params.length}`); }
      if (typeof args.from === 'string') { params.push(args.from); clauses.push(`e.date >= $${params.length}`); }
      if (typeof args.to === 'string') { params.push(args.to); clauses.push(`e.date <= $${params.length}`); }
      const res = await query(
        `SELECT e.*, u.display_name AS created_by_name FROM dealer.expenses e
          LEFT JOIN dealer.users u ON u.id = e.created_by
          WHERE ${clauses.join(' AND ')} ORDER BY e.date DESC`,
        params,
      );
      const expenses = res.rows.map((r) => m.mapExpense(r as Record<string, unknown>));
      return { expenses, total: money(expenses.reduce((s, e) => s + (e.amount as number), 0)) };
    }
    case 'get_customer_details': {
      const customerId = args.customerId as string | undefined;
      if (!customerId) throw badRequest('customerId is required');
      const cRes = await query(
        `SELECT * FROM dealer.customers WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [orgId, customerId],
      );
      if (cRes.rows.length === 0) throw notFound('Customer not found');
      const [leads, interactions, offers, deals] = await Promise.all([
        query(`SELECT * FROM dealer.leads WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL`, [orgId, customerId]),
        query(`SELECT * FROM dealer.customer_interactions WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL ORDER BY date DESC`, [orgId, customerId]),
        query(`SELECT * FROM dealer.offers WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL`, [orgId, customerId]),
        query(`SELECT d.*, s.ref AS sale_ref FROM dealer.deals d LEFT JOIN dealer.sales s ON s.id = d.sale_id WHERE d.organization_id = $1 AND d.customer_id = $2 AND d.deleted_at IS NULL`, [orgId, customerId]),
      ]);
      return {
        customer: m.mapCustomer(cRes.rows[0] as Record<string, unknown>),
        leads: leads.rows.map((r) => m.mapLead(r as Record<string, unknown>)),
        interactions: interactions.rows.map((r) => m.mapInteraction(r as Record<string, unknown>)),
        offers: offers.rows.map((r) => m.mapOffer(r as Record<string, unknown>)),
        deals: deals.rows.map((r) => m.mapDeal(r as Record<string, unknown>)),
      };
    }
    case 'get_followups': {
      const params: unknown[] = [orgId];
      let salespersonFilter = '';
      if (typeof args.salesperson === 'string') {
        params.push(args.salesperson);
        salespersonFilter = ` AND c.salesperson = $${params.length}`;
      }
      const res = await query(
        `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone
           FROM dealer.leads l JOIN dealer.customers c ON c.id = l.customer_id
          WHERE l.organization_id = $1 AND l.stage NOT IN ('Sold', 'Lost')
            AND l.follow_up_date < CURRENT_DATE AND l.deleted_at IS NULL ${salespersonFilter}
          ORDER BY l.follow_up_date ASC`,
        params,
      );
      return res.rows.map((r) => ({
        lead: m.mapLead(r as Record<string, unknown>),
        customer: { id: r.customer_id, name: r.customer_name, phone: r.customer_phone },
      }));
    }
    case 'get_account_balances': {
      const res = await query(
        `SELECT a.id, a.name, a.type, a.currency, a.opening_balance, a.status,
                COALESCE(SUM(t.amount), 0) AS txns
           FROM dealer.accounts a
           LEFT JOIN dealer.financial_transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
          WHERE a.organization_id = $1 AND a.deleted_at IS NULL
          GROUP BY a.id, a.name, a.type, a.currency, a.opening_balance, a.status
          ORDER BY a.created_at ASC`,
        [orgId],
      );
      const accounts = res.rows.map((r) => ({
        ...m.mapAccount(r as Record<string, unknown>),
        balance: money(num(r.opening_balance) + num(r.txns)),
      }));
      return {
        accounts,
        totalCash: money(accounts.reduce((s, a) => s + (a.balance as number), 0)),
      };
    }
    case 'get_low_stock_parts': {
      const res = await query(
        `SELECT p.*, COALESCE(SUM(b.qty_remaining), 0) AS stock
           FROM dealer.parts p
           LEFT JOIN dealer.part_batches b ON b.part_id = p.id AND b.deleted_at IS NULL
          WHERE p.organization_id = $1 AND p.deleted_at IS NULL
          GROUP BY p.id
          HAVING COALESCE(SUM(b.qty_remaining), 0) <= p.min_stock
          ORDER BY p.name ASC`,
        [orgId],
      );
      return res.rows.map((r) => ({
        ...m.mapPart(r as Record<string, unknown>),
        stock: Number(r.stock),
      }));
    }
    case 'get_aged_inventory': {
      const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));
      const days = typeof args.days === 'number' && args.days >= 0 ? Math.floor(args.days) : settings.targetHoldDays;
      const res = await query(
        `SELECT * FROM dealer.vehicles
          WHERE organization_id = $1 AND status <> 'Sold' AND deleted_at IS NULL
            AND purchase_date < CURRENT_DATE - ($2::int * INTERVAL '1 day')
          ORDER BY purchase_date ASC`,
        [orgId, days],
      );
      const now = new Date();
      return res.rows.map((r) => {
        const v = m.mapVehicle(r as Record<string, unknown>);
        const purchaseDate = r.purchase_date instanceof Date ? (r.purchase_date as Date) : new Date(String(r.purchase_date));
        return {
          ...v,
          daysInStock: Math.max(0, Math.floor((now.getTime() - purchaseDate.getTime()) / 86400000)),
        };
      });
    }
    default:
      throw notFound(`Unknown tool "${tool}"`);
  }
}

// --- WRITE previews + execution ---------------------------------------------
async function salePreview(orgId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const vehicleId = args.vehicleId as string;
  const customerId = args.customerId as string;
  const vRes = await query(
    `SELECT * FROM dealer.vehicles WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, vehicleId],
  );
  if (vRes.rows.length === 0) throw notFound('Vehicle not found');
  const vehicle = vRes.rows[0] as Record<string, unknown>;
  if (vehicle.status === 'Sold') throw badRequest(`Vehicle ${vehicle.stock_number as string} is already sold.`);
  if (vehicle.status !== 'Available' && vehicle.status !== 'Reserved') {
    throw badRequest(`Vehicle ${vehicle.stock_number as string} is ${vehicle.status as string} — only Available or Reserved vehicles can be sold.`);
  }
  const cRes = await query(
    `SELECT * FROM dealer.customers WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, customerId],
  );
  if (cRes.rows.length === 0) throw notFound('Customer not found');
  const totalCost = await withTransaction(async (client) => {
    const settings = await getOrgSettings(client, orgId);
    return vehicleAllInCostDb(client, orgId, vehicleId, {
      purchasePrice: num(vehicle.purchase_price),
      auctionFees: num(vehicle.auction_fees),
      transportCost: num(vehicle.transport_cost),
    }, settings.overheadPerVehicle);
  });
  const profit = dealProfit({
    sellingPrice: num(args.sellingPrice),
    discount: num(args.discount ?? 0),
    taxes: num(args.taxes ?? 0),
    fees: num(args.fees ?? 0),
  }, totalCost);
  const netSelling = money(num(args.sellingPrice) - num(args.discount ?? 0));
  return {
    vehicle: m.mapVehicle(vehicle),
    customer: m.mapCustomer(cRes.rows[0] as Record<string, unknown>),
    totalCost,
    netSelling,
    profit,
    outstanding: money(netSelling - num(args.deposit ?? 0)),
  };
}

async function runWriteTool(
  orgId: string,
  user: { id: string; displayName: string },
  tool: string,
  args: Record<string, unknown>,
  confirm: boolean,
): Promise<unknown> {
  switch (tool) {
    case 'create_vehicle': {
      const row = await withTransaction(async (client) => {
        const created = await insertVehicleTx(client, orgId, args as unknown as VehicleInput);
        await insertAudit(client, {
          orgId, actorId: user.id, actorName: user.displayName,
          action: 'VEHICLE_CREATED', entityType: 'Vehicle', entityId: created.id as string,
          summary: `Vehicle ${created.stock_number as string} registered via MCP.`,
        });
        return created;
      });
      return { vehicle: m.mapVehicle(row) };
    }
    case 'record_expense': {
      const status = (args.status as string | undefined) ?? 'Pending';
      if (status === 'Paid' && !confirm) {
        return {
          requiresConfirmation: true,
          preview: {
            description: args.description,
            amount: money(num(args.amount)),
            category: args.category,
            note: 'A Paid expense moves money (transaction + journal entry). Confirm to record it.',
          },
        };
      }
      const row = await withTransaction(async (client) =>
        recordExpenseTx(client, orgId, {
          description: String(args.description),
          amount: num(args.amount),
          category: String(args.category),
          date: String(args.date),
          vendor: (args.vendor as string | undefined) ?? '',
          vehicleId: (args.vehicleId as string | null | undefined) ?? null,
          kind: (args.kind as 'Direct' | 'Overhead') ?? 'Direct',
          paymentMethod: (args.paymentMethod as string | undefined) ?? '',
          status: status as 'Paid' | 'Pending',
          invoiceRef: (args.invoiceRef as string | undefined) ?? '',
          notes: 'Recorded via MCP.',
        }, user as never),
      );
      return { expense: m.mapExpense(row) };
    }
    case 'create_customer': {
      const row = await withTransaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO dealer.customers
             (organization_id, name, phone, email, budget, lead_source, salesperson, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'') RETURNING *`,
          [
            orgId,
            String(args.name),
            (args.phone as string | undefined) ?? '',
            (args.email as string | undefined) ?? '',
            money(num(args.budget ?? 0)),
            (args.leadSource as string | undefined) ?? '',
            (args.salesperson as string | undefined) ?? '',
          ],
        );
        await insertAudit(client, {
          orgId, actorId: user.id, actorName: user.displayName,
          action: 'CUSTOMER_CREATED', entityType: 'Customer',
          entityId: inserted.rows[0].id as string,
          summary: `Customer ${String(args.name)} created via MCP.`,
        });
        return inserted.rows[0] as Record<string, unknown>;
      });
      return { customer: m.mapCustomer(row) };
    }
    case 'create_lead': {
      const row = await withTransaction(async (client) => {
        const customer = await client.query(
          `SELECT id FROM dealer.customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [args.customerId, orgId],
        );
        if (customer.rows.length === 0) throw notFound('Customer not found');
        const inserted = await client.query(
          `INSERT INTO dealer.leads (organization_id, customer_id, stage, follow_up_date, notes)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [
            orgId,
            args.customerId,
            (args.stage as string | undefined) ?? 'New Lead',
            args.followUpDate,
            (args.notes as string | undefined) ?? '',
          ],
        );
        await insertAudit(client, {
          orgId, actorId: user.id, actorName: user.displayName,
          action: 'LEAD_CREATED', entityType: 'Lead',
          entityId: inserted.rows[0].id as string,
          summary: `Lead created for customer ${String(args.customerId)} via MCP.`,
        });
        return inserted.rows[0] as Record<string, unknown>;
      });
      return { lead: m.mapLead(row) };
    }
    case 'create_purchase': {
      if (!confirm) {
        const total = money(
          num(args.vehiclePrice) + num(args.buyerFees ?? 0) + num(args.auctionFees ?? 0) + num(args.taxes ?? 0),
        );
        const paymentStatus = String(args.paymentStatus);
        const paid = paymentStatus === 'Paid' ? total : paymentStatus === 'Partial' ? money(total / 2) : 0;
        const vehicle = (args.vehicle ?? {}) as Record<string, unknown>;
        if (typeof vehicle.vin === 'string') {
          const dup = await query(
            `SELECT stock_number FROM dealer.vehicles
              WHERE organization_id = $1 AND upper(vin) = upper($2) AND deleted_at IS NULL`,
            [orgId, vehicle.vin],
          );
          if (dup.rows.length > 0) {
            throw new ApiError(409, `A vehicle with VIN ${vehicle.vin as string} already exists.`, 'DUPLICATE_VIN');
          }
        }
        return {
          requiresConfirmation: true,
          preview: { total, paid, outstanding: money(total - paid), paymentStatus, vehicle },
        };
      }
      const result = await withTransaction(async (client) =>
        recordPurchaseTx(client, orgId, {
          seller: String(args.seller),
          auction: (args.auction as string | undefined) ?? '',
          purchaseDate: String(args.purchaseDate ?? today()),
          vehiclePrice: num(args.vehiclePrice),
          buyerFees: num(args.buyerFees ?? 0),
          auctionFees: num(args.auctionFees ?? 0),
          taxes: num(args.taxes ?? 0),
          transportEstimate: num(args.transportEstimate ?? 0),
          paymentMethod: (args.paymentMethod as string | undefined) ?? '',
          paymentStatus: args.paymentStatus as 'Paid' | 'Partial' | 'Unpaid',
          documents: (args.documents as string | undefined) ?? '',
          vehicle: args.vehicle as never,
        }, user as never),
      );
      return { purchase: m.mapPurchase(result.purchase), vehicle: m.mapVehicle(result.vehicle) };
    }
    case 'create_sale': {
      if (!confirm) {
        const preview = await salePreview(orgId, args);
        return { requiresConfirmation: true, preview };
      }
      const { deal, sale } = await withTransaction(async (client) => {
        const createdDeal = await createDealTx(client, orgId, {
          vehicleId: String(args.vehicleId),
          customerId: String(args.customerId),
          salesperson: (args.salesperson as string | undefined) ?? '',
          sellingPrice: num(args.sellingPrice),
          discount: num(args.discount ?? 0),
          taxes: num(args.taxes ?? 0),
          fees: num(args.fees ?? 0),
          deposit: num(args.deposit ?? 0),
          tradeInValue: num(args.tradeInValue ?? 0),
          tradeInDesc: (args.tradeInDesc as string | undefined) ?? '',
          paymentMethod: String(args.paymentMethod ?? ''),
        }, user as never);
        const finalized = await finalizeSaleTx(client, orgId, createdDeal.id as string, user as never);
        return { deal: createdDeal, sale: finalized.sale };
      });
      return { deal: m.mapDeal(deal), sale: m.mapSale(sale) };
    }
    case 'record_payment': {
      const receivableId = String(args.receivableId);
      const amount = money(num(args.amount));
      const recRes = await query(
        `SELECT * FROM dealer.receivables WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [orgId, receivableId],
      );
      if (recRes.rows.length === 0) throw notFound('Receivable not found');
      const rec = recRes.rows[0] as Record<string, unknown>;
      const outstanding = money(num(rec.total) - num(rec.paid));
      if (amount <= 0) throw badRequest('Amount must be positive.');
      if (amount > outstanding) throw badRequest(`Amount exceeds the outstanding balance of $${outstanding}.`);
      if (!confirm) {
        return {
          requiresConfirmation: true,
          preview: {
            receivable: m.mapReceivable(rec),
            amount,
            outstanding,
            remainingAfter: money(outstanding - amount),
          },
        };
      }
      const { receivable } = await withTransaction(async (client) =>
        recordPaymentTx(client, orgId, receivableId, amount, String(args.accountId), user as never),
      );
      return { receivable: m.mapReceivable(receivable) };
    }
    case 'allocate_part_to_vehicle': {
      const result = await withTransaction(async (client) =>
        allocatePartTx(client, orgId, String(args.partId), String(args.vehicleId), Number(args.qty), user as never),
      );
      return {
        allocation: m.mapPartAllocation({ ...result.allocation, batches: result.slices }),
        slices: result.slices,
        fifoCost: result.fifoCost,
      };
    }
    default:
      throw notFound(`Unknown tool "${tool}"`);
  }
}

const callSchema = z.object({
  arguments: z.record(z.unknown()).default({}),
  confirm: z.boolean().optional(),
});

mcpRouter.post(
  '/tools/:tool',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const toolName = req.params.tool;
      const tool = MCP_TOOLS.find((t) => t.name === toolName);
      if (!tool) throw notFound(`Unknown MCP tool "${toolName}"`);
      requireToolPermission(req, tool);
      const parsed = callSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest('Invalid MCP call body: expected { arguments, confirm? }');
      const args = parsed.data.arguments as Record<string, unknown>;
      const confirm = parsed.data.confirm === true;
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const result =
        tool.kind === 'READ'
          ? await runReadTool(orgId, toolName, args)
          : await runWriteTool(orgId, user, toolName, args, confirm);
      res.json({ tool: toolName, result });
    } catch (err) {
      next(err);
    }
  },
);
