// Express app factory. Helmet + CORS + JSON limit + rate limits, then the
// route tree, then a 404 and a central error handler that NEVER leaks stack
// traces or database errors to clients.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { checkDb } from './db';
import { ApiError } from './lib/errors';
import { authRouter } from './routes/auth';
import { crudRouter } from './routes/crud';
import { stateRouter } from './routes/state';
import { operationsRouter } from './routes/operations';
import { dealsRouter } from './routes/deals';
import { partsRouter } from './routes/parts';
import { financeRouter } from './routes/finance';
import { dashboardRouter } from './routes/dashboard';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { aiRouter } from './routes/ai';
import { mcpRouter } from './routes/mcp';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Global rate limit: 600 requests / 15 min per IP.
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { message: 'Too many requests — slow down and try again shortly.', code: 'RATE_LIMITED' } },
  });
  app.use(globalLimiter);

  // Stricter limiter for auth endpoints: 20 attempts / 15 min per IP.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { message: 'Too many sign-in attempts — try again later.', code: 'RATE_LIMITED' } },
  });

  // Liveness + DB probe (no auth).
  app.get('/health', async (_req: Request, res: Response) => {
    const dbUp = await checkDb();
    res.json({ ok: true, db: dbUp ? 'up' : 'down' });
  });

  // Auth is public (rate-limited); everything under /api/* after this is JWT-gated
  // by the individual routers' `authenticate` middleware.
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/state', stateRouter);
  // These routers declare their full /api paths internally.
  app.use('/api', operationsRouter);
  app.use('/api', financeRouter);
  app.use('/api/deals', dealsRouter);
  app.use('/api/parts', partsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/mcp', mcpRouter);
  // Generic CRUD covers the remaining list resources. It is mounted last so
  // the specific routers above win for overlapping paths (e.g. /api/deals
  // POST is the deals router; /api/deals GET is the CRUD router).
  app.use('/api', crudRouter);

  app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new ApiError(404, 'Not found', 'NOT_FOUND'));
  });

  // Central error handler. ApiErrors carry their own message/status; anything
  // else (including pg errors) becomes a generic 500 — the detail is logged
  // server-side only.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { message: err.message, code: err.code } });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: { message: 'Malformed JSON body', code: 'BAD_REQUEST' } });
      return;
    }
    console.error('Unhandled error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
  });

  return app;
}
