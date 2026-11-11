// Append-only audit log. Every write goes through here, inside the caller's
// transaction, so an audit row and the change it describes commit together.
// Audit rows are never updated or deleted.
import type { PoolClient } from 'pg';

export interface AuditInput {
  orgId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
}

export async function insertAudit(client: PoolClient, input: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO dealer.audit_logs
       (organization_id, actor_id, actor_name, action, entity_type, entity_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.orgId,
      input.actorId,
      input.actorName,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
    ],
  );
}
