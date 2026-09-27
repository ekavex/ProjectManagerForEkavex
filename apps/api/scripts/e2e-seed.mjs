/**
 * The end-to-end fixture.
 *
 * Deliberately minimal: an organisation, four people covering every role, and no project.
 * The journeys build the project themselves, because creating one is part of what they
 * are testing.
 *
 * Every table is truncated first, so a run never depends on what a previous run left
 * behind. This only ever runs against `TEST_DATABASE_URL`.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test')) {
  console.error(
    `Refusing to reset a database that is not the test database: ${url.replace(/:[^:@]+@/, ':***@')}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const PASSWORD = 'e2e-password-2026';

const PEOPLE = [
  { email: 'e2e-admin@ekavist.test', fullName: 'Ada Admin', role: 'SUPER_ADMIN' },
  { email: 'e2e-lead@ekavist.test', fullName: 'Leo Lead', role: 'PROJECT_LEAD' },
  { email: 'e2e-member@ekavist.test', fullName: 'Mira Member', role: 'TEAM_MEMBER' },
  { email: 'e2e-viewer@ekavist.test', fullName: 'Vera Viewer', role: 'VIEWER' },
];

const PERMISSIONS_BY_ROLE = {
  SUPER_ADMIN: null, // everything; filled in below
  PROJECT_LEAD: ['user:read', 'attendance:read-own', 'attendance:read-team', 'report:read'],
  TEAM_MEMBER: ['user:read', 'attendance:read-own'],
  VIEWER: ['attendance:read-own'],
};

const ALL_PERMISSIONS = [
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
];

async function main() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const quoted = tables.map((row) => `"public"."${row.tablename}"`);
  if (quoted.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted.join(', ')} RESTART IDENTITY CASCADE`);
  }

  const organization = await prisma.organization.create({
    data: {
      name: 'Ekavist (end-to-end)',
      timezone: 'Asia/Kolkata',
      workdayStart: '09:30',
      lateAfter: '10:00',
    },
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: Object.entries(PERMISSIONS_BY_ROLE).flatMap(([role, permissions]) =>
      (permissions ?? ALL_PERMISSIONS).map((permission) => ({
        organizationId: organization.id,
        role,
        permission,
      })),
    ),
    skipDuplicates: true,
  });

  // The same reduced parameters the integration tests use: these accounts exist only to
  // sign in during a test run.
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 1024,
    timeCost: 2,
    parallelism: 1,
  });

  for (const person of PEOPLE) {
    await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: person.email,
        fullName: person.fullName,
        role: person.role,
        passwordHash,
        timezone: 'Asia/Kolkata',
        notificationPreference: { create: {} },
      },
    });
  }

  console.log(`End-to-end fixture ready: ${PEOPLE.length} accounts, no projects.`);
}

main()
  .catch((error) => {
    console.error('Seeding the end-to-end fixture failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
