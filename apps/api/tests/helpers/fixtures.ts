/**
 * Test fixtures.
 *
 * Where practical these go through the service layer, so a test cannot construct a state
 * the application itself would refuse to create (docs/TEST_STRATEGY.md section 3). The
 * organisation and the first administrator are seeded directly, because there is no
 * bootstrap endpoint by design.
 */
import type { OrgRole } from '@ekavist/shared';
import { ORG_ROLE_PERMISSIONS, PERMISSIONS } from '@ekavist/shared';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/password.js';
import { testDb } from './db.js';

export const TEST_PASSWORD = 'correct-horse-battery';

export interface SeededOrg {
  id: string;
  timezone: string;
}

export async function seedOrganization(
  overrides: Partial<{ name: string; timezone: string }> = {},
): Promise<SeededOrg> {
  const db = testDb();
  const org = await db.organization.create({
    data: {
      name: overrides.name ?? 'Ekavist Test',
      timezone: overrides.timezone ?? 'Asia/Kolkata',
      workdayStart: '09:30',
      lateAfter: '10:00',
    },
    select: { id: true, timezone: true },
  });

  await db.rolePermission.createMany({
    data: (Object.keys(ORG_ROLE_PERMISSIONS) as OrgRole[]).flatMap((role) =>
      ORG_ROLE_PERMISSIONS[role].map((permission) => ({
        organizationId: org.id,
        role,
        permission,
      })),
    ),
  });

  return org;
}

export interface SeededUser {
  id: string;
  email: string;
  fullName: string;
  role: OrgRole;
  password: string;
}

let userCounter = 0;

export async function seedUser(
  organizationId: string,
  overrides: Partial<{
    email: string;
    fullName: string;
    role: OrgRole;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    password: string;
    timezone: string;
  }> = {},
): Promise<SeededUser> {
  const db = testDb();
  userCounter += 1;
  const password = overrides.password ?? TEST_PASSWORD;
  const email = overrides.email ?? `user${userCounter}@ekavist.test`;

  const user = await db.user.create({
    data: {
      organizationId,
      fullName: overrides.fullName ?? `Test User ${userCounter}`,
      email,
      passwordHash: await hashPassword(password),
      role: overrides.role ?? 'TEAM_MEMBER',
      status: overrides.status ?? 'ACTIVE',
      timezone: overrides.timezone ?? 'Asia/Kolkata',
      notificationPreference: { create: {} },
    },
    select: { id: true, email: true, fullName: true, role: true },
  });

  return { ...user, password };
}

/** Grants every permission to a role, for tests that need a deliberately over-privileged actor. */
export async function grantAllPermissions(organizationId: string, role: OrgRole): Promise<void> {
  const db: PrismaClient = testDb();
  await db.rolePermission.deleteMany({ where: { organizationId, role } });
  await db.rolePermission.createMany({
    data: PERMISSIONS.map((permission) => ({ organizationId, role, permission })),
  });
}

export interface BaseWorld {
  org: SeededOrg;
  admin: SeededUser;
  lead: SeededUser;
  member: SeededUser;
  otherMember: SeededUser;
  viewer: SeededUser;
  outsider: SeededUser;
}

/** The cast used by most suites: one of every role, plus someone with no involvement. */
export async function seedBaseWorld(): Promise<BaseWorld> {
  const org = await seedOrganization();
  const [admin, lead, member, otherMember, viewer, outsider] = await Promise.all([
    seedUser(org.id, { role: 'SUPER_ADMIN', fullName: 'Ada Admin', email: 'admin@ekavist.test' }),
    seedUser(org.id, { role: 'PROJECT_LEAD', fullName: 'Leo Lead', email: 'lead@ekavist.test' }),
    seedUser(org.id, {
      role: 'TEAM_MEMBER',
      fullName: 'Mira Member',
      email: 'member@ekavist.test',
    }),
    seedUser(org.id, { role: 'TEAM_MEMBER', fullName: 'Omar Member', email: 'omar@ekavist.test' }),
    seedUser(org.id, { role: 'VIEWER', fullName: 'Vera Viewer', email: 'viewer@ekavist.test' }),
    seedUser(org.id, {
      role: 'TEAM_MEMBER',
      fullName: 'Otto Outsider',
      email: 'outsider@ekavist.test',
    }),
  ]);
  return { org, admin, lead, member, otherMember, viewer, outsider };
}
