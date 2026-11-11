// Auth routes: register / login / refresh / logout / me.
// - register creates organization + user + Owner membership in one transaction.
// - refresh rotates the refresh token (old token revoked, only SHA-256 hashes
//   are stored). Passwords are bcrypt hashes; nothing sensitive is logged or
//   returned.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { validateBody } from '../middleware/validate';
import { authenticate, requireOrgId, requireUser } from '../middleware/auth';
import { ApiError, conflict, forbidden, unauthorized } from '../lib/errors';
import { hashToken, issueTokenPair, revokeRefreshToken } from '../lib/tokens';
import { insertAudit } from '../lib/audit';
import type { Role } from '../lib/types';

export const authRouter = Router();

const registerSchema = z.object({
  orgName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
  organizationId: z.string().uuid().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  role: Role;
}

async function loadMemberships(userId: string): Promise<MembershipRow[]> {
  const { rows } = await query<MembershipRow>(
    `SELECT om.organization_id, o.name AS organization_name, r.name AS role
       FROM dealer.organization_members om
       JOIN dealer.organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
       JOIN dealer.roles r ON r.id = om.role_id
      WHERE om.user_id = $1 AND om.active = TRUE AND om.deleted_at IS NULL
      ORDER BY om.created_at ASC`,
    [userId],
  );
  return rows;
}

async function getOrCreateRole(
  client: PoolClient,
  orgId: string,
  roleName: Role,
): Promise<string> {
  const found = await client.query(
    `SELECT id FROM dealer.roles WHERE organization_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [orgId, roleName],
  );
  if (found.rows.length > 0) return found.rows[0].id as string;
  const created = await client.query(
    `INSERT INTO dealer.roles (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, roleName],
  );
  return created.rows[0].id as string;
}

authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { orgName, name, email, password } = req.body as z.infer<typeof registerSchema>;
    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM dealer.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [email],
      );
      if (existing.rows.length > 0) {
        throw conflict('An account with this email already exists.');
      }
      const org = await client.query(
        `INSERT INTO dealer.organizations (name, currency) VALUES ($1, 'USD') RETURNING id, name`,
        [orgName],
      );
      const orgId = org.rows[0].id as string;
      await client.query(
        `INSERT INTO dealer.settings (organization_id, org_name, currency) VALUES ($1, $2, 'USD')`,
        [orgId, orgName],
      );
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await client.query(
        `INSERT INTO dealer.users (email, display_name, password_hash)
         VALUES ($1, $2, $3) RETURNING id, email, display_name`,
        [email, name, passwordHash],
      );
      const userId = user.rows[0].id as string;
      const roleId = await getOrCreateRole(client, orgId, 'Owner');
      await client.query(
        `INSERT INTO dealer.organization_members (organization_id, user_id, role_id, active)
         VALUES ($1, $2, $3, TRUE)`,
        [orgId, userId, roleId],
      );
      const tokens = await issueTokenPair(client, userId, orgId, 'Owner');
      await insertAudit(client, {
        orgId,
        actorId: userId,
        actorName: name,
        action: 'USER_REGISTERED',
        entityType: 'User',
        entityId: userId,
        summary: `Organization "${orgName}" created; ${name} registered as Owner.`,
      });
      return {
        ...tokens,
        user: { id: userId, name, email, role: 'Owner' as Role },
        organization: { id: orgId, name: orgName },
      };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, organizationId } = req.body as z.infer<typeof loginSchema>;
    const { rows } = await query<{ id: string; email: string; display_name: string; password_hash: string | null }>(
      `SELECT id, email, display_name, password_hash FROM dealer.users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.password_hash) throw unauthorized('Invalid email or password');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw unauthorized('Invalid email or password');
    const memberships = await loadMemberships(user.id);
    if (memberships.length === 0) throw forbidden('No active organization membership');
    const membership =
      memberships.find((m) => m.organization_id === organizationId) ?? memberships[0];
    const tokens = await withTransaction(async (client) =>
      issueTokenPair(client, user.id, membership.organization_id, membership.role),
    );
    res.json({
      ...tokens,
      user: { id: user.id, name: user.display_name, email: user.email, role: membership.role },
      organization: { id: membership.organization_id, name: membership.organization_name },
      memberships: memberships.map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organization_name,
        role: m.role,
      })),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const { rows } = await query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, organization_id, expires_at FROM dealer.refresh_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(refreshToken)],
    );
    const tokenRow = rows[0];
    if (!tokenRow || !tokenRow.organization_id) {
      throw unauthorized('Invalid or expired refresh token');
    }
    const result = await withTransaction(async (client) => {
      await client.query(
        `UPDATE dealer.refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [tokenRow.id],
      );
      const memberships = await loadMemberships(tokenRow.user_id);
      const membership = memberships.find(
        (m) => m.organization_id === tokenRow.organization_id,
      );
      if (!membership) throw unauthorized('No active membership for this organization');
      const userRes = await client.query(
        `SELECT id, email, display_name FROM dealer.users WHERE id = $1 AND deleted_at IS NULL`,
        [tokenRow.user_id],
      );
      if (userRes.rows.length === 0) throw unauthorized('User not found');
      const user = userRes.rows[0];
      const tokens = await issueTokenPair(client, user.id, membership.organization_id, membership.role);
      return {
        ...tokens,
        user: {
          id: user.id as string,
          name: user.display_name as string,
          email: user.email as string,
          role: membership.role,
        },
        organization: { id: membership.organization_id, name: membership.organization_name },
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', validateBody(logoutSchema), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof logoutSchema>;
    await withTransaction(async (client) => revokeRefreshToken(client, refreshToken));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = requireUser(req);
    const orgId = requireOrgId(req);
    const memberships = await loadMemberships(user.id);
    const current = memberships.find((m) => m.organization_id === orgId) ?? memberships[0];
    if (!current) throw new ApiError(401, 'No active membership', 'UNAUTHORIZED');
    res.json({
      user: { id: user.id, name: user.displayName, email: user.email, role: current.role },
      organization: { id: current.organization_id, name: current.organization_name },
      memberships: memberships.map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organization_name,
        role: m.role,
      })),
    });
  } catch (err) {
    next(err);
  }
});
