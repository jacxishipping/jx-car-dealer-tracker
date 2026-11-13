// Generic org-scoped CRUD for the standard resources, plus the custom
// list handlers (journal with nested lines, audit, notifications, team)
// that need joins the factory cannot express.
//
// Every query filters organization_id = $orgId from the JWT — the org is
// NEVER taken from the request body. All writes are parameterised, Zod
// validated and audit-logged inside a transaction.
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import {
  authenticate,
  requireOrgId,
  requireUser,
  type AuthedUser,
} from '../middleware/auth';
import { canManageRole, requirePermission, type Permission } from '../middleware/rbac';
import { paginationSchema, validateBody, validateQuery, type PaginationParams } from '../middleware/validate';
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors';
import { insertAudit } from '../lib/audit';
import * as m from '../lib/mappers';
import { insertVehicleTx, assertVinAvailable, type VehicleInput } from '../lib/vehicles';
import { expenseCategoryId, recordExpenseTx, type ExpenseInput } from '../lib/services';
import { EXPENSE_CATEGORIES, LEAD_STAGES, VEHICLE_STATUSES } from '../lib/types';
import type { Role } from '../lib/types';

export const crudRouter = Router();
crudRouter.use(authenticate);

// --- Factory ---------------------------------------------------------------
type Columns = Record<string, unknown>;

interface ResourceDef {
  table: string;
  mapper: (row: Record<string, unknown>) => Record<string, unknown>;
  searchColumns: string[];
  statusColumn?: string;
  createPerm: Permission;
  updatePerm: Permission;
  deletePerm?: Permission;
  createSchema: z.ZodObject<z.ZodRawShape>;
  updateSchema: z.ZodObject<z.ZodRawShape>;
  /** camelCase body → DB columns for a plain insert. */
  toColumns?: (body: Record<string, unknown>) => Columns;
  toUpdateColumns?: (body: Record<string, unknown>) => Columns;
  /** Extra SELECT fragment, e.g. ', ec.name AS category_name'. */
  selectExtra?: string;
  joins?: string;
  allowCreate?: boolean;
  allowUpdate?: boolean;
  allowDelete?: boolean;
  /** Set false for tables without an updated_at column (e.g. documents). */
  hasUpdatedAt?: boolean;
  auditEntity: string;
  /** Full custom insert (vehicles, expenses). Replaces toColumns. */
  insertFn?: (
    client: PoolClient,
    orgId: string,
    body: Record<string, unknown>,
    user: AuthedUser,
  ) => Promise<Record<string, unknown>>;
  beforeCreate?: (
    client: PoolClient,
    orgId: string,
    body: Record<string, unknown>,
    columns: Columns,
    user: AuthedUser,
  ) => Promise<void>;
  beforeUpdate?: (
    client: PoolClient,
    orgId: string,
    id: string,
    body: Record<string, unknown>,
    columns: Columns,
    user: AuthedUser,
  ) => Promise<void>;
  afterCreate?: (
    client: PoolClient,
    orgId: string,
    row: Record<string, unknown>,
    body: Record<string, unknown>,
    user: AuthedUser,
  ) => Promise<void>;
}

function insertSql(table: string, orgId: string, columns: Columns): { text: string; values: unknown[] } {
  const keys = Object.keys(columns);
  const values: unknown[] = [orgId, ...keys.map((k) => columns[k])];
  const placeholders = keys.map((_, i) => `$${i + 2}`).join(', ');
  return {
    text: `INSERT INTO ${table} (organization_id, ${keys.join(', ')}) VALUES ($1, ${placeholders}) RETURNING *`,
    values,
  };
}

