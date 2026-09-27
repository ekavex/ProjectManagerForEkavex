/**
 * The permission vocabulary and the default role grants.
 *
 * `docs/PERMISSIONS.md` is the prose version of this file; the two must agree.
 * The grants below are seeded into the `RolePermission` table, after which an
 * administrator may change them. Nothing in the application reads these constants at
 * request time — the database is the runtime source — but the seed and the permission
 * tests both read them, so a drift between code and database shows up as a failing test.
 */

import type { OrgRole, ProjectRole } from './enums.js';

export const PERMISSIONS = [
  'user:read',
  'user:create',
  'user:update',
  'user:deactivate',
  'department:manage',
  'org:settings',
  'org:notification-rules',
  'audit:read',
  'project:create',
  'project:read',
  'project:update',
  'project:archive',
  'project:delete',
  'project:close',
  'member:add',
  'member:remove',
  'member:update',
  'phase:create',
  'phase:update',
  'phase:delete',
  'phase:approve',
  'wbs:create',
  'wbs:update',
  'wbs:delete',
  'task:create',
  'task:update',
  'task:delete',
  'task:assign',
  'task:update-own-progress',
  'task:comment',
  'task:attach',
  'dependency:manage',
  'milestone:manage',
  'raci:manage',
  'chat:read',
  'chat:post',
  'chat:pin',
  'chat:delete-any',
  'document:read',
  'document:create',
  'document:update',
  'document:delete',
  'note:project-read',
  'note:project-write',
  'decision:manage',
  'risk:manage',
  'issue:manage',
  'change-request:create',
  'change-request:decide',
  'report:read',
  'report:export',
  'attendance:read-own',
  'attendance:read-team',
  'attendance:read-all',
  'import:run',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Organisation-wide grants. These apply regardless of project membership.
 *
 * Note that a PROJECT_LEAD gets no project permissions here: leading a project is a
 * property of `ProjectMember`, not of the organisation role. An org-role lead who is not
 * a member of a project has exactly the same rights on it as a team member: none.
 */
export const ORG_ROLE_PERMISSIONS: Readonly<Record<OrgRole, readonly Permission[]>> = {
  SUPER_ADMIN: [...PERMISSIONS],
  PROJECT_LEAD: ['user:read', 'attendance:read-own', 'attendance:read-team', 'report:read'],
  TEAM_MEMBER: ['user:read', 'attendance:read-own'],
  VIEWER: ['attendance:read-own'],
};

/** Project-scoped grants, merged with the organisation grants for the caller. */
export const PROJECT_ROLE_PERMISSIONS: Readonly<Record<ProjectRole, readonly Permission[]>> = {
  LEAD: [
    'project:read',
    'project:update',
    'project:archive',
    'project:close',
    'member:add',
    'member:remove',
    'member:update',
    'phase:create',
    'phase:update',
    'phase:delete',
    'phase:approve',
    'wbs:create',
    'wbs:update',
    'wbs:delete',
    'task:create',
    'task:update',
    'task:delete',
    'task:assign',
    'task:update-own-progress',
    'task:comment',
    'task:attach',
    'dependency:manage',
    'milestone:manage',
    'raci:manage',
    'chat:read',
    'chat:post',
    'chat:pin',
    'chat:delete-any',
    'document:read',
    'document:create',
    'document:update',
    'document:delete',
    'note:project-read',
    'note:project-write',
    'decision:manage',
    'risk:manage',
    'issue:manage',
    'change-request:create',
    'change-request:decide',
    'report:read',
    'report:export',
    'attendance:read-team',
    'import:run',
  ],
  MEMBER: [
    'project:read',
    'task:update-own-progress',
    'task:comment',
    'task:attach',
    'chat:read',
    'chat:post',
    'chat:pin',
    'document:read',
    'document:create',
    'document:update',
    'note:project-read',
    'note:project-write',
    'change-request:create',
    'report:read',
  ],
  VIEWER: ['project:read', 'document:read', 'note:project-read', 'report:read', 'report:export'],
};

/**
 * Permissions that a viewer only receives when the membership row opts in
 * (spec section 6.4: "view selected chat channels if allowed").
 */
export const VIEWER_OPT_IN_PERMISSIONS: Readonly<Record<'canReadChat', readonly Permission[]>> = {
  canReadChat: ['chat:read'],
};
