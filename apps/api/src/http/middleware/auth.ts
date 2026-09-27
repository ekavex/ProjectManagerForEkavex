/**
 * Authentication and authorisation middleware.
 *
 * `requireAuth` establishes who is asking. `requirePermission` guards organisation-level
 * routes. `requireProjectPermission` loads the caller's standing in the project named by
 * the route and guards project-level routes.
 *
 * None of these replace the service-layer checks: they are the first gate, not the only
 * one (docs/PERMISSIONS.md section 6).
 */
import { ERROR_CODES, type Permission } from '@ekavist/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../lib/errors.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import { loadOrgPermissions, type Actor } from '../../policy/actor.js';
import { loadProjectContext } from '../../policy/project-access.js';
import { requireActor } from '../context.js';

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

/**
 * Verifies the access token and loads the user.
 *
 * The user row is read on every request rather than trusted from the token, so
 * deactivating an account takes effect at once instead of at the next expiry.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    const token = bearerToken(req);
    if (token == null) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Please sign in to continue.');
    }

    const claims = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        organizationId: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        timezone: true,
      },
    });

    if (user == null) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'That sign-in token is not valid.');
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError(
        ERROR_CODES.ACCOUNT_DISABLED,
        'This account is not active. Please contact your administrator.',
      );
    }

    const actor: Actor = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
      timezone: user.timezone,
      permissions: await loadOrgPermissions(prisma, user.organizationId, user.role),
    };

    req.actor = actor;
  })().then(
    () => next(),
    (error: unknown) => next(error),
  );
};

/** Organisation-level guard. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);
    const granted = permissions.some((permission) => actor.permissions.has(permission));
    if (!granted) {
      next(new AppError(ERROR_CODES.FORBIDDEN, 'You do not have permission to do that.'));
      return;
    }
    next();
  };
}

/**
 * Project-level guard.
 *
 * `paramName` is the route parameter holding the project id. A caller who cannot see the
 * project receives 404 rather than 403, so the API does not confirm that the id exists.
 */
export function requireProjectPermission(
  permission: Permission,
  paramName = 'projectId',
): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const actor = requireActor(req);
      const projectId = req.params[paramName];
      if (typeof projectId !== 'string' || projectId.length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A project id is required.');
      }

      const context = await loadProjectContext(prisma, actor, projectId);
      if (!context.permissions.has(permission)) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'You do not have permission to do that in this project.',
        );
      }
      req.projectContext = context;
    })().then(
      () => next(),
      (error: unknown) => next(error),
    );
  };
}

/**
 * Loads the project context without demanding a specific permission. Used by routes whose
 * rule depends on the row being acted on (editing your own comment, for instance), where
 * the real check happens in the service.
 */
export function loadProject(paramName = 'projectId'): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const actor = requireActor(req);
      const projectId = req.params[paramName];
      if (typeof projectId !== 'string' || projectId.length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A project id is required.');
      }
      req.projectContext = await loadProjectContext(prisma, actor, projectId);
    })().then(
      () => next(),
      (error: unknown) => next(error),
    );
  };
}
