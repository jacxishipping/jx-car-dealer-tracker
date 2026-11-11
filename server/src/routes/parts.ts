// Parts: batch receipt, FIFO allocation, allocation returns, and nested
// batch / movement / allocation lists.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { paginationSchema, validateBody, validateQuery, type PaginationParams } from '../middleware/validate';
import { notFound } from '../lib/errors';
import * as m from '../lib/mappers';
import { allocatePartTx, receiveBatchTx, returnAllocationTx } from '../lib/services';

export const partsRouter = Router();
partsRouter.use(authenticate);

async function requirePart(orgId: string, partId: string): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM dealer.parts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [partId, orgId],
  );
  if (rows.length === 0) throw notFound('Part not found');
}

// POST /api/parts/:id/batches — receive a batch + purchase movement.
partsRouter.post(
  '/:id/batches',
  requirePermission('vehicle.create'),
  validateBody(
    z.object({
      qty: z.number().int().positive(),
      unitPrice: z.number().min(0),
      invoice: z.string().max(200).optional(),
      purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchaseDate must be YYYY-MM-DD').optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const row = await withTransaction(async (client) => {
        await requirePart(orgId, req.params.id);
        return receiveBatchTx(client, orgId, req.params.id, req.body as never, user);
      });
      res.status(201).json(m.mapPartBatch(row));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/parts/:id/batches
partsRouter.get(
  '/:id/batches',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      await requirePart(orgId, req.params.id);
      const { page, limit } = req.query as unknown as PaginationParams;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.part_batches
          WHERE organization_id = $1 AND part_id = $2 AND deleted_at IS NULL`,
        [orgId, req.params.id],
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.part_batches
          WHERE organization_id = $1 AND part_id = $2 AND deleted_at IS NULL
          ORDER BY purchase_date ASC LIMIT $3 OFFSET $4`,
        [orgId, req.params.id, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapPartBatch(r as Record<string, unknown>)),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/parts/:id/movements
partsRouter.get(
  '/:id/movements',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      await requirePart(orgId, req.params.id);
      const { page, limit } = req.query as unknown as PaginationParams;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.part_movements
          WHERE organization_id = $1 AND part_id = $2`,
        [orgId, req.params.id],
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.part_movements
          WHERE organization_id = $1 AND part_id = $2
          ORDER BY date DESC, created_at DESC LIMIT $3 OFFSET $4`,
        [orgId, req.params.id, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map((r) => m.mapPartMovement(r as Record<string, unknown>)),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/parts/:id/allocations (with FIFO slices)
partsRouter.get(
  '/:id/allocations',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      await requirePart(orgId, req.params.id);
      const { page, limit } = req.query as unknown as PaginationParams;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.part_allocations
          WHERE organization_id = $1 AND part_id = $2 AND deleted_at IS NULL`,
        [orgId, req.params.id],
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query(
        `SELECT * FROM dealer.part_allocations
          WHERE organization_id = $1 AND part_id = $2 AND deleted_at IS NULL
          ORDER BY date DESC LIMIT $3 OFFSET $4`,
        [orgId, req.params.id, limit, offset],
      );
      const ids = rowsRes.rows.map((r) => r.id as string);
      const slicesByAllocation = new Map<string, Array<{ batchId: string; qty: number; unitPrice: number }>>();
      if (ids.length > 0) {
        const slices = await query(
          `SELECT allocation_id, batch_id, qty, unit_price FROM dealer.part_allocation_slices
            WHERE allocation_id = ANY($1::uuid[])`,
          [ids],
        );
        for (const s of slices.rows) {
          const key = s.allocation_id as string;
          if (!slicesByAllocation.has(key)) slicesByAllocation.set(key, []);
          slicesByAllocation.get(key)!.push({
            batchId: s.batch_id as string,
            qty: Number(s.qty),
            unitPrice: Number(s.unit_price),
          });
        }
      }
      res.json({
        data: rowsRes.rows.map((r) => {
          const a = m.mapPartAllocation(r as Record<string, unknown>);
          a.batches = slicesByAllocation.get(a.id as string) ?? [];
          return a;
        }),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/parts/:id/allocate — FIFO consume (oldest first).
partsRouter.post(
  '/:id/allocate',
  requirePermission('part.allocate'),
  validateBody(
    z.object({
      vehicleId: z.string().uuid(),
      qty: z.number().int().positive(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as { vehicleId: string; qty: number };
      const result = await withTransaction(async (client) =>
        allocatePartTx(client, orgId, req.params.id, body.vehicleId, body.qty, user),
      );
      res.status(201).json({
        allocation: m.mapPartAllocation({
          ...result.allocation,
          batches: result.slices,
        }),
        slices: result.slices,
        fifoCost: result.fifoCost,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/parts/:id/return — reverse part of an allocation.
partsRouter.post(
  '/:id/return',
  requirePermission('part.allocate'),
  validateBody(
    z.object({
      allocationId: z.string().uuid(),
      qty: z.number().int().positive(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as { allocationId: string; qty: number };
      const result = await withTransaction(async (client) =>
        returnAllocationTx(client, orgId, req.params.id, body.allocationId, body.qty, user),
      );
      res.json({
        allocation: m.mapPartAllocation({
          ...result.allocation,
          batches: [],
        }),
        restored: result.restored,
      });
    } catch (err) {
      next(err);
    }
  },
);
