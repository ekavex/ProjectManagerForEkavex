/**
 * Request validation.
 *
 * Every endpoint that accepts input declares a schema. The parsed result is attached to
 * `req.valid`; handlers read that rather than `req.body`, so an unvalidated field cannot
 * reach a service by accident (master prompt section 57).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type ZodError, type ZodTypeAny } from 'zod';
import { ERROR_CODES } from '@ekavist/shared';
import { AppError } from '../../lib/errors.js';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const valid: { body?: unknown; query?: unknown; params?: unknown } = {};
    const details: { path: string; message: string }[] = [];

    for (const source of ['body', 'query', 'params'] as const) {
      const schema = schemas[source];
      if (schema == null) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        valid[source] = result.data;
      } else {
        details.push(...issuesOf(result.error, source));
      }
    }

    if (details.length > 0) {
      next(new AppError(ERROR_CODES.VALIDATION_FAILED, 'Some fields need attention.', { details }));
      return;
    }

    req.valid = valid;
    next();
  };
}

function issuesOf(error: ZodError, source: string): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    // Query and params are prefixed so a client can tell where the problem is.
    path: source === 'body' ? issue.path.join('.') : `${source}.${issue.path.join('.')}`,
    message: issue.message,
  }));
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not do this by itself, and an unhandled rejection would otherwise hang
 * the request.
 */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
