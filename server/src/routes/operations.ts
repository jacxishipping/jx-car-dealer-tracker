// Purchase + transport + CRM operation routes. The list/get/patch/delete
// surface lives in crud.ts; these are the transactional writes.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { paginationSchema, validateBody, validateQuery, type PaginationParams } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { insertAudit } from '../lib/audit';
import * as m from '../lib/mappers';
import { createTransportTx, recordPurchaseTx, updateTransportTx } from '../lib/services';
import { EXPENSE_CATEGORIES, LEAD_STAGES, TRANSPORT_STATUSES } from '../lib/types';

export const operationsRouter = Router();
operationsRouter.use(authenticate);

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const moneyField = z.number().min(0);

const vehicleFields = z.object({
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
  status: z.string().max(50).optional(),
  purchaseDate: dateField.optional(),
  purchaseSource: z.enum(['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer']).optional(),
  purchasePrice: moneyField.optional(),
  auctionFees: moneyField.optional(),
  transportCost: moneyField.optional(),
  askingPrice: moneyField.optional(),
  minPrice: moneyField.optional(),
  notes: z.string().max(5000).optional(),
});

// --- Purchases --------------------------------------------------------------
// POST /api/purchases — vehicle + purchase + transaction + journal + payable
// in ONE transaction. Duplicate live VIN → 409.
const purchaseSchema = z.object({
  seller: z.string().trim().min(1).max(200),
  auction: z.string().max(200).optional(),
  purchaseDate: dateField,
  vehiclePrice: moneyField,
  buyerFees: moneyField.optional(),
  auctionFees: moneyField.optional(),
  taxes: moneyField.optional(),
  transportEstimate: moneyField.optional(),
  paymentMethod: z.string().max(100).optional(),
  paymentStatus: z.enum(['Paid', 'Partial', 'Unpaid']),
  documents: z.string().max(1000).optional(),
  vehicle: vehicleFields,
});

operationsRouter.post(
  '/purchases',
  requirePermission('purchase.create'),
  validateBody(purchaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const result = await withTransaction(async (client) =>
        recordPurchaseTx(client, orgId, req.body as never, user),
      );
      res.status(201).json({
        purchase: m.mapPurchase(result.purchase),
        vehicle: m.mapVehicle(result.vehicle),
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- Transport --------------------------------------------------------------
const transportSchema = z.object({
  vehicleId: z.string().uuid(),
  carrier: z.string().trim().min(1).max(200),
  driver: z.string().max(200).optional(),
  pickupLocation: z.string().max(300).optional(),
  deliveryLocation: z.string().max(300).optional(),
  pickupDate: dateField.nullable().optional(),
  expectedDelivery: dateField.nullable().optional(),
  actualDelivery: dateField.nullable().optional(),
  price: moneyField.optional(),
  status: z.enum(TRANSPORT_STATUSES as unknown as [string, ...string[]]).optional(),
  gatePass: z.string().max(200).optional(),
  billOfLading: z.string().max(200).optional(),
  damageNotes: z.string().max(5000).optional(),
  invoiceRef: z.string().max(200).optional(),
  paymentStatus: z.enum(['Paid', 'Partial', 'Unpaid']).optional(),
});

operationsRouter.post(
  '/transport',
  requirePermission('vehicle.update'),
  validateBody(transportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const row = await withTransaction(async (client) =>
        createTransportTx(client, orgId, req.body as never, user),
      );
      res.status(201).json(m.mapTransport(row));
    } catch (err) {
      next(err);
    }
  },
);

operationsRouter.patch(
  '/transport/:id',
  requirePermission('vehicle.update'),
  validateBody(transportSchema.partial()),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const row = await withTransaction(async (client) =>
        updateTransportTx(client, orgId, req.params.id, req.body as never, user),
      );
      res.json(m.mapTransport(row));
    } catch (err) {
      next(err);
    }
  },
);

// --- CRM: interactions + offers ---------------------------------------------
operationsRouter.post(
  '/customers/:id/interactions',
  requirePermission('customer.create'),
  validateBody(
    z.object({
      type: z.enum(['Call', 'Email', 'WhatsApp', 'Visit', 'Test drive']),
      date: dateField,
      notes: z.string().max(5000).optional(),
      salesperson: z.string().max(200).optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as { type: string; date: string; notes?: string; salesperson?: string };
      const row = await withTransaction(async (client) => {
        const customer = await client.query(
          `SELECT id, name FROM dealer.customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [req.params.id, orgId],
        );
        if (customer.rows.length === 0) throw notFound('Customer not found');
        const inserted = await client.query(
          `INSERT INTO dealer.customer_interactions
             (organization_id, customer_id, type, date, notes, salesperson)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            orgId,
            req.params.id,
            body.type,
            body.date,
            body.notes ?? '',
            body.salesperson ?? user.displayName,
          ],
        );
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'INTERACTION_RECORDED',
          entityType: 'Interaction',
          entityId: inserted.rows[0].id as string,
          summary: `${body.type} with ${customer.rows[0].name as string} recorded.`,
        });
        return inserted.rows[0] as Record<string, unknown>;
      });
      res.status(201).json(m.mapInteraction(row));
    } catch (err) {
      next(err);
    }
  },
);

