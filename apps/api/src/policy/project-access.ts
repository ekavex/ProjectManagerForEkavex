/**
 * Project-scoped authorisation.
 *
 * Every rule that decides whether an actor may see or change a project lives here, and
 * services call it as well as routes, so a route that forgets its middleware is not an
 * exploit (docs/PERMISSIONS.md section 6).
 */
import {
  ERROR_CODES,
  MUTABLE_PROJECT_STATUSES,
  type Permission,
  type ProjectStatus,
} from '@ekavist/shared';
import type { Db } from '../db/prisma.js';
import { AppError } from '../lib/errors.js';
import { mergeProjectPermissions, type Actor, type ProjectContext } from './actor.js';

/**
 * Loads the project and the actor's standing in it.
 *
 * Throws `NOT_PROJECT_MEMBER` (404) when the actor cannot see the project at all, so the
 * API never confirms that an id exists to someone with no business knowing.
 */
export async function loadProjectContext(
  db: Db,
  actor: Actor,
  projectId: string,
): Promise<ProjectContext> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      status: true,
      leadId: true,
      archivedAt: true,
      members: {
        where: { userId: actor.id },
        select: { projectRole: true, canReadChat: true },
      },
    },
  });

  if (project == null) {
    throw new AppError(ERROR_CODES.NOT_PROJECT_MEMBER, 'That project was not found.');
  }

  const membership = project.members[0] ?? null;
  const isAdmin = actor.role === 'SUPER_ADMIN';

  if (membership == null && !isAdmin) {
    throw new AppError(ERROR_CODES.NOT_PROJECT_MEMBER, 'That project was not found.');
  }

  return {
    projectId: project.id,
    status: project.status,
    leadId: project.leadId,
    archivedAt: project.archivedAt,
    projectRole: membership?.projectRole ?? null,
    isMember: membership != null,
    permissions: mergeProjectPermissions(actor, membership),
  };
}

export function assertProjectPermission(
  context: ProjectContext,
  permission: Permission,
  message?: string,
): void {
  if (!context.permissions.has(permission)) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      message ?? 'You do not have permission to do that in this project.',
    );
  }
}

/**
 * Refuses a write to a project that is not in a mutable state.
 *
 * Archived, completed and cancelled projects are read-only for everyone, administrators
 * included (business rule 20). Only the operations that change that state itself are
 * allowed through, by not calling this function.
 */
export function assertProjectMutable(context: ProjectContext): void {
  if (context.archivedAt != null) {
    throw new AppError(
      ERROR_CODES.PROJECT_READ_ONLY,
      'This project is archived. Restore it before making changes.',
    );
  }
  if (!MUTABLE_PROJECT_STATUSES.includes(context.status as ProjectStatus)) {
    throw new AppError(
      ERROR_CODES.PROJECT_READ_ONLY,
      `This project is ${context.status.toLowerCase().replace('_', ' ')} and no longer accepts changes.`,
    );
  }
}

/** Convenience for the common "may do it, and the project accepts writes" pair. */
export function assertCanMutateProject(context: ProjectContext, permission: Permission): void {
  assertProjectPermission(context, permission);
  assertProjectMutable(context);
}

/**
 * The set of project ids the actor may read. Administrators get everything in the
 * organisation; everyone else gets their memberships.
 *
 * Returning null means "no restriction", which lets callers build a Prisma `where` without
 * loading thousands of ids for an administrator.
 */
export async function visibleProjectIds(db: Db, actor: Actor): Promise<string[] | null> {
  if (actor.role === 'SUPER_ADMIN') return null;
  const memberships = await db.projectMember.findMany({
    where: { userId: actor.id },
    select: { projectId: true },
  });
  return memberships.map((membership) => membership.projectId);
}

/**
 * Whether the actor may see another user's attendance. `attendance:read-all` covers
 * everyone; `attendance:read-team` covers people who share a project with the actor.
 */
export async function canReadAttendanceOf(
  db: Db,
  actor: Actor,
  targetUserId: string,
): Promise<boolean> {
  if (targetUserId === actor.id) return true;
  if (actor.permissions.has('attendance:read-all')) return true;
  if (!actor.permissions.has('attendance:read-team')) return false;

  // Shares at least one project in which the actor is the lead.
  const shared = await db.projectMember.count({
    where: {
      userId: targetUserId,
      project: {
        deletedAt: null,
        members: { some: { userId: actor.id, projectRole: 'LEAD' } },
      },
    },
  });
  return shared > 0;
}
