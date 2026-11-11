// AI Assistant operations — deterministic parser (no AI backend), explicit
// confirm-before-execute, sensitive operations NEVER executed from a command.
// Flow: POST /api/ai/operations { command } → proposed operation (stored in
// dealer.ai_operations) → POST /api/ai/operations/:id/confirm { confirm } →
// executes non-sensitive writes via the same transactional services, or
// rejects sensitive ones with 403.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { paginationSchema, validateBody, validateQuery, type PaginationParams } from '../middleware/validate';
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors';
import { insertAudit } from '../lib/audit';
import { parseCommand, describeParsed, type ParsedCommand } from '../lib/ai-parser';
import { getOrgSettings, vehicleAllInCostDb } from '../lib/costing';
import { insertVehicleTx, loadOrgVehicles, resolveVehicleRef } from '../lib/vehicles';
import { recordExpenseTx, today } from '../lib/services';
import { money, num } from '../lib/money';
import * as m from '../lib/mappers';

export const aiRouter = Router();
aiRouter.use(authenticate);

interface OperationRow {
  id: string;
  raw_command: string;
  parsed_kind: string;
  parsed_payload: Record<string, unknown>;
  status: string;
  result_summary: string;
  created_at: Date;
}

function mapOperation(row: OperationRow): Record<string, unknown> {
  return {
    id: row.id,
    command: row.raw_command,
    parsedKind: row.parsed_kind,
    parsedPayload: row.parsed_payload,
    status: row.status,
    summary: row.result_summary,
    sensitive: row.parsed_kind === 'sensitive',
  };
}

async function runQuery(
  orgId: string,
  parsed: ParsedCommand,
): Promise<Record<string, unknown> | null> {
  if (parsed.kind === 'query_aged') {
    const res = await query(
      `SELECT * FROM dealer.vehicles
        WHERE organization_id = $1 AND status <> 'Sold' AND deleted_at IS NULL
          AND purchase_date < CURRENT_DATE - ($2::int * INTERVAL '1 day')
        ORDER BY purchase_date ASC`,
      [orgId, parsed.days],
    );
    const vehicles = res.rows.map((r) => m.mapVehicle(r as Record<string, unknown>));
    return { kind: 'query_aged', days: parsed.days, count: vehicles.length, vehicles };
  }
  if (parsed.kind === 'query_losing') {
    const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));
    const vehiclesRes = await query(
      `SELECT * FROM dealer.vehicles
        WHERE organization_id = $1 AND status <> 'Sold' AND deleted_at IS NULL`,
      [orgId],
    );
    const losing: Record<string, unknown>[] = [];
    // Compute all-in cost per vehicle from DB rows (same engine as finalize).
    await withTransaction(async (client) => {
      for (const row of vehiclesRes.rows) {
        const allIn = await vehicleAllInCostDb(
          client,
          orgId,
          row.id as string,
          {
            purchasePrice: num(row.purchase_price),
            auctionFees: num(row.auction_fees),
            transportCost: num(row.transport_cost),
          },
          settings.overheadPerVehicle,
        );
        if (num(row.asking_price) < allIn) {
          const v = m.mapVehicle(row as Record<string, unknown>);
          losing.push({ ...v, allInCost: allIn, shortfall: money(allIn - num(row.asking_price)) });
        }
      }
    });
    return { kind: 'query_losing', count: losing.length, vehicles: losing };
  }
  if (parsed.kind === 'query_followups') {
    const res = await query(
      `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone, c.preferred_contact
         FROM dealer.leads l JOIN dealer.customers c ON c.id = l.customer_id
        WHERE l.organization_id = $1 AND l.stage NOT IN ('Sold', 'Lost')
          AND l.follow_up_date < CURRENT_DATE AND l.deleted_at IS NULL
        ORDER BY l.follow_up_date ASC`,
      [orgId],
    );
    return {
      kind: 'query_followups',
      count: res.rows.length,
      followups: res.rows.map((r) => ({
        lead: m.mapLead(r as Record<string, unknown>),
        customer: {
          id: r.customer_id,
          name: r.customer_name,
          phone: r.customer_phone,
          preferredContact: r.preferred_contact,
        },
      })),
    };
  }
  return null;
}

