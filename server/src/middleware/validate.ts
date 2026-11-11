// Zod body/query validation. Invalid input is rejected with a 400 that
// lists the offending fields — never a raw zod error dump.
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors';

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') + ': ' : ''}${i.message}`)
    .join('; ');
}

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ApiError(400, `Validation failed: ${formatIssues(result.error)}`, 'VALIDATION'));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ApiError(400, `Validation failed: ${formatIssues(result.error)}`, 'VALIDATION'));
    }
    req.query = result.data as unknown as typeof req.query;
    next();
  };
}

/** Shared list-query params: ?q=&status=&page=1&limit=50. */
export const paginationSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/** Optional ?from=&to= ISO-date range (used by reports + dashboard). */
export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
});
