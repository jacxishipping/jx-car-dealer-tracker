// PostgreSQL pool + query helpers. The pool is created lazily on first use
// (so importing this module never connects), and every helper fails with a
// clear 503-style error when no connection string is configured instead of
// silently falling back to a local socket.
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { ApiError } from './lib/errors';
import { config } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new ApiError(503, 'Database is not configured', 'DB_NOT_CONFIGURED');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      // Idle-client errors must not crash the process; they surface on next query.
      console.error('Unexpected pg pool error:', err.message);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query<T>(text, params as never[]);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

/** Run `fn` inside a single transaction; rolls back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback already failed; original error wins */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Liveness probe for GET /health. Never throws. */
export async function checkDb(): Promise<boolean> {
  if (!config.databaseUrl) return false;
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
