// Environment parsing. Read live from process.env (getters, not a snapshot)
// so tests can set env vars before first use. There are NO defaults for
// secrets: JWT_SECRET must be set or auth fails loudly at startup/use.
// DATABASE_URL falls back to POSTGRES_URL, then POSTGRES_PRISMA_URL.
// No credential is ever logged.
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  get port(): number {
    return Number(process.env.PORT ?? 3001);
  },
  /** Primary connection string, with the two documented fallbacks. */
  get databaseUrl(): string {
    return (
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL ??
      ''
    );
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? '';
  },
  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN ?? '1h';
  },
  get refreshExpiresDays(): number {
    return Number(process.env.REFRESH_EXPIRES_DAYS ?? 7);
  },
  get corsOrigins(): string[] {
    return (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
};

export function requireJwtSecret(): string {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET is not set. Set it in the environment before starting the server.');
  }
  return config.jwtSecret;
}

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      'No database connection string is set. Set DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL) in the environment.',
    );
  }
  return config.databaseUrl;
}
