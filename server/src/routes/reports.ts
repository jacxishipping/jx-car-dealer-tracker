// GET /api/reports/:name — one report per name, each returning
// { rows, summary }. Optional ?from=&to= (YYYY-MM-DD) filters date fields
// where the report has one.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { authenticate, requireOrgId } from '../middleware/auth';
import { validateQuery, dateRangeSchema } from '../middleware/validate';
import { badRequest } from '../lib/errors';
import { money, num } from '../lib/money';
import { getOrgSettings } from '../lib/costing';
import { withTransaction } from '../db';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const REPORT_NAMES = [
  'inventory', 'sales', 'profitability', 'expenses', 'recon', 'parts-valuation',
  'fifo', 'cashflow', 'balances', 'receivables', 'payables', 'pl', 'aging',
  'crm', 'salesperson',
] as const;

type ReportName = (typeof REPORT_NAMES)[number];

const reportQuerySchema = dateRangeSchema.extend({
  q: z.string().optional(),
});

interface Ctx {
  orgId: string;
  from?: string;
  to?: string;
}

function dateFilter(ctx: Ctx, column: string, params: unknown[]): string {
  const clauses: string[] = [];
  if (ctx.from) {
    params.push(ctx.from);
    clauses.push(`${column} >= $${params.length}`);
  }
  if (ctx.to) {
    params.push(ctx.to);
    clauses.push(`${column} <= $${params.length}`);
  }
  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
}

async function reportInventory(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const settings = await withTransaction(async (client) => getOrgSettings(client, ctx.orgId));
  const vehicles = await query(
    `SELECT id, stock_number, vin, year, make, model, status, purchase_date,
            purchase_price, auction_fees, transport_cost, asking_price, min_price
       FROM dealer.vehicles WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY purchase_date ASC`,
    [ctx.orgId],
  );
  const direct = await query(
    `SELECT vehicle_id, COALESCE(SUM(amount), 0) AS total FROM dealer.expenses
      WHERE organization_id = $1 AND kind = 'Direct' AND vehicle_id IS NOT NULL AND deleted_at IS NULL GROUP BY vehicle_id`,
    [ctx.orgId],
  );
  const parts = await query(
    `SELECT vehicle_id, COALESCE(SUM(fifo_cost), 0) AS total FROM dealer.part_allocations
      WHERE organization_id = $1 AND deleted_at IS NULL GROUP BY vehicle_id`,
    [ctx.orgId],
  );
  const directMap = new Map(direct.rows.map((r) => [r.vehicle_id as string, num(r.total)]));
  const partsMap = new Map(parts.rows.map((r) => [r.vehicle_id as string, num(r.total)]));
  const now = new Date();
  const rows = vehicles.rows.map((v) => {
    const allIn = money(
      num(v.purchase_price) + num(v.auction_fees) + num(v.transport_cost) +
        (directMap.get(v.id as string) ?? 0) + (partsMap.get(v.id as string) ?? 0) +
        settings.overheadPerVehicle,
    );
    const purchaseDate = v.purchase_date instanceof Date ? (v.purchase_date as Date) : new Date(String(v.purchase_date));
    const daysInStock = Math.max(0, Math.floor((now.getTime() - purchaseDate.getTime()) / 86400000));
    return {
      id: v.id, stockNumber: v.stock_number, vin: v.vin,
      vehicle: `${v.year as number} ${v.make as string} ${v.model as string}`,
      status: v.status,
      purchaseDate: purchaseDate.toISOString().slice(0, 10),
      daysInStock,
      purchasePrice: num(v.purchase_price),
      allInCost: allIn,
      askingPrice: num(v.asking_price),
      minPrice: num(v.min_price),
      potentialProfit: money(num(v.asking_price) - allIn),
    };
  });
  return {
    rows,
    summary: {
      vehicles: rows.length,
      inventoryValue: money(rows.filter((r) => r.status !== 'Sold').reduce((s, r) => s + (r.allInCost as number), 0)),
      totalPotentialProfit: money(rows.reduce((s, r) => s + (r.potentialProfit as number), 0)),
    },
  };
}