function registerResource(base: string, def: ResourceDef): void {
  const allowCreate = def.allowCreate !== false;
  const allowUpdate = def.allowUpdate !== false;
  const allowDelete = def.allowDelete !== false;

  crudRouter.get(
    base,
    validateQuery(paginationSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const orgId = requireOrgId(req);
        const { q, status, page, limit } = req.query as unknown as PaginationParams;
        const where: string[] = [
          `${def.table}.organization_id = $1`,
          `${def.table}.deleted_at IS NULL`,
        ];
        const params: unknown[] = [orgId];
        if (status && def.statusColumn) {
          params.push(status);
          where.push(`${def.table}.${def.statusColumn} = $${params.length}`);
        }
        if (q && def.searchColumns.length > 0) {
          params.push(`%${q}%`);
          const idx = params.length;
          where.push(
            `(${def.searchColumns.map((c) => `${def.table}.${c} ILIKE $${idx}`).join(' OR ')})`,
          );
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;
        const fromSql = `FROM ${def.table} ${def.joins ?? ''}`;
        const count = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count ${fromSql} ${whereSql}`,
          params,
        );
        const total = Number(count.rows[0]?.count ?? 0);
        const offset = (page - 1) * limit;
        const rowsRes = await query(
          `SELECT ${def.table}.* ${def.selectExtra ?? ''} ${fromSql} ${whereSql}
            ORDER BY ${def.table}.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        );
        res.json({ data: rowsRes.rows.map(def.mapper), total, page, limit });
      } catch (err) {
        next(err);
      }
    },
  );

  crudRouter.get(`${base}/:id`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { rows } = await query(
        `SELECT ${def.table}.* ${def.selectExtra ?? ''} FROM ${def.table} ${def.joins ?? ''}
          WHERE ${def.table}.organization_id = $1 AND ${def.table}.id = $2
            AND ${def.table}.deleted_at IS NULL`,
        [orgId, req.params.id],
      );
      if (rows.length === 0) throw notFound('Not found');
      res.json(def.mapper(rows[0] as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  });

  if (allowCreate) {
    crudRouter.post(
      base,
      requirePermission(def.createPerm),
      validateBody(def.createSchema),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const orgId = requireOrgId(req);
          const user = requireUser(req);
          const row = await withTransaction(async (client) => {
            let created: Record<string, unknown>;
            if (def.insertFn) {
              created = await def.insertFn(client, orgId, req.body as Record<string, unknown>, user);
            } else {
              const columns = def.toColumns ? def.toColumns(req.body as Record<string, unknown>) : {};
              if (def.beforeCreate) {
                await def.beforeCreate(client, orgId, req.body as Record<string, unknown>, columns, user);
              }
              const { text, values } = insertSql(def.table, orgId, columns);
              const inserted = await client.query(text, values);
              created = inserted.rows[0] as Record<string, unknown>;
            }
            if (def.afterCreate) {
              await def.afterCreate(client, orgId, created, req.body as Record<string, unknown>, user);
            }
            // insertFn implementations audit themselves; plain inserts audit here.
            if (!def.insertFn) {
              await insertAudit(client, {
                orgId,
                actorId: user.id,
                actorName: user.displayName,
                action: `${def.auditEntity.toUpperCase()}_CREATED`,
                entityType: def.auditEntity,
                entityId: created.id as string,
                summary: `${def.auditEntity} created.`,
              });
            }
            return created;
          });
          res.status(201).json(def.mapper(row));
        } catch (err) {
          next(err);
        }
      },
    );
  }

  if (allowUpdate) {
    crudRouter.patch(
      `${base}/:id`,
      requirePermission(def.updatePerm),
      validateBody(def.updateSchema),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const orgId = requireOrgId(req);
          const user = requireUser(req);
          const row = await withTransaction(async (client) => {
            const columns = def.toUpdateColumns
              ? def.toUpdateColumns(req.body as Record<string, unknown>)
              : {};
            if (def.beforeUpdate) {
              await def.beforeUpdate(client, orgId, req.params.id, req.body as Record<string, unknown>, columns, user);
            }
            const keys = Object.keys(columns);
            if (keys.length === 0) throw badRequest('Nothing to update');
            const sets = keys.map((k, i) => `${k} = $${i + 1}`);
            const values: unknown[] = keys.map((k) => columns[k]);
            values.push(req.params.id, orgId);
            const updated = await client.query(
              `UPDATE ${def.table} SET ${sets.join(', ')}${def.hasUpdatedAt === false ? '' : ', updated_at = now()'}
                WHERE id = $${values.length - 1} AND organization_id = $${values.length}
                  AND deleted_at IS NULL RETURNING *`,
              values,
            );
            if (updated.rows.length === 0) throw notFound('Not found');
            const updatedRow = updated.rows[0] as Record<string, unknown>;
            await insertAudit(client, {
              orgId,
              actorId: user.id,
              actorName: user.displayName,
              action: `${def.auditEntity.toUpperCase()}_UPDATED`,
              entityType: def.auditEntity,
              entityId: updatedRow.id as string,
              summary: `${def.auditEntity} updated.`,
            });
            return updatedRow;
          });
          res.json(def.mapper(row));
        } catch (err) {
          next(err);
        }
      },
    );
  }

  if (allowDelete) {
    crudRouter.delete(
      `${base}/:id`,
      requirePermission(def.deletePerm ?? def.updatePerm),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const orgId = requireOrgId(req);
          const user = requireUser(req);
          await withTransaction(async (client) => {
            const deleted = await client.query(
              `UPDATE ${def.table} SET deleted_at = now()
                WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING id`,
              [req.params.id, orgId],
            );
            if (deleted.rows.length === 0) throw notFound('Not found');
            await insertAudit(client, {
              orgId,
              actorId: user.id,
              actorName: user.displayName,
              action: `${def.auditEntity.toUpperCase()}_DELETED`,
              entityType: def.auditEntity,
              entityId: req.params.id,
              summary: `${def.auditEntity} deleted (soft delete).`,
            });
          });
          res.json({ ok: true, id: req.params.id });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}

// --- Shared zod fragments ---------------------------------------------------
const moneyField = z.number().min(0);
const optionalMoney = moneyField.optional();
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const nullableDate = dateField.nullable().optional();

const vehicleSchema = z.object({
  stockNumber: z.string().trim().min(1).max(50).optional(),
  vin: z.string().trim().min(11).max(17),
  year: z.number().int().min(1900).max(2100),
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  trim: z.string().max(100).optional(),
  extColor: z.string().max(50).optional(),
  intColor: z.string().max(50).optional(),
  mileage: z.number().int().min(0).optional(),
  transmission: z.string().max(50).optional(),
  engine: z.string().max(100).optional(),
  fuel: z.string().max(50).optional(),
  drivetrain: z.string().max(50).optional(),
  bodyType: z.string().max(50).optional(),
  condition: z.enum(['Excellent', 'Good', 'Fair', 'Poor']).optional(),
  titleStatus: z.enum(['Clean', 'Salvage', 'Rebuilt', 'Lien', 'Missing']).optional(),
  status: z.enum(VEHICLE_STATUSES as unknown as [string, ...string[]]).optional(),
  purchaseDate: dateField,
  purchaseSource: z.enum(['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer']).optional(),
  purchasePrice: optionalMoney,
  auctionFees: optionalMoney,
  transportCost: optionalMoney,
  askingPrice: optionalMoney,
  minPrice: optionalMoney,
  notes: z.string().max(5000).optional(),
});

function camelToColumns(body: Record<string, unknown>, map: Record<string, string>): Columns {
  const out: Columns = {};
  for (const [bodyKey, column] of Object.entries(map)) {
    if (body[bodyKey] !== undefined) out[column] = body[bodyKey];
  }
  return out;
}

// --- Vehicles ---------------------------------------------------------------
registerResource('/vehicles', {
  table: 'dealer.vehicles',
  mapper: m.mapVehicle,
  searchColumns: ['stock_number', 'vin', 'make', 'model'],
  statusColumn: 'status',
  createPerm: 'vehicle.create',
  updatePerm: 'vehicle.update',
  createSchema: vehicleSchema,
  updateSchema: vehicleSchema.partial().omit({ vin: true }).extend({ vin: z.string().trim().min(11).max(17).optional() }),
  auditEntity: 'Vehicle',
  insertFn: (client, orgId, body) => insertVehicleTx(client, orgId, body as unknown as VehicleInput),
  beforeUpdate: async (client, orgId, id, body) => {
    if (typeof body.vin === 'string') await assertVinAvailable(client, orgId, body.vin, id);
  },
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      stockNumber: 'stock_number', vin: 'vin', year: 'year', make: 'make', model: 'model',
      trim: 'trim', extColor: 'ext_color', intColor: 'int_color', mileage: 'mileage',
      transmission: 'transmission', engine: 'engine', fuel: 'fuel', drivetrain: 'drivetrain',
      bodyType: 'body_type', condition: 'condition', titleStatus: 'title_status',
      status: 'status', purchaseDate: 'purchase_date', purchaseSource: 'purchase_source',
      purchasePrice: 'purchase_price', auctionFees: 'auction_fees', transportCost: 'transport_cost',
      askingPrice: 'asking_price', minPrice: 'min_price', notes: 'notes',
    }),
});

