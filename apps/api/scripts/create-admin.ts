/**
 * Creates the first administrator, and the organisation if there is not one yet.
 *
 * There is no bootstrap endpoint by design: an unauthenticated route that can mint a
 * super administrator is a back door whether or not it is guarded by a "first run" check.
 * So the first account is made here, by someone with database access, once.
 *
 * Credentials come from the environment and are never printed, never logged, and never
 * written to a file:
 *
 *   ADMIN_EMAIL     required
 *   ADMIN_PASSWORD  required, at least 10 characters (matches the application's own rule)
 *   ADMIN_NAME      optional, defaults to "Administrator"
 *   ORG_NAME        optional, used only when creating the organisation
 *   ORG_TIMEZONE    optional, defaults to Asia/Kolkata
 *   DATABASE_URL    required, the database to write to
 *
 * Run it against production explicitly:
 *
 *   DATABASE_URL='...' ADMIN_EMAIL='...' ADMIN_PASSWORD='...' \
 *     npx tsx apps/api/scripts/create-admin.ts
 *
 * It refuses to touch an account that already exists, so running it twice is safe and
 * cannot be used to reset somebody's password by accident.
 */
import { ORG_ROLE_PERMISSIONS, type OrgRole } from '@ekavist/shared';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const MIN_PASSWORD_LENGTH = 10;

function required(name: string): string {
  const value = process.env[name];
  if (value == null || value.trim() === '') {
    throw new Error(`${name} is not set. See the comment at the top of this script.`);
  }
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const email = required('ADMIN_EMAIL').trim().toLowerCase();
  const password = required('ADMIN_PASSWORD');
  const fullName = process.env['ADMIN_NAME']?.trim() || 'Administrator';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`ADMIN_EMAIL does not look like an address: ${email}`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD is too short. The application requires at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  // Said out loud before anything is written, because the usual way to regret running
  // this is to have pointed it at the wrong database.
  console.log(`Database: ${databaseUrl.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`Creating: ${email} (${fullName})\n`);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const existing = await prisma.user.findFirst({
      where: { email },
      select: { id: true, role: true },
    });
    if (existing != null) {
      console.log(`${email} already exists (role ${existing.role}). Nothing was changed.`);
      console.log('To change its password, use the forgotten-password flow in the app.');
      return;
    }

    // --- the organisation -------------------------------------------------
    let organization = await prisma.organization.findFirst({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    if (organization == null) {
      organization = await prisma.organization.create({
        data: {
          name: process.env['ORG_NAME']?.trim() || 'Ekavist',
          timezone: process.env['ORG_TIMEZONE']?.trim() || 'Asia/Kolkata',
          workdayStart: '09:30',
          lateAfter: '10:00',
        },
        select: { id: true, name: true },
      });
      console.log(`Created the organisation "${organization.name}".`);
    } else {
      console.log(`Using the existing organisation "${organization.name}".`);
    }

    // The permission rows are what the policy layer reads at request time. Without them
    // a super administrator is a user with a title and no rights.
    const permissions = await prisma.rolePermission.createMany({
      data: (Object.keys(ORG_ROLE_PERMISSIONS) as OrgRole[]).flatMap((role) =>
        ORG_ROLE_PERMISSIONS[role].map((permission) => ({
          organizationId: organization.id,
          role,
          permission,
        })),
      ),
      skipDuplicates: true,
    });
    console.log(`Role permissions: ${permissions.count} row(s) added.`);

    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email,
        fullName,
        passwordHash: await hashPassword(password),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        timezone: process.env['ORG_TIMEZONE']?.trim() || 'Asia/Kolkata',
        notificationPreference: { create: {} },
      },
      select: { id: true, email: true },
    });

    console.log(`\nCreated ${user.email} as SUPER_ADMIN.`);
    console.log('Sign in with the password you supplied; it was not printed or stored here.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
