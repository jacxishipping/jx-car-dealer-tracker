// Typed API errors. The central error handler in app.ts turns these into
// `{ error: { message, code? } }` responses and never leaks stack traces or
// database errors to clients.

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') =>
  new ApiError(400, message, code);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new ApiError(401, message, code);
export const forbidden = (message = 'You do not have permission to do that', code = 'FORBIDDEN') =>
  new ApiError(403, message, code);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') =>
  new ApiError(404, message, code);
export const conflict = (message: string, code = 'CONFLICT') =>
  new ApiError(409, message, code);
export const unprocessable = (message: string, code = 'UNPROCESSABLE') =>
  new ApiError(422, message, code);

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
