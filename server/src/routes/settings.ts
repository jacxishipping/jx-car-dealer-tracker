// GET /api/settings + PATCH /api/settings. The settings row is created on
// first read if missing; PATCH updates both dealer.settings and the mirrored
// fields on dealer.organizations (name/currency).
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validateBody } from '../middleware/validate';
import { insertAudit } from '../lib/audit';
import { getOrgSettings } from '../lib/costing';
import { money } from '../lib/money';

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));
    res.json({
      orgName: settings.orgName,
      currency: settings.currency,
      targetHoldDays: settings.targetHoldDays,
      overheadPerVehicle: settings.overheadPerVehicle,
      theme: settings.theme,
    });
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  orgName: z.string().trim().min(1).max(200).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  targetHoldDays: z.number().int().min(0).max(3650).optional(),
  overheadPerVehicle: z.number().min(0).optional(),
  theme: z.enum(['light', 'dark']).optional(),
});

settingsRouter.patch(
  '/',
  requirePermission('settings.write'),
  validateBody(settingsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as z.infer<typeof settingsSchema>;
      const updated = await withTransaction(async (client) => {
        const settings = await getOrgSettings(client, orgId);
        const next = {
          orgName: body.orgName ?? settings.orgName,
          currency: body.currency ?? settings.currency,
          targetHoldDays: body.targetHoldDays ?? settings.targetHoldDays,
          overheadPerVehicle: body.overheadPerVehicle ?? settings.overheadPerVehicle,
          theme: body.theme ?? settings.theme,
        };
        await client.query(
          `UPDATE dealer.settings
              SET org_name = $1, currency = $2, target_hold_days = $3,
                  overhead_per_vehicle = $4, theme = $5, updated_at = now()
            WHERE organization_id = $6`,
          [next.orgName, next.currency, next.targetHoldDays, money(next.overheadPerVehicle), next.theme, orgId],
        );
        await client.query(
          `UPDATE dealer.organizations
              SET name = $1, currency = $2, target_hold_days = $3,
                  overhead_per_vehicle = $4, updated_at = now()
            WHERE id = $5`,
          [next.orgName, next.currency, next.targetHoldDays, money(next.overheadPerVehicle), orgId],
        );
        await insertAudit(client, {
          orgId,
          actorId: user.id,
          actorName: user.displayName,
          action: 'SETTINGS_UPDATED',
          entityType: 'Settings',
          entityId: orgId,
          summary: 'Organization settings updated.',
        });
        return next;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