async function reportSales(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const params: unknown[] = [ctx.orgId];
  const filter = dateFilter(ctx, 's.date', params);
  const res = await query(
    `SELECT s.*, v.stock_number, v.year, v.make, v.model, c.name AS customer_name
       FROM dealer.sales s
       JOIN dealer.vehicles v ON v.id = s.vehicle_id
       JOIN dealer.customers c ON c.id = s.customer_id
      WHERE s.organization_id = $1 AND s.deleted_at IS NULL ${filter}
      ORDER BY s.date DESC`,
    params,
  );
  const rows = res.rows.map((r) => ({
    id: r.id, ref: r.ref, date: (r.date as Date).toISOString().slice(0, 10),
    vehicle: `${r.stock_number as string} — ${r.year as number} ${r.make as string} ${r.model as string}`,
    customer: r.customer_name,
    sellingPrice: num(r.selling_price), totalCost: num(r.total_cost),
    grossProfit: num(r.gross_profit), netProfit: num(r.net_profit), marginPct: num(r.margin_pct),
  }));
  return {
    rows,
    summary: {
      sales: rows.length,
      revenue: money(rows.reduce((s, r) => s + (r.sellingPrice as number), 0)),
      grossProfit: money(rows.reduce((s, r) => s + (r.grossProfit as number), 0)),
      netProfit: money(rows.reduce((s, r) => s + (r.netProfit as number), 0)),
    },
  };
}

async function reportProfitability(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const sales = await reportSales(ctx);
  const rows = (sales.rows as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    roiPct:
      (r.totalCost as number) > 0
        ? money(((r.netProfit as number) / (r.totalCost as number)) * 100)
        : 0,
  }));
  return { rows, summary: sales.summary };
}

async function reportExpenses(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const params: unknown[] = [ctx.orgId];
  const filter = dateFilter(ctx, 'e.date', params);
  const res = await query(
    `SELECT e.*, v.stock_number FROM dealer.expenses e
      LEFT JOIN dealer.vehicles v ON v.id = e.vehicle_id
      WHERE e.organization_id = $1 AND e.deleted_at IS NULL ${filter}
      ORDER BY e.date DESC`,
    params,
  );
  const rows = res.rows.map((r) => ({
    id: r.id,
    date: (r.date as Date).toISOString().slice(0, 10),
    description: r.description, category: r.category_name, kind: r.kind,
    vehicle: (r.stock_number as string) ?? null, vendor: r.vendor_name,
    amount: num(r.amount), status: r.status,
  }));
  const direct = money(rows.filter((r) => r.kind === 'Direct').reduce((s, r) => s + (r.amount as number), 0));
  const overhead = money(rows.filter((r) => r.kind === 'Overhead').reduce((s, r) => s + (r.amount as number), 0));
  return { rows, summary: { expenses: rows.length, direct, overhead, total: money(direct + overhead) } };
}

async function reportRecon(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const res = await query(
    `SELECT r.*, v.stock_number, ec.name AS category_name FROM dealer.reconditioning_jobs r
      JOIN dealer.vehicles v ON v.id = r.vehicle_id
      LEFT JOIN dealer.expense_categories ec ON ec.id = r.category_id
      WHERE r.organization_id = $1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC`,
    [ctx.orgId],
  );
  const rows = res.rows.map((r) => ({
    id: r.id, vehicle: r.stock_number, title: r.title,
    category: (r.category_name as string) ?? '', status: r.status,
    technician: r.technician,
    estimatedCost: num(r.estimated_cost), actualCost: num(r.actual_cost),
    startedAt: r.started_at ? (r.started_at as Date).toISOString().slice(0, 10) : null,
    completedAt: r.completed_at ? (r.completed_at as Date).toISOString().slice(0, 10) : null,
  }));
  return {
    rows,
    summary: {
      jobs: rows.length,
      open: rows.filter((r) => r.status !== 'Done').length,
      estimatedTotal: money(rows.reduce((s, r) => s + (r.estimatedCost as number), 0)),
      actualTotal: money(rows.reduce((s, r) => s + (r.actualCost as number), 0)),
    },
  };
}

async function reportPartsValuation(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const res = await query(
    `SELECT p.id, p.sku, p.name, p.min_stock,
            COALESCE(SUM(b.qty_remaining), 0) AS stock,
            COALESCE(SUM(b.qty_remaining * b.unit_price), 0) AS value
       FROM dealer.parts p
       LEFT JOIN dealer.part_batches b
         ON b.part_id = p.id AND b.deleted_at IS NULL
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL
      GROUP BY p.id, p.sku, p.name, p.min_stock ORDER BY p.name ASC`,
    [ctx.orgId],
  );
  const rows = res.rows.map((r) => ({
    id: r.id, sku: r.sku, name: r.name, minStock: Number(r.min_stock),
    stock: Number(r.stock), value: money(num(r.value)),
    lowStock: Number(r.stock) <= Number(r.min_stock),
  }));
  return {
    rows,
    summary: {
      parts: rows.length,
      totalValue: money(rows.reduce((s, r) => s + (r.value as number), 0)),
      lowStockCount: rows.filter((r) => r.lowStock).length,
    },
  };
}