operationsRouter.get(
  '/customers/:id/interactions',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { page, limit } = req.query as unknown as PaginationParams;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.customer_interactions
          WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
        [orgId, req.params.id],
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.customer_interactions
          WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL
          ORDER BY date DESC LIMIT $3 OFFSET $4`,
        [orgId, req.params.id, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapInteraction(r as Record<string, unknown>)),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

operationsRouter.post(
  '/offers',
  requirePermission('deal.create'),
  validateBody(
    z.object({
      vehicleId: z.string().uuid(),
      customerId: z.string().uuid(),
      amount: z.number().min(0),
      date: dateField,
      status: z.enum(['Open', 'Accepted', 'Declined', 'Expired']).optional(),
      notes: z.string().max(5000).optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as {
        vehicleId: string; customerId: string; amount: number; date: string; status?: string; notes?: string;
      };
      const row = await withTransaction(async (client) => {
        const vehicle = await client.query(
          `SELECT id FROM dealer.vehicles WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [body.vehicleId, orgId],
        );
        if (vehicle.rows.length === 0) throw notFound('Vehicle not found');
        const customer = await client.query(
          `SELECT id FROM dealer.customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [body.customerId, orgId],
        );
        if (customer.rows.length === 0) throw notFound('Customer not found');
        const inserted = await client.query(
          `INSERT INTO dealer.offers
             (organization_id, vehicle_id, customer_id, amount, date, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [orgId, body.vehicleId, body.customerId, body.amount, body.date, body.status ?? 'Open', body.notes ?? ''],
        );
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'OFFER_CREATED',
          entityType: 'Offer',
          entityId: inserted.rows[0].id as string,
          summary: `Offer of $${body.amount} recorded for vehicle ${body.vehicleId}.`,
        });
        return inserted.rows[0] as Record<string, unknown>;
      });
      res.status(201).json(m.mapOffer(row));
    } catch (err) {
      next(err);
    }
  },
);

operationsRouter.get(
  '/offers',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { q, status, page, limit } = req.query as unknown as PaginationParams;
      const where: string[] = ['organization_id = $1', 'deleted_at IS NULL'];
      const params: unknown[] = [orgId];
      if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`notes ILIKE $${params.length}`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.offers ${whereSql}`,
        params,
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.offers ${whereSql} ORDER BY date DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapOffer(r as Record<string, unknown>)),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

operationsRouter.get('/offers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const { rows } = await query(
      `SELECT * FROM dealer.offers WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [orgId, req.params.id],
    );
    if (rows.length === 0) throw notFound('Offer not found');
    res.json(m.mapOffer(rows[0] as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

operationsRouter.patch(
  '/offers/:id',
  requirePermission('deal.create'),
  validateBody(
    z.object({
      amount: z.number().min(0).optional(),
      status: z.enum(['Open', 'Accepted', 'Declined', 'Expired']).optional(),
      notes: z.string().max(5000).optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as { amount?: number; status?: string; notes?: string };
      const row = await withTransaction(async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (body.amount !== undefined) { values.push(body.amount); sets.push(`amount = $${values.length}`); }
        if (body.status !== undefined) { values.push(body.status); sets.push(`status = $${values.length}`); }
        if (body.notes !== undefined) { values.push(body.notes); sets.push(`notes = $${values.length}`); }
        if (sets.length === 0) throw new Error('Nothing to update');
        values.push(req.params.id, orgId);
        const updated = await client.query(
          `UPDATE dealer.offers SET ${sets.join(', ')}, updated_at = now()
            WHERE id = $${values.length - 1} AND organization_id = $${values.length}
              AND deleted_at IS NULL RETURNING *`,
          values,
        );
        if (updated.rows.length === 0) throw notFound('Offer not found');
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'OFFER_UPDATED',
          entityType: 'Offer',
          entityId: req.params.id,
          summary: `Offer ${req.params.id} updated.`,
        });
        return updated.rows[0] as Record<string, unknown>;
      });
      res.json(m.mapOffer(row));
    } catch (err) {
      next(err);
    }
  },
);

// Re-exported so other route modules can share the lead-stage list.
export { LEAD_STAGES, EXPENSE_CATEGORIES };