// --- Purchases (create is the transactional POST /api/purchases) -------------
registerResource('/purchases', {
  table: 'dealer.vehicle_purchases',
  mapper: m.mapPurchase,
  searchColumns: ['ref', 'seller', 'auction'],
  statusColumn: 'payment_status',
  createPerm: 'purchase.create',
  updatePerm: 'purchase.create',
  createSchema: z.object({}),
  updateSchema: z.object({
    seller: z.string().trim().min(1).max(200).optional(),
    auction: z.string().max(200).optional(),
    purchaseDate: dateField.optional(),
    vehiclePrice: optionalMoney,
    buyerFees: optionalMoney,
    auctionFees: optionalMoney,
    taxes: optionalMoney,
    transportEstimate: optionalMoney,
    paymentMethod: z.string().max(100).optional(),
    paymentStatus: z.enum(['Paid', 'Partial', 'Unpaid']).optional(),
    documents: z.string().max(1000).optional(),
  }),
  auditEntity: 'Purchase',
  allowCreate: false,
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      seller: 'seller', auction: 'auction', purchaseDate: 'purchase_date',
      vehiclePrice: 'vehicle_price', buyerFees: 'buyer_fees', auctionFees: 'auction_fees',
      taxes: 'taxes', transportEstimate: 'transport_estimate', paymentMethod: 'payment_method',
      paymentStatus: 'payment_status', documents: 'documents',
    }),
});

// --- Transport (create/patch are the transactional routes) ------------------
registerResource('/transport', {
  table: 'dealer.transportation_orders',
  mapper: m.mapTransport,
  searchColumns: ['carrier', 'driver', 'invoice_ref', 'bill_of_lading'],
  statusColumn: 'status',
  createPerm: 'vehicle.update',
  updatePerm: 'vehicle.update',
  createSchema: z.object({}),
  updateSchema: z.object({}),
  auditEntity: 'TransportOrder',
  allowCreate: false,
  allowUpdate: false,
});

// --- Expenses ---------------------------------------------------------------
const expenseSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: z.number().positive(),
  category: z.enum(EXPENSE_CATEGORIES as unknown as [string, ...string[]]),
  date: dateField,
  vendor: z.string().max(200).optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  kind: z.enum(['Direct', 'Overhead']),
  paymentMethod: z.string().max(100).optional(),
  status: z.enum(['Paid', 'Pending']).optional(),
  invoiceRef: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

