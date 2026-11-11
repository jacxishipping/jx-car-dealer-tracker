// Finance operations: receivable payments, account transfers, journal reversal.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validateBody } from '../middleware/validate';
import * as m from '../lib/mappers';
import { recordPaymentTx, reverseJournalTx, transferTx } from '../lib/services';

export const financeRouter = Router();
financeRouter.use(authenticate);

// POST /api/receivables/:id/payments — rejects amount > outstanding (400).
financeRouter.post(
  '/receivables/:id/payments',
  requirePermission('payment.record'),
  validateBody(
    z.object({
      amount: z.number().positive(),
      accountId: z.string().uuid(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as { amount: number; accountId: string };
      const { receivable } = await withTransaction(async (client) =>
        recordPaymentTx(client, orgId, req.params.id, body.amount, body.accountId, user),
      );
      res.status(201).json(m.mapReceivable(receivable));
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/transactions/transfer — two signed transactions + one journal entry.
financeRouter.post(
  '/transactions/transfer',
  requirePermission('finance.write'),
  validateBody(
    z.object({
      fromAccountId: z.string().uuid(),
      toAccountId: z.string().uuid(),
      amount: z.number().positive(),
      note: z.string().max(500).optional(),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as {
        fromAccountId: string;
        toAccountId: string;
        amount: number;
        note?: string;
      };
      const result = await withTransaction(async (client) =>
        transferTx(client, orgId, body.fromAccountId, body.toAccountId, body.amount, body.note ?? '', user),
      );
      res.status(201).json({ ok: true, journalRef: result.ref });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/journal/:id/reverse — negated reversal entry; originals never edited.
financeRouter.post(
  '/journal/:id/reverse',
  requirePermission('finance.write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const result = await withTransaction(async (client) =>
        reverseJournalTx(client, orgId, req.params.id, user),
      );
      res.status(201).json({
        reversal: result.reversal,
        original: m.mapJournal(result.original),
      });
    } catch (err) {
      next(err);
    }
  },
);
