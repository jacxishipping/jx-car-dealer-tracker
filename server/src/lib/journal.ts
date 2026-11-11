// Double-entry journal + financial transactions. Invariant (mirrors the
// frontend store): every money movement posts a balanced journal entry
// alongside its transaction — a balance can never change without a ledger
// entry. Journal entries are append-only; corrections use reversals.
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { nextRef } from './refs';
import { money, num } from './money';

export interface JournalLineInput {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalResult {
  id: string;
  ref: string;
}

/** Insert a balanced journal entry (sum debit must equal sum credit). */
export async function createJournalEntry(
  client: PoolClient,
  orgId: string,
  input: { memo: string; date: string; lines: JournalLineInput[] },
): Promise<JournalResult> {
  const lines = input.lines.map((l) => ({
    account: l.account,
    debit: money(l.debit),
    credit: money(l.credit),
  }));
  const totalDebit = money(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = money(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new ApiError(500, 'Unbalanced journal entry refused', 'UNBALANCED_JOURNAL');
  }
  const ref = await nextRef(client, orgId, 'JE');
  const entry = await client.query(
    `INSERT INTO dealer.journal_entries (organization_id, ref, date, memo)
     VALUES ($1, $2, $3, $4) RETURNING id, ref`,
    [orgId, ref, input.date, input.memo],
  );
  const entryId = entry.rows[0].id as string;
  // Zero/zero lines carry no information; skip them (balance is unaffected).
  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) continue;
    await client.query(
      `INSERT INTO dealer.journal_entry_lines (entry_id, account, debit, credit)
       VALUES ($1, $2, $3, $4)`,
      [entryId, line.account, line.debit, line.credit],
    );
  }
  return { id: entryId, ref };
}

export interface TransactionInput {
  accountId: string;
  type: string;
  amount: number;
  category: string;
  reference: string;
  date: string;
  note: string;
}

/** Insert a signed financial transaction row (amount: + in, − out). */
export async function postTransaction(
  client: PoolClient,
  orgId: string,
  input: TransactionInput,
): Promise<{ id: string }> {
  const res = await client.query(
    `INSERT INTO dealer.financial_transactions
       (organization_id, account_id, type, amount, category, reference, date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      orgId,
      input.accountId,
      input.type,
      money(input.amount),
      input.category,
      input.reference,
      input.date,
      input.note,
    ],
  );
  return { id: res.rows[0].id as string };
}

/**
 * The org's default money account: first Active Bank account, else first
 * Active account, else a freshly created "Operating Bank" account. The
 * frontend demo hardcodes 'acc-bank'; the server resolves the real account.
 */
export async function getDefaultAccount(
  client: PoolClient,
  orgId: string,
): Promise<{ id: string; name: string }> {
  const found = await client.query(
    `SELECT id, name FROM dealer.accounts
      WHERE organization_id = $1 AND status = 'Active' AND deleted_at IS NULL
      ORDER BY CASE WHEN type = 'Bank' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1`,
    [orgId],
  );
  if (found.rows.length > 0) {
    return { id: found.rows[0].id as string, name: found.rows[0].name as string };
  }
  const created = await client.query(
    `INSERT INTO dealer.accounts (organization_id, name, type, currency, opening_balance, status)
     VALUES ($1, 'Operating Bank', 'Bank', 'USD', 0, 'Active') RETURNING id, name`,
    [orgId],
  );
  return { id: created.rows[0].id as string, name: created.rows[0].name as string };
}

/** Current balance of an account: opening balance + signed transactions. */
export async function accountBalance(
  client: PoolClient,
  orgId: string,
  accountId: string,
): Promise<number> {
  const res = await client.query(
    `SELECT a.opening_balance AS opening,
            COALESCE(SUM(t.amount), 0) AS txns
       FROM dealer.accounts a
       LEFT JOIN dealer.financial_transactions t
         ON t.account_id = a.id AND t.deleted_at IS NULL
      WHERE a.id = $1 AND a.organization_id = $2
      GROUP BY a.opening_balance`,
    [accountId, orgId],
  );
  if (res.rows.length === 0) return 0;
  return money(num(res.rows[0].opening) + num(res.rows[0].txns));
}
