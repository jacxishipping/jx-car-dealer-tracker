// JWT access tokens + SHA-256-hashed refresh tokens (rotation).
// Refresh tokens are stored ONLY as hashes in dealer.refresh_tokens, never
// in plain text. Access tokens carry { sub: userId, orgId, role }.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import { config, requireJwtSecret } from '../config';
import type { Role } from './types';

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
  role: Role;
}

export function issueAccessToken(userId: string, orgId: string, role: Role): string {
  const payload: AccessTokenPayload = { sub: userId, orgId, role };
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface RefreshTokenResult {
  token: string;
  expiresAt: Date;
}

/** Create a refresh token row (hash only) and return the plain token once. */
export async function issueRefreshToken(
  client: PoolClient,
  userId: string,
  orgId: string,
): Promise<RefreshTokenResult> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.refreshExpiresDays * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO dealer.refresh_tokens (user_id, organization_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, orgId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

/** Issue a fresh access + refresh pair (used by register/login/refresh). */
export async function issueTokenPair(
  client: PoolClient,
  userId: string,
  orgId: string,
  role: Role,
): Promise<{ token: string; refreshToken: string }> {
  const token = issueAccessToken(userId, orgId, role);
  const refresh = await issueRefreshToken(client, userId, orgId);
  return { token, refreshToken: refresh.token };
}

/** Revoke a refresh token by its plain value (no-op when unknown). */
export async function revokeRefreshToken(client: PoolClient, token: string): Promise<void> {
  await client.query(
    `UPDATE dealer.refresh_tokens SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}
