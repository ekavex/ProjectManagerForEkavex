/**
 * Per-request context.
 *
 * Express request augmentation lives here so the shape is declared once. `actor` is set
 * by `requireAuth`, `projectContext` by `requireProjectPermission`; both are non-optional
 * by the time a handler runs, which the accessors below make safe to rely on.
 */
import type { Request } from 'express';
import type { Actor, ProjectContext } from '../policy/actor.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      actor?: Actor;
      projectContext?: ProjectContext;
      /** Populated by `validate()`; the parsed, typed request. */
      valid?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export function requireActor(req: Request): Actor {
  const actor = req.actor;
  if (actor == null) {
    // A programming error, not a user error: the route is missing `requireAuth`.
    throw new Error('requireActor called on a route that is not authenticated.');
  }
  return actor;
}

export function requireProjectContext(req: Request): ProjectContext {
  const context = req.projectContext;
  if (context == null) {
    throw new Error('requireProjectContext called on a route without requireProjectPermission.');
  }
  return context;
}

export function body<T>(req: Request): T {
  return req.valid?.body as T;
}

export function query<T>(req: Request): T {
  return req.valid?.query as T;
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

export function userAgent(req: Request): string | null {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 500) : null;
}