registerResource('/expenses', {
  table: 'dealer.expenses',
  mapper: m.mapExpense,
  searchColumns: ['description', 'category_name', 'vendor_name', 'invoice_ref'],
  statusColumn: 'status',
  createPerm: 'expense.create',
  updatePerm: 'expense.create',
  createSchema: expenseSchema,
  updateSchema: expenseSchema.partial(),
  auditEntity: 'Expense',
  selectExtra: ', u.display_name AS created_by_name',
  joins: 'LEFT JOIN dealer.users u ON u.id = dealer.expenses.created_by',
  insertFn: async (client, orgId, body, user) => {
    const input = body as unknown as ExpenseInput;
    const row = await recordExpenseTx(client, orgId, { ...input, status: input.status ?? 'Pending' }, user);
    // recordExpenseTx audits itself; return the row re-selected with the join
    // columns the mapper expects.
    const res = await client.query(
      `SELECT e.*, u.display_name AS created_by_name FROM dealer.expenses e
        LEFT JOIN dealer.users u ON u.id = e.created_by WHERE e.id = $1`,
      [row.id],
    );
    return res.rows[0] as Record<string, unknown>;
  },
  toUpdateColumns: (body) => {
    const cols = camelToColumns(body, {
      description: 'description', amount: 'amount', date: 'date',
      vendor: 'vendor_name', vehicleId: 'vehicle_id', kind: 'kind',
      paymentMethod: 'payment_method', status: 'status', invoiceRef: 'invoice_ref',
      notes: 'notes',
    });
    if (typeof body.category === 'string') cols.category_name = body.category;
    return cols;
  },
  beforeUpdate: async (client, orgId, _id, body, columns) => {
    if (typeof body.category === 'string') {
      columns.category_id = await expenseCategoryId(client, orgId, body.category);
    }
  },
});

// --- Reconditioning ---------------------------------------------------------
const reconSchema = z.object({
  vehicleId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  category: z.enum(EXPENSE_CATEGORIES as unknown as [string, ...string[]]).optional(),
  status: z.enum(['Not started', 'In progress', 'Done']).optional(),
  technician: z.string().max(200).optional(),
  estimatedCost: optionalMoney,
  actualCost: optionalMoney,
  startedAt: nullableDate,
  completedAt: nullableDate,
  notes: z.string().max(5000).optional(),
});

registerResource('/recon', {
  table: 'dealer.reconditioning_jobs',
  mapper: m.mapRecon,
  searchColumns: ['title', 'technician'],
  statusColumn: 'status',
  createPerm: 'vehicle.update',
  updatePerm: 'vehicle.update',
  createSchema: reconSchema,
  updateSchema: reconSchema.partial().omit({ vehicleId: true }),
  auditEntity: 'ReconJob',
  selectExtra: ', ec.name AS category_name',
  joins: 'LEFT JOIN dealer.expense_categories ec ON ec.id = dealer.reconditioning_jobs.category_id',
  toColumns: (body) => {
    const cols = camelToColumns(body, {
      vehicleId: 'vehicle_id', title: 'title', status: 'status', technician: 'technician',
      estimatedCost: 'estimated_cost', actualCost: 'actual_cost',
      startedAt: 'started_at', completedAt: 'completed_at', notes: 'notes',
    });
    return cols;
  },
  beforeCreate: async (client, orgId, body, columns) => {
    if (typeof body.category === 'string') {
      columns.category_id = await expenseCategoryId(client, orgId, body.category);
    }
  },
  toUpdateColumns: (body) => {
    const cols = camelToColumns(body, {
      title: 'title', status: 'status', technician: 'technician',
      estimatedCost: 'estimated_cost', actualCost: 'actual_cost',
      startedAt: 'started_at', completedAt: 'completed_at', notes: 'notes',
    });
    return cols;
  },
  beforeUpdate: async (client, orgId, _id, body, columns) => {
    if (typeof body.category === 'string') {
      columns.category_id = await expenseCategoryId(client, orgId, body.category);
    }
  },
});

// --- Parts ------------------------------------------------------------------
registerResource('/parts', {
  table: 'dealer.parts',
  mapper: m.mapPart,
  searchColumns: ['sku', 'name', 'manufacturer', 'supplier'],
  createPerm: 'vehicle.create',
  updatePerm: 'vehicle.create',
  createSchema: z.object({
    sku: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    manufacturer: z.string().max(200).optional(),
    supplier: z.string().max(200).optional(),
    minStock: z.number().int().min(0).optional(),
  }),
  updateSchema: z.object({
    sku: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    manufacturer: z.string().max(200).optional(),
    supplier: z.string().max(200).optional(),
    minStock: z.number().int().min(0).optional(),
  }),
  auditEntity: 'Part',
  toColumns: (body) =>
    camelToColumns(body, {
      sku: 'sku', name: 'name', manufacturer: 'manufacturer',
      supplier: 'supplier', minStock: 'min_stock',
    }),
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      sku: 'sku', name: 'name', manufacturer: 'manufacturer',
      supplier: 'supplier', minStock: 'min_stock',
    }),
});

