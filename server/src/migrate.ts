// Migration runner: reads docs/schema.sql (plus the supplementary offers
// DDL the schema file does not cover) and runs it as one multi-statement
// query inside a single transaction. The schema is idempotent
// (IF NOT EXISTS throughout) — re-running never drops or alters data.
// Prints only the verified table count afterwards; exits non-zero on failure.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { requireDatabaseUrl } from './config';
import { OFFERS_DDL } from './lib/schema-extras';

function findSchemaPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'docs', 'schema.sql'), // src/migrate.ts via tsx
    path.resolve(__dirname, '..', '..', 'docs', 'schema.sql'), // dist/migrate.js
    path.resolve(process.cwd(), 'docs', 'schema.sql'),
    path.resolve(process.cwd(), '..', 'docs', 'schema.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find docs/schema.sql. Looked in: ${candidates.join(', ')}`,
  );
}

async function main(): Promise<void> {
  const connectionString = requireDatabaseUrl();
  const schemaPath = findSchemaPath();
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    await pool.query('BEGIN');
    await pool.query(schemaSql);
    await pool.query(OFFERS_DDL);
    await pool.query('COMMIT');
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'dealer'`,
  );
  console.log(
    `Migration complete: ${count.rows[0].n as number} tables verified in schema 'dealer'.`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
