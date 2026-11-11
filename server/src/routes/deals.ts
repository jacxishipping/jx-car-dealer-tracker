// Deal creation + atomic finalisation.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validateBody } from '../middleware/validate';
import * as m from '../lib/mappers';
import { createDealTx, finalizeSaleTx } from '../lib/services';

export const dealsRouter = Router();
dealsRouter.use(authenticate);

const dealSchema = z.object({
  vehicleId: z.string().uuid(),
  customerId: z.string().uuid(),
  salesperson: z.string().max(200).optional(),
  sellingPrice: z.number().min(0),
  discount: z.number().min(0).optional(),
  taxes: z.number().min(0).optional(),
  fees: z.number().min(0).optional(),
  deposit: z.number().min(0).optional(),
  tradeInValue: z.number().min(0).optional(),
  tradeInDesc: z.string().max(1000).optional(),
  paymentMethod: z.string().max(100).optional(),
});

dealsRouter.post(
  '/',
  requirePermission('deal.create'),
  validateBody(dealSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const row = await withTransaction(async (client) =>
        createDealTx(client, orgId, req.body as never, user),
      );
      res.status(201).json(m.mapDeal(row));
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/deals/:id/finalize — one atomic transaction (see services.ts).
dealsRouter.post(
  '/:id/finalize',
  requirePermission('sale.finalize'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const { sale } = await withTransaction(async (client) =>
        finalizeSaleTx(client, orgId, req.params.id, user),
      );
      res.json({ sale: m.mapSale(sale) });
    } catch (err) {
      next(err);
    }
  },
);