// --- Customers --------------------------------------------------------------
registerResource('/customers', {
  table: 'dealer.customers',
  mapper: m.mapCustomer,
  searchColumns: ['name', 'email', 'phone'],
  createPerm: 'customer.create',
  updatePerm: 'customer.create',
  createSchema: z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().max(50).optional(),
    email: z.string().email().max(320).optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    preferredContact: z.enum(['Phone', 'Email', 'WhatsApp']).optional(),
    budget: optionalMoney,
    leadSource: z.string().max(200).optional(),
    salesperson: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  }),
  updateSchema: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().max(50).optional(),
    email: z.string().email().max(320).optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    preferredContact: z.enum(['Phone', 'Email', 'WhatsApp']).optional(),
    budget: optionalMoney,
    leadSource: z.string().max(200).optional(),
    salesperson: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  }),
  auditEntity: 'Customer',
  toColumns: (body) =>
    camelToColumns(body, {
      name: 'name', phone: 'phone', email: 'email', address: 'address',
      preferredContact: 'preferred_contact', budget: 'budget',
      leadSource: 'lead_source', salesperson: 'salesperson', notes: 'notes',
    }),
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      name: 'name', phone: 'phone', email: 'email', address: 'address',
      preferredContact: 'preferred_contact', budget: 'budget',
      leadSource: 'lead_source', salesperson: 'salesperson', notes: 'notes',
    }),
});

// --- Leads ------------------------------------------------------------------
registerResource('/leads', {
  table: 'dealer.leads',
  mapper: m.mapLead,
  searchColumns: ['notes'],
  statusColumn: 'stage',
  createPerm: 'lead.create',
  updatePerm: 'lead.create',
  createSchema: z.object({
    customerId: z.string().uuid(),
    stage: z.enum(LEAD_STAGES as unknown as [string, ...string[]]).optional(),
    followUpDate: dateField,
    notes: z.string().max(5000).optional(),
  }),
  updateSchema: z.object({
    stage: z.enum(LEAD_STAGES as unknown as [string, ...string[]]).optional(),
    followUpDate: dateField.optional(),
    notes: z.string().max(5000).optional(),
  }),
  auditEntity: 'Lead',
  toColumns: (body) =>
    camelToColumns(body, {
      customerId: 'customer_id', stage: 'stage',
      followUpDate: 'follow_up_date', notes: 'notes',
    }),
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      stage: 'stage', followUpDate: 'follow_up_date', notes: 'notes',
    }),
});

// --- Deals (create + finalize are transactional routes) ---------------------
registerResource('/deals', {
  table: 'dealer.deals',
  mapper: m.mapDeal,
  searchColumns: ['ref', 'salesperson'],
  statusColumn: 'status',
  createPerm: 'deal.create',
  updatePerm: 'deal.create',
  createSchema: z.object({}),
  updateSchema: z.object({
    salesperson: z.string().max(200).optional(),
    sellingPrice: optionalMoney,
    discount: optionalMoney,
    taxes: optionalMoney,
    fees: optionalMoney,
    deposit: optionalMoney,
    tradeInValue: optionalMoney,
    tradeInDesc: z.string().max(1000).optional(),
    paymentMethod: z.string().max(100).optional(),
    status: z.enum(['Draft', 'Negotiation', 'Cancelled']).optional(),
  }),
  auditEntity: 'Deal',
  allowCreate: false,
  selectExtra: ', s.ref AS sale_ref',
  joins: 'LEFT JOIN dealer.sales s ON s.id = dealer.deals.sale_id',
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      salesperson: 'salesperson', sellingPrice: 'selling_price', discount: 'discount',
      taxes: 'taxes', fees: 'fees', deposit: 'deposit', tradeInValue: 'trade_in_value',
      tradeInDesc: 'trade_in_desc', paymentMethod: 'payment_method', status: 'status',
    }),
});

// --- Sales (read-only; created by finalisation) -----------------------------
registerResource('/sales', {
  table: 'dealer.sales',
  mapper: m.mapSale,
  searchColumns: ['ref'],
  createPerm: 'sale.finalize',
  updatePerm: 'sale.finalize',
  createSchema: z.object({}),
  updateSchema: z.object({}),
  auditEntity: 'Sale',
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
});

// --- Accounts ---------------------------------------------------------------
registerResource('/accounts', {
  table: 'dealer.accounts',
  mapper: m.mapAccount,
  searchColumns: ['name'],
  statusColumn: 'status',
  createPerm: 'finance.write',
  updatePerm: 'finance.write',
  createSchema: z.object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['Bank', 'Cash', 'Petty cash', 'Floorplan', 'Credit']),
    currency: z.string().max(10).optional(),
    openingBalance: z.number().optional(),
    status: z.enum(['Active', 'Closed']).optional(),
  }),
  updateSchema: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    type: z.enum(['Bank', 'Cash', 'Petty cash', 'Floorplan', 'Credit']).optional(),
    currency: z.string().max(10).optional(),
    openingBalance: z.number().optional(),
    status: z.enum(['Active', 'Closed']).optional(),
  }),
  auditEntity: 'Account',
  toColumns: (body) =>
    camelToColumns(body, {
      name: 'name', type: 'type', currency: 'currency',
      openingBalance: 'opening_balance', status: 'status',
    }),
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      name: 'name', type: 'type', currency: 'currency',
      openingBalance: 'opening_balance', status: 'status',
    }),
});