async function reportFifo(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const res = await query(
    `SELECT b.*, p.sku, p.name FROM dealer.part_batches b
      JOIN dealer.parts p ON p.id = b.part_id
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL
      ORDER BY b.purchase_date ASC`,
    [ctx.orgId],
  );
  const rows = res.rows.map((r) => ({
    id: r.id, part: `${r.sku as string} — ${r.name as string}`,
    purchaseDate: (r.purchase_date as Date).toISOString().slice(0, 10),
    qtyReceived: Number(r.qty_received), qtyRemaining: Number(r.qty_remaining),
    unitPrice: num(r.unit_price), remainingValue: money(Number(r.qty_remaining) * num(r.unit_price)),
    invoice: r.invoice,
  }));
  return {
    rows,
    summary: {
      batches: rows.length,
      remainingValue: money(rows.reduce((s, r) => s + (r.remainingValue as number), 0)),
    },
  };
}

async function reportCashflow(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const params: unknown[] = [ctx.orgId];
  const filter = dateFilter(ctx, 'date', params);
  const res = await query(
    `SELECT * FROM dealer.financial_transactions
      WHERE organization_id = $1 AND deleted_at IS NULL ${filter} ORDER BY date DESC`,
    params,
  );
  const rows = res.rows.map((r) => ({
    id: r.id, date: (r.date as Date).toISOString().slice(0, 10),
    type: r.type, category: r.category, reference: r.reference,
    amount: num(r.amount), note: r.note,
  }));
  const inflow = money(rows.filter((r) => (r.amount as number) > 0).reduce((s, r) => s + (r.amount as number), 0));
  const outflow = money(rows.filter((r) => (r.amount as number) < 0).reduce((s, r) => s + (r.amount as number), 0));
  return { rows, summary: { transactions: rows.length, inflow, outflow, net: money(inflow + outflow) } };
}

async function reportBalances(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const res = await query(
    `SELECT a.id, a.name, a.type, a.currency, a.opening_balance, a.status,
            COALESCE(SUM(t.amount), 0) AS txns
       FROM dealer.accounts a
       LEFT JOIN dealer.financial_transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
      WHERE a.organization_id = $1 AND a.deleted_at IS NULL
      GROUP BY a.id, a.name, a.type, a.currency, a.opening_balance, a.status
      ORDER BY a.created_at ASC`,
    [ctx.orgId],
  );
  const rows = res.rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, currency: r.currency,
    openingBalance: num(r.opening_balance),
    balance: money(num(r.opening_balance) + num(r.txns)),
    status: r.status,
  }));
  return {
    rows,
    summary: { accounts: rows.length, totalCash: money(rows.reduce((s, r) => s + (r.balance as number), 0)) },
  };
}

async function reportReceivables(ctx: Ctx, kind: 'Customer' | 'Vendor' | 'Carrier' | null): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const params: unknown[] = [ctx.orgId];
  let kindFilter = '';
  if (kind) {
    params.push(kind);
    kindFilter = ` AND kind = $${params.length}`;
  } else if (kind === null) {
    kindFilter = ` AND kind <> 'Customer'`;
  }
  const res = await query(
    `SELECT * FROM dealer.receivables
      WHERE organization_id = $1 AND deleted_at IS NULL ${kindFilter} ORDER BY due_date ASC`,
    params,
  );
  const rows = res.rows.map((r) => ({
    id: r.id, kind: r.kind, entityName: r.entity_name, reference: r.reference,
    total: num(r.total), paid: num(r.paid),
    outstanding: money(num(r.total) - num(r.paid)),
    dueDate: (r.due_date as Date).toISOString().slice(0, 10), status: r.status,
  }));
  return {
    rows,
    summary: {
      count: rows.length,
      totalOutstanding: money(rows.reduce((s, r) => s + (r.outstanding as number), 0)),
    },
  };
}

async function reportPl(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const sales = await reportSales(ctx);
  const expenses = await reportExpenses(ctx);
  const revenue = Number(sales.summary.revenue ?? 0);
  const cogs = money(
    (sales.rows as Array<Record<string, unknown>>).reduce((s, r) => s + num(r.totalCost), 0),
  );
  const gross = money(revenue - cogs);
  const overhead = Number(expenses.summary.overhead ?? 0);
  const net = money(gross - overhead);
  return {
    rows: [
      { line: 'Sales revenue', amount: revenue },
      { line: 'Cost of goods sold', amount: -cogs },
      { line: 'Gross profit', amount: gross },
      { line: 'Overhead expenses', amount: -overhead },
      { line: 'Net profit', amount: net },
    ],
    summary: { revenue, cogs, grossProfit: gross, overhead, netProfit: net },
  };
}

