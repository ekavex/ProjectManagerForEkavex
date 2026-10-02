/**
 * Organisation administration: the working day, the leave policy, public holidays and the
 * permissions each organisation role holds (spec sections 6.1 and 57).
 */
import {
  ERROR_CODES,
  ORG_ROLES,
  PERMISSIONS,
  type CreateHolidayInput,
  type Holiday,
  type OrganizationSettings,
  type OrgRole,
  type Permission,
  type RolePermissionRow,
  type UpdateOrganizationInput,
} from '@ekavist/shared';
import type { Db, RootDb } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import { dateColumnToDateOnly, dateOnlyToDateColumn, type DateOnly } from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../policy/actor.js';
import { diffValues, recordAudit } from './audit.service.js';

const SETTINGS_SELECT = {
  name: true,
  timezone: true,
  workdayStart: true,
  lateAfter: true,
  halfDayMinutes: true,
  fullDayMinutes: true,
  annualLeaveDays: true,
  sickLeaveDays: true,
  casualLeaveDays: true,
} as const;

export async function getSettings(db: Db, actor: Actor): Promise<OrganizationSettings> {
  return db.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: SETTINGS_SELECT,
  });
}

export async function updateSettings(
  db: RootDb,
  actor: Actor,
  input: UpdateOrganizationInput,
): Promise<OrganizationSettings> {
  const existing = await getSettings(db, actor);
  const halfDay = input.halfDayMinutes ?? existing.halfDayMinutes;
  const fullDay = input.fullDayMinutes ?? existing.fullDayMinutes;
  if (halfDay >= fullDay) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A half day must be shorter than a full day.',
      { details: [{ path: 'halfDayMinutes', message: 'Must be less than the full day.' }] },
    );
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: actor.organizationId },
      data: input,
      select: SETTINGS_SELECT,
    });
    const diff = diffValues(existing as unknown as Record<string, unknown>, input);
    if (diff != null) {
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: actor.organizationId,
        oldValue: diff.old,
        newValue: diff.new,
      });
    }
    return updated;
  });
}

// ------------------------------------------------------------------ holidays

function toHoliday(row: { id: string; date: Date; name: string }): Holiday {
  return { id: row.id, date: dateColumnToDateOnly(row.date) as DateOnly, name: row.name };
}

export async function listHolidays(
  db: Db,
  actor: Actor,
  range: { from?: DateOnly; to?: DateOnly },
): Promise<Holiday[]> {
  const rows = await db.holiday.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(range.from != null || range.to != null
        ? {
            date: {
              ...(range.from != null ? { gte: dateOnlyToDateColumn(range.from) as Date } : {}),
              ...(range.to != null ? { lte: dateOnlyToDateColumn(range.to) as Date } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, name: true },
  });
  return rows.map(toHoliday);
}

export async function createHoliday(
  db: RootDb,
  actor: Actor,
  input: CreateHolidayInput,
): Promise<Holiday> {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.holiday.create({
        data: {
          organizationId: actor.organizationId,
          date: dateOnlyToDateColumn(input.date) as Date,
          name: input.name,
        },
        select: { id: true, date: true, name: true },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'holiday.created',
        entityType: 'Holiday',
        entityId: row.id,
        newValue: { date: input.date, name: input.name },
      });
      return toHoliday(row);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, `${input.date} is already a holiday.`);
    }
    throw error;
  }
}

export async function deleteHoliday(db: RootDb, actor: Actor, holidayId: string): Promise<void> {
  const holiday = await db.holiday.findFirst({
    where: { id: holidayId, organizationId: actor.organizationId },
    select: { id: true, date: true, name: true },
  });
  if (holiday == null) throw notFound('That holiday');
  await db.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id: holidayId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'holiday.deleted',
      entityType: 'Holiday',
      entityId: holidayId,
      oldValue: toHoliday(holiday),
    });
  });
}

// --------------------------------------------------------------------- roles

export async function listRolePermissions(db: Db, actor: Actor): Promise<RolePermissionRow[]> {
  const rows = await db.rolePermission.findMany({
    where: { organizationId: actor.organizationId },
    select: { role: true, permission: true },
  });
  return ORG_ROLES.map((role) => ({
    role,
    permissions:
      role === 'SUPER_ADMIN'
        ? [...PERMISSIONS]
        : PERMISSIONS.filter((permission) =>
            rows.some((row) => row.role === role && row.permission === permission),
          ),
    editable: role !== 'SUPER_ADMIN',
  }));
}

/**
 * Replaces the organisation-wide grants of one role. Project permissions are not affected:
 * they follow from the person's role inside each project.
 */
export async function replaceRolePermissions(
  db: RootDb,
  actor: Actor,
  role: OrgRole,
  permissions: readonly Permission[],
): Promise<RolePermissionRow[]> {
  if (role === 'SUPER_ADMIN') {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Administrators always hold every permission, so their role cannot be edited.',
    );
  }
  const wanted = [...new Set(permissions)];

  await db.$transaction(async (tx) => {
    const before = await tx.rolePermission.findMany({
      where: { organizationId: actor.organizationId, role },
      select: { permission: true },
    });
    await tx.rolePermission.deleteMany({ where: { organizationId: actor.organizationId, role } });
    if (wanted.length > 0) {
      await tx.rolePermission.createMany({
        data: wanted.map((permission) => ({
          organizationId: actor.organizationId,
          role,
          permission,
        })),
      });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'role.permissions-replaced',
      entityType: 'OrgRole',
      entityId: role,
      oldValue: { permissions: before.map((row) => row.permission).sort() },
      newValue: { permissions: [...wanted].sort() },
    });
  });

  return listRolePermissions(db, actor);
}