// --- Financial transactions (read-only; written by money flows) -------------
registerResource('/transactions', {
  table: 'dealer.financial_transactions',
  mapper: m.mapTransaction,
  searchColumns: ['reference', 'category', 'note', 'type'],
  createPerm: 'finance.write',
  updatePerm: 'finance.write',
  createSchema: z.object({}),
  updateSchema: z.object({}),
  auditEntity: 'FinancialTransaction',
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
});

// --- Receivables (read-only; written by purchase/sale/payment flows) --------
registerResource('/receivables', {
  table: 'dealer.receivables',
  mapper: m.mapReceivable,
  searchColumns: ['entity_name', 'reference'],
  statusColumn: 'status',
  createPerm: 'payment.record',
  updatePerm: 'payment.record',
  createSchema: z.object({}),
  updateSchema: z.object({}),
  auditEntity: 'Receivable',
  allowCreate: false,
  allowUpdate: false,
  allowDelete: false,
});

// --- Documents (metadata only; no file bytes are stored) --------------------
registerResource('/documents', {
  table: 'dealer.documents',
  mapper: m.mapDocument,
  searchColumns: ['title', 'file_name', 'type'],
  createPerm: 'vehicle.create',
  updatePerm: 'vehicle.create',
  createSchema: z.object({
    title: z.string().trim().min(1).max(300),
    type: z.string().max(100).optional(),
    entityType: z.enum(['Vehicle', 'Customer', 'Expense', 'Transaction', 'Deal']),
    entityId: z.string().uuid(),
    fileName: z.string().min(1).max(300),
    fileSize: z.number().int().min(0).optional(),
    fileType: z.string().max(100).optional(),
    expiresAt: z.string().optional().nullable(),
    accessRole: z.enum(['Owner', 'Admin', 'Manager', 'Sales', 'Accountant', 'Technician', 'Viewer']).optional(),
  }),
  updateSchema: z.object({
    title: z.string().trim().min(1).max(300).optional(),
    type: z.string().max(100).optional(),
    expiresAt: z.string().optional().nullable(),
    accessRole: z.enum(['Owner', 'Admin', 'Manager', 'Sales', 'Accountant', 'Technician', 'Viewer']).optional(),
  }),
  auditEntity: 'Document',
  hasUpdatedAt: false,
  selectExtra: ', u.display_name AS uploaded_by_name',
  joins: 'LEFT JOIN dealer.users u ON u.id = dealer.documents.uploaded_by',
  toColumns: (body) => {
    const cols = camelToColumns(body, {
      title: 'title', type: 'type', entityType: 'entity_type', entityId: 'entity_id',
      fileName: 'file_name', fileSize: 'file_size', fileType: 'file_type',
      expiresAt: 'expires_at', accessRole: 'access_role',
    });
    return cols;
  },
  beforeCreate: async (_client, _orgId, _body, columns, user) => {
    columns.uploaded_by = user.id;
  },
  toUpdateColumns: (body) =>
    camelToColumns(body, {
      title: 'title', type: 'type', expiresAt: 'expires_at', accessRole: 'access_role',
    }),
});