aiRouter.post(
  '/operations',
  requirePermission('ai.execute'),
  validateBody(z.object({ command: z.string().trim().min(1).max(2000) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const { command } = req.body as { command: string };
      const parsed = parseCommand(command);
      const summary = describeParsed(parsed);
      const payload: Record<string, unknown> =
        parsed.kind === 'unknown'
          ? {}
          : parsed.kind === 'sensitive'
            ? { action: parsed.action, detail: parsed.detail }
            : { ...parsed, kind: undefined };
      const inserted = await query<OperationRow>(
        `INSERT INTO dealer.ai_operations
           (organization_id, user_id, raw_command, parsed_kind, parsed_payload, status, result_summary)
         VALUES ($1,$2,$3,$4,$5,'proposed',$6)
         RETURNING *`,
        [orgId, user.id, command, parsed.kind, JSON.stringify(payload), summary],
      );
      const operation = mapOperation(inserted.rows[0]);
      const result =
        parsed.kind === 'query_aged' || parsed.kind === 'query_losing' || parsed.kind === 'query_followups'
          ? await runQuery(orgId, parsed)
          : null;
      res.status(201).json({ operation, ...(result ? { result } : {}) });
    } catch (err) {
      next(err);
    }
  },
);

aiRouter.get(
  '/operations',
  validateQuery(paginationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const { page, limit } = req.query as unknown as PaginationParams;
      const count = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dealer.ai_operations WHERE organization_id = $1`,
        [orgId],
      );
      const offset = (page - 1) * limit;
      const rowsRes = await query<OperationRow>(
        `SELECT * FROM dealer.ai_operations WHERE organization_id = $1
          ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [orgId, limit, offset],
      );
      res.json({
        data: rowsRes.rows.map(mapOperation),
        total: Number(count.rows[0]?.count ?? 0),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

aiRouter.get('/operations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const { rows } = await query<OperationRow>(
      `SELECT * FROM dealer.ai_operations WHERE organization_id = $1 AND id = $2`,
      [orgId, req.params.id],
    );
    if (rows.length === 0) throw notFound('Operation not found');
    res.json(mapOperation(rows[0]));
  } catch (err) {
    next(err);
  }
});

const confirmSchema = z.object({
  confirm: z.boolean(),
  // Required to execute create_vehicle: the parser never invents a VIN.
  vin: z.string().trim().min(11).max(17).optional(),
  stockNumber: z.string().trim().min(1).max(50).optional(),
  askingPrice: z.number().min(0).optional(),
});

aiRouter.post(
  '/operations/:id/confirm',
  requirePermission('ai.execute'),
  validateBody(confirmSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = requireOrgId(req);
      const user = requireUser(req);
      const body = req.body as z.infer<typeof confirmSchema>;

      const { rows } = await query<OperationRow>(
        `SELECT * FROM dealer.ai_operations WHERE organization_id = $1 AND id = $2`,
        [orgId, req.params.id],
      );
      if (rows.length === 0) throw notFound('Operation not found');
      const op = rows[0];
      if (op.status !== 'proposed') {
        throw new ApiError(409, `Operation is ${op.status} and can no longer be confirmed`, 'CONFLICT');
      }
      const parsed = op.parsed_payload as Record<string, unknown>;
      const kind = op.parsed_kind;

      if (body.confirm === false) {
        await query(
          `UPDATE dealer.ai_operations SET status = 'cancelled', result_summary = $1 WHERE id = $2`,
          ['Cancelled by the user — nothing was executed.', op.id],
        );
        return res.json({ operation: { ...mapOperation(op), status: 'cancelled', summary: 'Cancelled by the user — nothing was executed.' } });
      }

      // Sensitive commands are NEVER executed — mark rejected and refuse.
      if (kind === 'sensitive') {
        await query(
          `UPDATE dealer.ai_operations SET status = 'rejected',
             result_summary = 'Rejected: sensitive operations are never executed from a text command.'
           WHERE id = $1`,
          [op.id],
        );
        throw forbidden(
          'Sensitive operation — sales, purchases, payments, refunds and deletions are never executed from a text command. Complete it in the Sales, Purchases or Finance module.',
        );
      }
      if (kind === 'unknown') {
        await query(`UPDATE dealer.ai_operations SET status = 'rejected' WHERE id = $1`, [op.id]);
        throw badRequest('Could not understand that command — nothing was executed.');
      }

      // Query operations need no write: mark executed and return live results.
      if (kind === 'query_aged' || kind === 'query_losing' || kind === 'query_followups') {
        const result = await runQuery(orgId, parseCommand(op.raw_command));
        await query(
          `UPDATE dealer.ai_operations SET status = 'executed' WHERE id = $1`,
          [op.id],
        );
        return res.json({
          operation: { ...mapOperation(op), status: 'executed' },
          ...(result ? { result } : {}),
        });
      }

      // Non-sensitive writes execute via the same transactional services.
      const executed = await withTransaction(async (client) => {
        if (kind === 'create_vehicle') {
          const vin = body.vin?.toUpperCase();
          if (!vin) {
            throw badRequest('A VIN is required before confirming — the assistant never invents a VIN.');
          }
          const price = num(parsed.price);
          const vehicle = await insertVehicleTx(client, orgId, {
            stockNumber: body.stockNumber,
            vin,
            year: Number(parsed.year),
            make: String(parsed.make),
            model: String(parsed.model),
            trim: '',
            extColor: '',
            intColor: '',
            mileage: 0,
            transmission: 'Automatic',
            engine: '',
            fuel: 'Petrol',
            drivetrain: 'FWD',
            bodyType: 'Sedan',
            condition: 'Good',
            titleStatus: 'Clean',
            status: 'Purchased',
            purchaseDate: today(),
            purchaseSource: 'Other dealer',
            purchasePrice: price,
            auctionFees: 0,
            transportCost: 0,
            askingPrice: body.askingPrice ?? price,
            minPrice: price,
            notes: 'Added via AI Assistant (deterministic parser).',
          });
          await insertAudit(client, {
            orgId,
            actorId: user.id,
            actorName: user.displayName,
            action: 'VEHICLE_CREATED',
            entityType: 'Vehicle',
            entityId: vehicle.id as string,
            summary: `Vehicle ${vehicle.stock_number as string} (${parsed.year as number} ${parsed.make as string} ${parsed.model as string}) registered via AI Assistant.`,
          });
          return {
            summary: `Vehicle created: ${vehicle.stock_number as string} — ${parsed.year as number} ${parsed.make as string} ${parsed.model as string} for $${price}.`,
            data: { vehicle: m.mapVehicle(vehicle) },
          };
        }

        if (kind === 'record_transport' || kind === 'record_expense') {
          const isTransport = kind === 'record_transport';
          const ref = isTransport ? String(parsed.stockNumber) : String(parsed.vehicleRef);
          const vehicles = await loadOrgVehicles(client, orgId);
          const vehicle = resolveVehicleRef(vehicles, ref);
          if (!vehicle) {
            throw badRequest(`Could not find a vehicle matching "${ref}". Check the stock number or make and try again — nothing was recorded.`);
          }
          const category = isTransport ? 'Transportation' : String(parsed.category);
          const amount = money(num(parsed.amount));
          await recordExpenseTx(
            client,
            orgId,
            {
              description: isTransport
                ? `Transport — ${vehicle.stockNumber}`
                : `${category} — ${vehicle.stockNumber}`,
              amount,
              category,
              date: today(),
              vendor: '',
              vehicleId: vehicle.id,
              kind: 'Direct',
              paymentMethod: 'Bank transfer',
              status: 'Pending',
              invoiceRef: '',
              notes: 'Recorded via AI Assistant (deterministic parser).',
            },
            user,
          );
          return {
            summary: `${category} expense of $${amount} recorded for ${vehicle.stockNumber} (${vehicle.make} ${vehicle.model}).`,
            data: { vehicleId: vehicle.id, stockNumber: vehicle.stockNumber, amount, category },
          };
        }

        throw badRequest(`Unsupported operation kind "${kind}".`);
      });

      await query(
        `UPDATE dealer.ai_operations SET status = 'executed', result_summary = $1 WHERE id = $2`,
        [executed.summary, op.id],
      );
      return res.json({
        operation: { ...mapOperation(op), status: 'executed', summary: executed.summary },
        ...executed.data,
      });
    } catch (err) {
      next(err);
    }
  },
);
