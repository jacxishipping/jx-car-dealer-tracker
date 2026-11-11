// Entry point: listen on PORT (default 3001) with graceful shutdown.
// Fails fast when JWT_SECRET is missing; warns (but still starts, with
// /health reporting db:"down") when no database connection string is set.
import { createApp } from './app';
import { config, requireJwtSecret } from './config';
import { closePool } from './db';

async function main(): Promise<void> {
  requireJwtSecret();
  if (!config.databaseUrl) {
    console.warn(
      'WARNING: no DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL) is set — ' +
        'the server will start but every database call will fail and /health will report db:"down".',
    );
  }
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`JX Car Dealer Tracker API listening on port ${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal} — shutting down gracefully…`);
    server.close(async () => {
      await closePool();
      console.log('Server stopped.');
      process.exit(0);
    });
    // Force exit if connections linger.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
