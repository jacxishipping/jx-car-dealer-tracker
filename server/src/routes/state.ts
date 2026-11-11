// GET /api/state — the full snapshot in frontend AppState shape (camelCase,
// same field names as src/store/types.ts), plus organization, currentRole
// and currentUser. Settings row is created on first read if missing.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { query } from '../db';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { getOrgSettings } from '../lib/costing';
import { withTransaction } from '../db';
import * as m from '../lib/mappers';
import { num } from '../lib/money';

export const stateRouter = Router();
stateRouter.use(authenticate);

stateRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    const user = requireUser(req);

    const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));

    const [
      vehiclesRes, purchasesRes, transportRes, expensesRes, reconRes,
      partsRes, batchesRes, movementsRes, allocationsRes, slicesRes,
      customersRes, leadsRes, interactionsRes, offersRes, dealsRes,
      salesRes, accountsRes, transactionsRes, journalRes, journalLinesRes,
      receivablesRes, documentsRes, teamRes, auditRes, notificationsRes,
      photosRes, orgRes,
    ] = await Promise.all([
      query(`SELECT * FROM dealer.vehicles WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.vehicle_purchases WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.transportation_orders WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]),
      query(`SELECT e.*, u.display_name AS created_by_name FROM dealer.expenses e LEFT JOIN dealer.users u ON u.id = e.created_by WHERE e.organization_id = $1 AND e.deleted_at IS NULL ORDER BY e.date DESC, e.created_at DESC`, [orgId]),
      query(`SELECT r.*, ec.name AS category_name FROM dealer.reconditioning_jobs r LEFT JOIN dealer.expense_categories ec ON ec.id = r.category_id WHERE r.organization_id = $1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.parts WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name ASC`, [orgId]),
      query(`SELECT * FROM dealer.part_batches WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY purchase_date ASC`, [orgId]),
      query(`SELECT * FROM dealer.part_movements WHERE organization_id = $1 ORDER BY date DESC, created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.part_allocations WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY date DESC`, [orgId]),
      query(`SELECT s.allocation_id, s.batch_id, s.qty, s.unit_price FROM dealer.part_allocation_slices s JOIN dealer.part_allocations a ON a.id = s.allocation_id WHERE a.organization_id = $1`, [orgId]),
      query(`SELECT * FROM dealer.customers WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name ASC`, [orgId]),
      query(`SELECT * FROM dealer.leads WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.customer_interactions WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY date DESC`, [orgId]),
      query(`SELECT * FROM dealer.offers WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY date DESC`, [orgId]),
      query(`SELECT d.*, s.ref AS sale_ref FROM dealer.deals d LEFT JOIN dealer.sales s ON s.id = d.sale_id WHERE d.organization_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.sales WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY date DESC`, [orgId]),
      query(`SELECT * FROM dealer.accounts WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`, [orgId]),
      query(`SELECT * FROM dealer.financial_transactions WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY date DESC, created_at DESC`, [orgId]),
      query(`SELECT * FROM dealer.journal_entries WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]),
      query(`SELECT l.* FROM dealer.journal_entry_lines l JOIN dealer.journal_entries e ON e.id = l.entry_id WHERE e.organization_id = $1`, [orgId]),
      query(`SELECT * FROM dealer.receivables WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY due_date ASC`, [orgId]),
      query(`SELECT d.*, u.display_name AS uploaded_by_name FROM dealer.documents d LEFT JOIN dealer.users u ON u.id = d.uploaded_by WHERE d.organization_id = $1 AND d.deleted_at IS NULL ORDER BY d.uploaded_at DESC`, [orgId]),
      query(`SELECT om.id, u.display_name, u.email, r.name AS role_name, om.active FROM dealer.organization_members om JOIN dealer.users u ON u.id = om.user_id JOIN dealer.roles r ON r.id = om.role_id WHERE om.organization_id = $1 AND om.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY u.display_name ASC`, [orgId]),
      query(`SELECT * FROM dealer.audit_logs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 500`, [orgId]),
      query(`SELECT * FROM dealer.notifications WHERE organization_id = $1 AND (user_id IS NULL OR user_id = $2) AND deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 200`, [orgId, user.id]),
      query(`SELECT vehicle_id, file_name FROM dealer.vehicle_photos WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC`, [orgId]),
      query(`SELECT id, name FROM dealer.organizations WHERE id = $1`, [orgId]),
    ]);

    const photosByVehicle = new Map<string, string[]>();
    for (const row of photosRes.rows) {
      const key = row.vehicle_id as string;
      if (!photosByVehicle.has(key)) photosByVehicle.set(key, []);
      photosByVehicle.get(key)!.push(row.file_name as string);
    }

    const slicesByAllocation = new Map<string, Array<{ batchId: string; qty: number; unitPrice: number }>>();
    for (const row of slicesRes.rows) {
      const key = row.allocation_id as string;
      if (!slicesByAllocation.has(key)) slicesByAllocation.set(key, []);
      slicesByAllocation.get(key)!.push({
        batchId: row.batch_id as string,
        qty: Number(row.qty),
        unitPrice: num(row.unit_price),
      });
    }

    const linesByEntry = new Map<string, Record<string, unknown>[]>();
    for (const row of journalLinesRes.rows) {
      const key = (row as Record<string, unknown>).entry_id as string;
      if (!linesByEntry.has(key)) linesByEntry.set(key, []);
      linesByEntry.get(key)!.push(row as Record<string, unknown>);
    }

    const org = orgRes.rows[0] as Record<string, unknown> | undefined;

    res.json({
      vehicles: vehiclesRes.rows.map((r) => {
        const v = m.mapVehicle(r as Record<string, unknown>);
        v.photos = photosByVehicle.get(v.id as string) ?? [];
        return v;
      }),
      purchases: purchasesRes.rows.map((r) => m.mapPurchase(r as Record<string, unknown>)),
      transport: transportRes.rows.map((r) => m.mapTransport(r as Record<string, unknown>)),
      expenses: expensesRes.rows.map((r) => m.mapExpense(r as Record<string, unknown>)),
      reconJobs: reconRes.rows.map((r) => m.mapRecon(r as Record<string, unknown>)),
      parts: partsRes.rows.map((r) => m.mapPart(r as Record<string, unknown>)),
      partBatches: batchesRes.rows.map((r) => m.mapPartBatch(r as Record<string, unknown>)),
      partMovements: movementsRes.rows.map((r) => m.mapPartMovement(r as Record<string, unknown>)),
      partAllocations: allocationsRes.rows.map((r) => {
        const a = m.mapPartAllocation(r as Record<string, unknown>);
        a.batches = slicesByAllocation.get(a.id as string) ?? [];
        return a;
      }),
      customers: customersRes.rows.map((r) => m.mapCustomer(r as Record<string, unknown>)),
      leads: leadsRes.rows.map((r) => m.mapLead(r as Record<string, unknown>)),
      interactions: interactionsRes.rows.map((r) => m.mapInteraction(r as Record<string, unknown>)),
      offers: offersRes.rows.map((r) => m.mapOffer(r as Record<string, unknown>)),
      deals: dealsRes.rows.map((r) => m.mapDeal(r as Record<string, unknown>)),
      sales: salesRes.rows.map((r) => m.mapSale(r as Record<string, unknown>)),
      accounts: accountsRes.rows.map((r) => m.mapAccount(r as Record<string, unknown>)),
      transactions: transactionsRes.rows.map((r) => m.mapTransaction(r as Record<string, unknown>)),
      journal: journalRes.rows.map((r) =>
        m.mapJournal(r as Record<string, unknown>, linesByEntry.get((r as Record<string, unknown>).id as string) ?? []),
      ),
      receivables: receivablesRes.rows.map((r) => m.mapReceivable(r as Record<string, unknown>)),
      documents: documentsRes.rows.map((r) => m.mapDocument(r as Record<string, unknown>)),
      team: teamRes.rows.map((r) => m.mapTeamMember(r as Record<string, unknown>)),
      audit: auditRes.rows.map((r) => m.mapAudit(r as Record<string, unknown>)),
      notifications: notificationsRes.rows.map((r) => m.mapNotification(r as Record<string, unknown>)),
      settings: {
        orgName: settings.orgName,
        currency: settings.currency,
        targetHoldDays: settings.targetHoldDays,
        overheadPerVehicle: settings.overheadPerVehicle,
        theme: settings.theme,
      },
      organization: org ? { id: org.id, name: org.name } : { id: orgId, name: settings.orgName },
      currentRole: req.role ?? 'Viewer',
      currentUser: user.displayName,
    });
  } catch (err) {
    next(err);
  }
});