async function reportAging(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const base = await reportReceivables(ctx, 'Customer');
  const now = new Date();
  const rows: Array<Record<string, unknown>> = (base.rows as Array<Record<string, unknown>>).map((r) => {
    const due = new Date(r.dueDate as string);
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
    const bucket =
      (r.status as string) === 'Paid' ? 'paid'
      : daysOverdue === 0 ? 'current'
      : daysOverdue <= 30 ? '1-30 days'
      : daysOverdue <= 60 ? '31-60 days'
      : daysOverdue <= 90 ? '61-90 days' : '90+ days';
    return { ...r, daysOverdue, bucket };
  });
  const bucketTotal = (b: string): number =>
    money(rows.filter((r) => r.bucket === b).reduce((s, r) => s + (r.outstanding as number), 0));
  return {
    rows,
    summary: {
      current: bucketTotal('current'),
      '1-30 days': bucketTotal('1-30 days'),
      '31-60 days': bucketTotal('31-60 days'),
      '61-90 days': bucketTotal('61-90 days'),
      '90+ days': bucketTotal('90+ days'),
      totalOutstanding: Number(base.summary.totalOutstanding ?? 0),
    },
  };
}

async function reportCrm(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const res = await query(
    `SELECT c.id, c.name, c.email, c.phone, c.budget, c.lead_source, c.salesperson,
            COUNT(DISTINCT l.id) AS leads,
            COUNT(DISTINCT d.id) AS deals,
            COUNT(DISTINCT s.id) AS sales
       FROM dealer.customers c
       LEFT JOIN dealer.leads l ON l.customer_id = c.id AND l.deleted_at IS NULL
       LEFT JOIN dealer.deals d ON d.customer_id = c.id AND d.deleted_at IS NULL
       LEFT JOIN dealer.sales s ON s.customer_id = c.id AND s.deleted_at IS NULL
      WHERE c.organization_id = $1 AND c.deleted_at IS NULL
      GROUP BY c.id, c.name, c.email, c.phone, c.budget, c.lead_source, c.salesperson
      ORDER BY c.name ASC`,
    [ctx.orgId],
  );
  const rows = res.rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone,
    budget: num(r.budget), leadSource: r.lead_source, salesperson: r.salesperson,
    leads: Number(r.leads), deals: Number(r.deals), sales: Number(r.sales),
  }));
  return { rows, summary: { customers: rows.length, leads: rows.reduce((s, r) => s + (r.leads as number), 0) } };
}

async function reportSalesperson(ctx: Ctx): Promise<{ rows: unknown[]; summary: Record<string, unknown> }> {
  const params: unknown[] = [ctx.orgId];
  const filter = dateFilter(ctx, 's.date', params);
  const res = await query(
    `SELECT d.salesperson,
            COUNT(s.id) AS sales,
            COALESCE(SUM(s.selling_price), 0) AS revenue,
            COALESCE(SUM(s.net_profit), 0) AS net_profit
       FROM dealer.sales s
       JOIN dealer.deals d ON d.id = s.deal_id
      WHERE s.organization_id = $1 AND s.deleted_at IS NULL ${filter}
      GROUP BY d.salesperson ORDER BY revenue DESC`,
    params,
  );
  const rows = res.rows.map((r) => ({
    salesperson: (r.salesperson as string) || '(unassigned)',
    sales: Number(r.sales),
    revenue: money(num(r.revenue)),
    netProfit: money(num(r.net_profit)),
  }));
  return {
    rows,
    summary: {
      salespeople: rows.length,
      revenue: money(rows.reduce((s, r) => s + (r.revenue as number), 0)),
      netProfit: money(rows.reduce((s, r) => s + (r.netProfit as number), 0)),
    },
  };
}

const REPORTS: Record<ReportName, (ctx: Ctx) => Promise<{ rows: unknown[]; summary: Record<string, unknown> }>> = {
  inventory: reportInventory,
  sales: reportSales,
  profitability: reportProfitability,
  expenses: reportExpenses,
  recon: reportRecon,
  'parts-valuation': reportPartsValuation,
  fifo: reportFifo,
  cashflow: reportCashflow,
  balances: reportBalances,
  receivables: (ctx) => reportReceivables(ctx, 'Customer'),
  payables: (ctx) => reportReceivables(ctx, null),
  pl: reportPl,
  aging: reportAging,
  crm: reportCrm,
  salesperson: reportSalesperson,
};

reportsRouter.get(
  '/:name',
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const name = req.params.name as string;
      if (!(REPORT_NAMES as readonly string[]).includes(name)) {
        throw badRequest(`Unknown report "${name}". Available: ${REPORT_NAMES.join(', ')}`);
      }
      const orgId = requireOrgId(req);
      const { from, to } = req.query as unknown as { from?: string; to?: string };
      const result = await REPORTS[name as ReportName]({ orgId, from, to });
      res.json({ report: name, from: from ?? null, to: to ?? null, ...result });
    } catch (err) {
      next(err);
    }
  },
);
