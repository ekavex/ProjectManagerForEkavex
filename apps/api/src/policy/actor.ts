/**
 * Who is asking, and what they may do.
 *
 * The `Actor` is built once per request from the access token and is the only thing the
 * policy layer consults. Nothing downstream re-reads the token.
 */
import {
  ORG_ROLE_PERMISSIONS,
  PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  VIEWER_OPT_IN_PERMISSIONS,
  isPermission,
  type OrgRole,
  type Permission,
  type ProjectRole,
} from '@ekavist/shared';
import type { Db } from '../db/prisma.js';

export interface Actor {
  id: string;
  organizationId: string;
  role: OrgRole;
  email: string;
  fullName: string;
  timezone: string;
  /** Organisation-wide grants, loaded from RolePermission. */
  permissions: ReadonlySet<Permission>;
}

export interface ProjectContext {
  projectId: string;
  status: string;
  leadId: string | null;
  archivedAt: Date | null;
  /** Null when the actor is not a member; an administrator still gets a context. */
  projectRole: ProjectRole | null;
  isMember: boolean;
  /** Organisation grants merged with the project grants. */
  permissions: ReadonlySet<Permission>;
}

/**
 * Loads the organisation grants for a role.
 *
 * The table is the runtime source so an administrator can change the mapping, but an
 * empty table (a fresh database that has not been seeded) falls back to the defaults in
 * `@ekavist/shared` rather than locking everyone out.
 */
export async function loadOrgPermissions(
  db: Db,
  organizationId: string,
  role: OrgRole,
): Promise<Set<Permission>> {
  // Administrators hold everything, including permissions added after their rows were
  // seeded, and cannot be locked out of the role editor.
  if (role === 'SUPER_ADMIN') return new Set(PERMISSIONS);

  const rows = await db.rolePermission.findMany({
    where: { organizationId, role },
    select: { permission: true },
  });
  if (rows.length === 0) {
    return new Set(ORG_ROLE_PERMISSIONS[role]);
  }
  // Rows naming a permission that no longer exists are ignored rather than trusted.
  return new Set(rows.map((row) => row.permission).filter(isPermission));
}

/**
 * Merges organisation and project grants.
 *
 * An administrator receives every project permission without being a member, which is
 * what "organisation-wide access" means in spec section 6.1. A viewer only gets chat
 * access when their membership opts in (spec section 6.4).
 */
export function mergeProjectPermissions(
  actor: Actor,
  membership: { projectRole: ProjectRole; canReadChat: boolean } | null,
): Set<Permission> {
  const merged = new Set<Permission>(actor.permissions);

  if (actor.role === 'SUPER_ADMIN') {
    for (const permission of PROJECT_ROLE_PERMISSIONS.LEAD) merged.add(permission);
    return merged;
  }

  if (membership == null) return merged;

  for (const permission of PROJECT_ROLE_PERMISSIONS[membership.projectRole]) {
    merged.add(permission);
  }

  if (membership.projectRole === 'VIEWER' && membership.canReadChat) {
    for (const permission of VIEWER_OPT_IN_PERMISSIONS.canReadChat) merged.add(permission);
  }

  return merged;
}

export function can(permissions: ReadonlySet<Permission>, permission: Permission): boolean {
  return permissions.has(permission);
}