// --- Journal (read-only; entries are written by money flows) ----------------
crudRouter.get(
  '/journal',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { q, page, limit } = req.query as unknown as PaginationParams;
      const where: string[] = ['j.organization_id = $1', 'j.deleted_at IS NULL'];
      const params: unknown[] = [orgId];
      if (q) {
        params.push(`%${q}%`);
        where.push(`(j.ref ILIKE $${params.length} OR j.memo ILIKE $${params.length})`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.journal_entries j ${whereSql}`,
        params,
      );
      const total = Number(count.rows[0]?.count ?? 0);
      const offset = (page - 1) * limit;
      const entries = await query(
        `SELECT j.* FROM dealer.journal_entries j ${whereSql}
          ORDER BY j.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const ids = entries.rows.map((r) => r.id as string);
      let lines: Record<string, unknown>[] = [];
      if (ids.length > 0) {
        const linesRes = await query(
          `SELECT * FROM dealer.journal_entry_lines WHERE entry_id = ANY($1::uuid[])`,
          [ids],
        );
        lines = linesRes.rows as Record<string, unknown>[];
      }
      const byEntry = new Map<string, Record<string, unknown>[]>();
      for (const line of lines) {
        const key = line.entry_id as string;
        if (!byEntry.has(key)) byEntry.set(key, []);
        byEntry.get(key)!.push(line);
      }
      res.json({
        data: entries.rows.map((row) =>
          m.mapJournal(row as Record<string, unknown>, byEntry.get(row.id as string) ?? []),
        ),
        total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.get('/journal/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const { rows } = await query(
      `SELECT * FROM dealer.journal_entries
        WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [orgId, req.params.id],
    );
    if (rows.length === 0) throw notFound('Journal entry not found');
    const lines = await query(
      `SELECT * FROM dealer.journal_entry_lines WHERE entry_id = $1`,
      [req.params.id],
    );
    res.json(
      m.mapJournal(
        rows[0] as Record<string, unknown>,
        lines.rows as Record<string, unknown>[],
      ),
    );
  } catch (err) {
    next(err);
  }
});

// --- Audit (append-only: read-only) -----------------------------------------
crudRouter.get(
  '/audit',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { q, page, limit } = req.query as unknown as PaginationParams;
      const where: string[] = ['organization_id = $1'];
      const params: unknown[] = [orgId];
      if (q) {
        params.push(`%${q}%`);
        where.push(
          `(action ILIKE $${params.length} OR entity_type ILIKE $${params.length} OR summary ILIKE $${params.length} OR actor_name ILIKE $${params.length})`,
        );
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.audit_logs ${whereSql}`,
        params,
      );
      const total = Number(count.rows[0]?.count ?? 0);
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.audit_logs ${whereSql}
          ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapAudit(r as Record<string, unknown>)),
        total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.get('/audit/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const { rows } = await query(
      `SELECT * FROM dealer.audit_logs WHERE organization_id = $1 AND id = $2`,
      [orgId, req.params.id],
    );
    if (rows.length === 0) throw notFound('Audit entry not found');
    res.json(m.mapAudit(rows[0] as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// --- Notifications (list/get/patch-read) ------------------------------------
crudRouter.get(
  '/notifications',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const { q, page, limit } = req.query as unknown as PaginationParams;
      const where: string[] = [
        'organization_id = $1',
        '(user_id IS NULL OR user_id = $2)',
        'deleted_at IS NULL',
      ];
      const params: unknown[] = [orgId, user.id];
      if (q) {
        params.push(`%${q}%`);
        where.push(`(title ILIKE $${params.length} OR detail ILIKE $${params.length})`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.notifications ${whereSql}`,
        params,
      );
      const total = Number(count.rows[0]?.count ?? 0);
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.notifications ${whereSql}
          ORDER BY date DESC, created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapNotification(r as Record<string, unknown>)),
        total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.get('/notifications/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const user = requireUser(req);
    const { rows } = await query(
      `SELECT * FROM dealer.notifications
        WHERE organization_id = $1 AND id = $2 AND (user_id IS NULL OR user_id = $3)
          AND deleted_at IS NULL`,
      [orgId, req.params.id, user.id],
    );
    if (rows.length === 0) throw notFound('Notification not found');
    res.json(m.mapNotification(rows[0] as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

crudRouter.patch(
  '/notifications/:id',
  validateBody(z.object({ read: z.boolean() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const { rows } = await query(
        `UPDATE dealer.notifications SET read = $1
          WHERE organization_id = $2 AND id = $3 AND (user_id IS NULL OR user_id = $4)
            AND deleted_at IS NULL RETURNING *`,
        [(req.body as { read: boolean }).read, orgId, req.params.id, user.id],
      );
      if (rows.length === 0) throw notFound('Notification not found');
      res.json(m.mapNotification(rows[0] as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },
);

// --- Team (organization_members joined to users + roles) --------------------
const teamMemberSelect = `
  SELECT om.id, u.display_name, u.email, r.name AS role_name, om.active
    FROM dealer.organization_members om
    JOIN dealer.users u ON u.id = om.user_id
    JOIN dealer.roles r ON r.id = om.role_id`;

crudRouter.get(
  '/team',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { q, status, page, limit } = req.query as unknown as PaginationParams;
      const where: string[] = ['om.organization_id = $1', 'om.deleted_at IS NULL', 'u.deleted_at IS NULL'];
      const params: unknown[] = [orgId];
      if (q) {
        params.push(`%${q}%`);
        where.push(`(u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }
      if (status === 'active') where.push('om.active = TRUE');
      if (status === 'inactive') where.push('om.active = FALSE');
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count ${teamMemberSelect} ${whereSql}`,
        params,
      );
      const total = Number(count.rows[0]?.count ?? 0);
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `${teamMemberSelect} ${whereSql} ORDER BY u.display_name ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapTeamMember(r as Record<string, unknown>)),
        total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.get('/team/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const { rows } = await query(
      `${teamMemberSelect}
        WHERE om.organization_id = $1 AND om.id = $2 AND om.deleted_at IS NULL`,
      [orgId, req.params.id],
    );
    if (rows.length === 0) throw notFound('Team member not found');
    res.json(m.mapTeamMember(rows[0] as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

// Add a member: creates the user (no password — they cannot sign in until
// one is set) and an Owner/Admin-gated membership. Admins cannot grant Owner.
crudRouter.post(
  '/team',
  requirePermission('team.manage'),
  validateBody(
    z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().max(320),
      role: z.enum(['Owner', 'Admin', 'Manager', 'Sales', 'Accountant', 'Technician', 'Viewer']),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const actorRole = req.role as Role;
      const { name, email, role } = req.body as { name: string; email: string; role: Role };
      if (!canManageRole(actorRole, role)) {
        throw forbidden(`Role ${actorRole} cannot grant the ${role} role`);
      }
      const member = await withTransaction(async (client) => {
        let userRes = await client.query(
          `SELECT id FROM dealer.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
          [email],
        );
        let userId: string;
        if (userRes.rows.length === 0) {
          userRes = await client.query(
            `INSERT INTO dealer.users (email, display_name) VALUES ($1, $2) RETURNING id`,
            [email, name],
          );
        }
        userId = userRes.rows[0].id as string;
        const existing = await client.query(
          `SELECT id FROM dealer.organization_members
            WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [orgId, userId],
        );
        if (existing.rows.length > 0) {
          throw new ApiError(409, 'This person is already a member of the organization', 'CONFLICT');
        }
        let roleRes = await client.query(
          `SELECT id FROM dealer.roles WHERE organization_id = $1 AND name = $2 AND deleted_at IS NULL`,
          [orgId, role],
        );
        if (roleRes.rows.length === 0) {
          roleRes = await client.query(
            `INSERT INTO dealer.roles (organization_id, name) VALUES ($1, $2) RETURNING id`,
            [orgId, role],
          );
        }
        const memberRes = await client.query(
          `INSERT INTO dealer.organization_members (organization_id, user_id, role_id, active)
           VALUES ($1, $2, $3, TRUE) RETURNING id`,
          [orgId, userId, roleRes.rows[0].id],
        );
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'TEAM_MEMBER_ADDED',
          entityType: 'TeamMember',
          entityId: memberRes.rows[0].id as string,
          summary: `${name} (${email}) added to the team as ${role}.`,
        });
        return memberRes.rows[0].id as string;
      });
      const { rows } = await query(
        `${teamMemberSelect} WHERE om.organization_id = $1 AND om.id = $2`,
        [orgId, member],
      );
      res.status(201).json(m.mapTeamMember(rows[0] as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.patch(
  '/team/:id',
  requirePermission('team.manage'),
  validateBody(
    z.object({
      role: z.enum(['Owner', 'Admin', 'Manager', 'Sales', 'Accountant', 'Technician', 'Viewer']).optional(),
      active: z.boolean().optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const actorRole = req.role as Role;
      const { role, active } = req.body as { role?: Role; active?: boolean };
      if (role && !canManageRole(actorRole, role)) {
        throw forbidden(`Role ${actorRole} cannot grant the ${role} role`);
      }
      const updated = await withTransaction(async (client) => {
        const current = await client.query(
          `SELECT om.id, om.user_id, r.name AS role_name FROM dealer.organization_members om
            JOIN dealer.roles r ON r.id = om.role_id
           WHERE om.id = $1 AND om.organization_id = $2 AND om.deleted_at IS NULL`,
          [req.params.id, orgId],
        );
        if (current.rows.length === 0) throw notFound('Team member not found');
        // Admins cannot demote/promote the Owner either.
        if (!canManageRole(actorRole, current.rows[0].role_name as Role)) {
          throw forbidden(`Role ${actorRole} cannot manage a ${current.rows[0].role_name as string}`);
        }
        if (role) {
          let roleRes = await client.query(
            `SELECT id FROM dealer.roles WHERE organization_id = $1 AND name = $2 AND deleted_at IS NULL`,
            [orgId, role],
          );
          if (roleRes.rows.length === 0) {
            roleRes = await client.query(
              `INSERT INTO dealer.roles (organization_id, name) VALUES ($1, $2) RETURNING id`,
              [orgId, role],
            );
          }
          await client.query(`UPDATE dealer.organization_members SET role_id = $1 WHERE id = $2`, [
            roleRes.rows[0].id,
            req.params.id,
          ]);
        }
        if (active !== undefined) {
          await client.query(`UPDATE dealer.organization_members SET active = $1 WHERE id = $2`, [
            active,
            req.params.id,
          ]);
        }
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'TEAM_MEMBER_UPDATED',
          entityType: 'TeamMember',
          entityId: req.params.id,
          summary: `Team member ${req.params.id} updated${role ? ` (role → ${role})` : ''}${active !== undefined ? ` (active → ${active})` : ''}.`,
        });
        return true;
      });
      void updated;
      const { rows } = await query(
        `${teamMemberSelect} WHERE om.organization_id = $1 AND om.id = $2`,
        [orgId, req.params.id],
      );
      res.json(m.mapTeamMember(rows[0] as Record<string, unknown>));
    } catch (err) {
      next(err);
    }
  },
);

crudRouter.delete(
  '/team/:id',
  requirePermission('team.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const actorRole = req.role as Role;
      await withTransaction(async (client) => {
        const current = await client.query(
          `SELECT r.name AS role_name FROM dealer.organization_members om
            JOIN dealer.roles r ON r.id = om.role_id
           WHERE om.id = $1 AND om.organization_id = $2 AND om.deleted_at IS NULL`,
          [req.params.id, orgId],
        );
        if (current.rows.length === 0) throw notFound('Team member not found');
        if (!canManageRole(actorRole, current.rows[0].role_name as Role)) {
          throw forbidden(`Role ${actorRole} cannot remove a ${current.rows[0].role_name as string}`);
        }
        await client.query(
          `UPDATE dealer.organization_members SET deleted_at = now() WHERE id = $1`,
          [req.params.id],
        );
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'TEAM_MEMBER_REMOVED',
          entityType: 'TeamMember',
          entityId: req.params.id,
          summary: `Team member ${req.params.id} removed.`,
        });
      });
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  },
);

// Re-exported for the finance/parts route modules that need the same guard.
export type { Permission };
