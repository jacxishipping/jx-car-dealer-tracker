// JWT authentication. Verifies the bearer token, then loads the user's
// membership for the token's organization from the database (the DB is the
// source of truth for the role — a stale token cannot escalate privileges).
// Attaches req.user { id, email, displayName }, req.orgId and req.role.
// organization_id is NEVER taken from the request body.
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { requireJwtSecret } from '../config';
import { ApiError, unauthorized } from '../lib/errors';
import type { Role } from '../lib/types';
import type { AccessTokenPayload } from '../lib/tokens';

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      orgId?: string;
      role?: Role;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw unauthorized('Missing or malformed Authorization header');
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(match[1], requireJwtSecret()) as AccessTokenPayload;
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    if (!payload.sub || !payload.orgId) throw unauthorized('Invalid token payload');
    const { rows } = await query<{
      id: string;
      email: string;
      display_name: string;
      role_name: Role;
    }>(
      `SELECT u.id, u.email, u.display_name, r.name AS role_name
         FROM dealer.users u
         JOIN dealer.organization_members om
           ON om.user_id = u.id
          AND om.organization_id = $2
          AND om.active = TRUE
          AND om.deleted_at IS NULL
         JOIN dealer.roles r ON r.id = om.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [payload.sub, payload.orgId],
    );
    if (rows.length === 0) {
      throw unauthorized('No active membership for this organization');
    }
    const row = rows[0];
    req.user = { id: row.id, email: row.email, displayName: row.display_name };
    req.orgId = payload.orgId;
    req.role = row.role_name;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(unauthorized('Authentication failed'));
  }
}

/** Convenience accessors — throw 401 when auth middleware has not run. */
export function requireOrgId(req: Request): string {
  if (!req.orgId) throw unauthorized('Authentication required');
  return req.orgId;
}

export function requireUser(req: Request): AuthedUser {
  if (!req.user) throw unauthorized('Authentication required');
  return req.user;
}
