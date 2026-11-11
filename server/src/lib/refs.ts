// Human-readable refs (ACQ-0001, DEAL-0001, SALE-0001, JE-0001) and stock
// numbers (CDT-101…). Numbering is per-organization and gap-safe under
// concurrency: the caller must already be inside a transaction, and the
// per-org advisory lock serialises ref generation for that prefix.

import type { PoolClient } from 'pg';

export type RefPrefix = 'ACQ' | 'DEAL' | 'SALE' | 'JE';

/** Pure formatter — unit-tested. `formatRef('ACQ', 1)` → `'ACQ-0001'`. */
export function formatRef(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

const REF_TABLES: Record<RefPrefix, { table: string; column: string }> = {
  ACQ: { table: 'dealer.vehicle_purchases', column: 'ref' },
  DEAL: { table: 'dealer.deals', column: 'ref' },
  SALE: { table: 'dealer.sales', column: 'ref' },
  JE: { table: 'dealer.journal_entries', column: 'ref' },
};

/**
 * Next ref for `prefix` within `orgId`. Must be called inside a transaction
 * (uses pg_advisory_xact_lock, released at COMMIT/ROLLBACK).
 */
export async function nextRef(
  client: PoolClient,
  orgId: string,
  prefix: RefPrefix,
): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${orgId}:${prefix}`]);
  const { table, column } = REF_TABLES[prefix];
  const res = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(${column}, '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_n
       FROM ${table} WHERE organization_id = $1`,
    [orgId],
  );
  const maxN = Number(res.rows[0]?.max_n ?? 0);
  return formatRef(prefix, maxN + 1);
}

/** Next stock number for the org: CDT-101, CDT-102, … (max numeric suffix + 1). */
export async function nextStockNumber(client: PoolClient, orgId: string): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${orgId}:STOCK`]);
  const res = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(stock_number, '\\D', '', 'g'), '') AS INTEGER)), 100) AS max_n
       FROM dealer.vehicles WHERE organization_id = $1`,
    [orgId],
  );
  const maxN = Number(res.rows[0]?.max_n ?? 100);
  return `CDT-${Math.max(100, maxN) + 1}`;
}
