// Seed-admin CLI: creates an organization + admin user + Owner membership.
// Reads ADMIN_EMAIL, ADMIN_PASSWORD and ORG_NAME from the environment at
// runtime only. If the email is already registered, prints "already exists"
// and exits 0. Prints no passwords or tokens.
//
//   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='…' ORG_NAME='JX Motors' npm run seed-admin
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { requireDatabaseUrl } from './config';

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const orgName = process.env.ORG_NAME?.trim();
  if (!email || !password || !orgName) {
    console.error(
      'Usage: ADMIN_EMAIL=<email> ADMIN_PASSWORD=<password> ORG_NAME=<organization name> npm run seed-admin',
    );
    process.exit(1);
  }
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  try {
    const existing = await pool.query(
      `SELECT id FROM dealer.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [email],
    );
    if (existing.rows.length > 0) {
      console.log(`Admin user ${email} already exists.`);
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('BEGIN');
    try {
      const org = await pool.query(
        `INSERT INTO dealer.organizations (name, currency) VALUES ($1, 'USD') RETURNING id`,
        [orgName],
      );
      const orgId = org.rows[0].id as string;
      await pool.query(
        `INSERT INTO dealer.settings (organization_id, org_name, currency) VALUES ($1, $2, 'USD')`,
        [orgId, orgName],
      );
      const user = await pool.query(
        `INSERT INTO dealer.users (email, display_name, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        [email, orgName, passwordHash],
      );
      const userId = user.rows[0].id as string;
      let role = await pool.query(
        `SELECT id FROM dealer.roles WHERE organization_id = $1 AND name = 'Owner' AND deleted_at IS NULL`,
        [orgId],
      );
      if (role.rows.length === 0) {
        role = await pool.query(
          `INSERT INTO dealer.roles (organization_id, name) VALUES ($1, 'Owner') RETURNING id`,
          [orgId],
        );
      }
      await pool.query(
        `INSERT INTO dealer.organization_members (organization_id, user_id, role_id, active)
         VALUES ($1, $2, $3, TRUE)`,
        [orgId, userId, role.rows[0].id],
      );
      await pool.query('COMMIT');
      console.log(`Admin user ${email} created for organization "${orgName}".`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('seed-admin failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
