/**
 * User and department management (spec section 9).
 *
 * Users are deactivated, never deleted: their tasks, messages and audit entries are part
 * of the project record and must survive the person leaving.
 */
import {
  ERROR_CODES,
  type CreateDepartmentInput,
  type CreateUserInput,
  type Department,
  type ListUsersQuery,
  type NotificationPreferenceInput,
  type Paginated,
  type UpdateDepartmentInput,
  type UpdateOwnProfileInput,
  type UpdateUserInput,
  type UserDetail,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import { AppError, notFound } from '../lib/errors.js';
import { createOpaqueToken, passwordResetExpiry } from '../lib/tokens.js';
import { enqueueEmail } from '../mail/outbox.js';
import { hashPassword } from '../lib/password.js';
import type { Actor } from '../policy/actor.js';
import { recordAudit } from './audit.service.js';
import { revokeAllSessions } from './auth.service.js';
import {
  toUserDetail,
  toUserSummary,
  USER_DETAIL_SELECT,
  USER_SUMMARY_SELECT,
} from './user.mapper.js';
import { paginate, pageMeta } from './pagination.js';

export async function listUsers(
  db: Db,
  actor: Actor,
  query: ListUsersQuery,
): Promise<Paginated<UserDetail>> {
  const where: Prisma.UserWhereInput = {
    organizationId: actor.organizationId,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { designation: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: USER_DETAIL_SELECT,
      orderBy: { [query.sort]: query.direction },
      ...paginate(query),
    }),
  ]);

  return { data: rows.map(toUserDetail), meta: pageMeta(query, total) };
}

export async function getUser(db: Db, actor: Actor, userId: string): Promise<UserDetail> {
  const row = await db.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: USER_DETAIL_SELECT,
  });
  if (row == null) throw notFound('That person');
  return toUserDetail(row);
}

export interface CreateUserResult {
  user: UserDetail;
  /** True when an invitation with a password-setting link was queued. */
  invitationSent: boolean;
}

/**
 * Creates a user.
 *
 * When no password is supplied the account is created without one and an invitation is
 * queued: the person sets their own password, so an administrator never knows it.
 */
export async function createUser(
  db: RootDb,
  actor: Actor,
  input: CreateUserInput,
): Promise<CreateUserResult> {
  await assertDepartmentExists(db, actor, input.departmentId);
  await assertUserExists(db, actor, input.managerId, 'manager');

  const organization = await db.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: { timezone: true },
  });

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  try {
    const result = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: actor.organizationId,
          fullName: input.fullName,
          email: input.email,
          passwordHash,
          phone: input.phone ?? null,
          avatarUrl: input.avatarUrl ?? null,
          departmentId: input.departmentId ?? null,
          designation: input.designation ?? null,
          role: input.role,
          managerId: input.managerId ?? null,
          joiningDate: input.joiningDate ? new Date(`${input.joiningDate}T00:00:00Z`) : null,
          timezone: input.timezone ?? organization.timezone,
          skills: input.skills,
          notificationPreference: { create: {} },
        },
        select: USER_DETAIL_SELECT,
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: 'user.created',
        entityType: 'User',
        entityId: created.id,
        newValue: {
          fullName: created.fullName,
          email: created.email,
          role: created.role,
          departmentId: created.department?.id ?? null,
        },
      });

      let invitationSent = false;
      if (passwordHash == null) {
        const token = createOpaqueToken(32);
        await tx.passwordResetToken.create({
          data: { userId: created.id, tokenHash: token.hash, expiresAt: passwordResetExpiry() },
        });
        await enqueueEmail(tx, {
          toEmail: created.email,
          toUserId: created.id,
          template: 'account-created',
          payload: {
            name: created.fullName,
            email: created.email,
            createdBy: actor.fullName,
            token: token.token,
          },
        });
        invitationSent = true;
      }

      return { user: toUserDetail(created), invitationSent };
    });

    return result;
  } catch (error) {
    if (isUniqueConstraintError(error, 'email')) {
      throw new AppError(ERROR_CODES.EMAIL_TAKEN, 'Someone already uses that email address.');
    }
    throw error;
  }
}

export async function updateUser(
  db: RootDb,
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
): Promise<UserDetail> {
  const existing = await db.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { ...USER_DETAIL_SELECT, departmentId: true, managerId: true },
  });
  if (existing == null) throw notFound('That person');

  await assertDepartmentExists(db, actor, input.departmentId);
  await assertUserExists(db, actor, input.managerId, 'manager');

  if (input.managerId === userId) {
    throw new AppError(ERROR_CODES.CONFLICT, 'A person cannot be their own manager.');
  }

  // The organisation must keep at least one administrator who can sign in.
  const losingAdmin =
    existing.role === 'SUPER_ADMIN' &&
    ((input.role != null && input.role !== 'SUPER_ADMIN') ||
      (input.status != null && input.status !== 'ACTIVE'));
  if (losingAdmin) await assertAnotherAdminRemains(db, actor, userId);

  const deactivating = input.status != null && input.status !== 'ACTIVE';
  if (deactivating) {
    if (userId === actor.id) {
      throw new AppError(
        ERROR_CODES.CANNOT_DEACTIVATE_SELF,
        'You cannot deactivate your own account.',
      );
    }
    await assertNotLeadingActiveProjects(db, userId);
  }

  const updated = await db
    .$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.fullName != null ? { fullName: input.fullName } : {}),
          ...(input.email != null ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl ?? null } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
          ...(input.designation !== undefined ? { designation: input.designation ?? null } : {}),
          ...(input.role != null ? { role: input.role } : {}),
          ...(input.status != null ? { status: input.status } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId ?? null } : {}),
          ...(input.joiningDate !== undefined
            ? { joiningDate: input.joiningDate ? new Date(`${input.joiningDate}T00:00:00Z`) : null }
            : {}),
          ...(input.timezone != null ? { timezone: input.timezone } : {}),
          ...(input.skills != null ? { skills: input.skills } : {}),
        },
        select: USER_DETAIL_SELECT,
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: 'user.updated',
        entityType: 'User',
        entityId: userId,
        oldValue: {
          fullName: existing.fullName,
          email: existing.email,
          role: existing.role,
          status: existing.status,
          departmentId: existing.departmentId,
        },
        newValue: {
          fullName: row.fullName,
          email: row.email,
          role: row.role,
          status: row.status,
          departmentId: row.department?.id ?? null,
        },
      });

      return row;
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error, 'email')) {
        throw new AppError(ERROR_CODES.EMAIL_TAKEN, 'Someone already uses that email address.');
      }
      throw error;
    });

  // Signing out a deactivated account happens outside the transaction: it is a
  // consequence of the change, not part of it.
  if (deactivating) await revokeAllSessions(db, userId);

  return toUserDetail(updated);
}

export async function deactivateUser(
  db: RootDb,
  actor: Actor,
  userId: string,
): Promise<UserDetail> {
  return updateUser(db, actor, userId, { status: 'INACTIVE' });
}

export async function activateUser(db: RootDb, actor: Actor, userId: string): Promise<UserDetail> {
  return updateUser(db, actor, userId, { status: 'ACTIVE' });
}

export async function updateOwnProfile(
  db: Db,
  actor: Actor,
  input: UpdateOwnProfileInput,
): Promise<UserDetail> {
  const row = await db.user.update({
    where: { id: actor.id },
    data: {
      ...(input.fullName != null ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl ?? null } : {}),
      ...(input.timezone != null ? { timezone: input.timezone } : {}),
      ...(input.skills != null ? { skills: input.skills } : {}),
    },
    select: USER_DETAIL_SELECT,
  });
  return toUserDetail(row);
}

export async function updateNotificationPreferences(
  db: Db,
  actor: Actor,
  input: NotificationPreferenceInput,
): Promise<Record<string, boolean>> {
  const row = await db.notificationPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, ...input },
    update: input,
  });
  const { id: _id, userId: _userId, ...flags } = row;
  return flags;
}

// --------------------------------------------------------------- departments

export async function listDepartments(db: Db, actor: Actor): Promise<Department[]> {
  const rows = await db.department.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      head: { select: USER_SUMMARY_SELECT },
      _count: { select: { users: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    head: row.head == null ? null : toUserSummary(row.head),
    memberCount: row._count.users,
  }));
}

export async function createDepartment(
  db: Db,
  actor: Actor,
  input: CreateDepartmentInput,
): Promise<Department> {
  await assertUserExists(db, actor, input.headId, 'department head');
  try {
    const row = await db.department.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        description: input.description ?? null,
        headId: input.headId ?? null,
      },
      select: { id: true },
    });
    await recordAudit(db, {
      actorId: actor.id,
      action: 'department.created',
      entityType: 'Department',
      entityId: row.id,
      newValue: { name: input.name },
    });
    return (await listDepartments(db, actor)).find((d) => d.id === row.id) as Department;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, 'A department with that name already exists.');
    }
    throw error;
  }
}

export async function updateDepartment(
  db: Db,
  actor: Actor,
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<Department> {
  const existing = await db.department.findFirst({
    where: { id: departmentId, organizationId: actor.organizationId },
    select: { id: true, name: true },
  });
  if (existing == null) throw notFound('That department');

  await assertUserExists(db, actor, input.headId, 'department head');

  await db.department.update({
    where: { id: departmentId },
    data: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.headId !== undefined ? { headId: input.headId ?? null } : {}),
    },
  });
  await recordAudit(db, {
    actorId: actor.id,
    action: 'department.updated',
    entityType: 'Department',
    entityId: departmentId,
    oldValue: { name: existing.name },
    newValue: { name: input.name ?? existing.name },
  });

  return (await listDepartments(db, actor)).find((d) => d.id === departmentId) as Department;
}

export async function deleteDepartment(db: Db, actor: Actor, departmentId: string): Promise<void> {
  const existing = await db.department.findFirst({
    where: { id: departmentId, organizationId: actor.organizationId },
    select: { id: true, name: true, _count: { select: { users: true, projects: true } } },
  });
  if (existing == null) throw notFound('That department');

  if (existing._count.users > 0 || existing._count.projects > 0) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Move the people and projects out of this department before deleting it.',
    );
  }

  await db.department.delete({ where: { id: departmentId } });
  await recordAudit(db, {
    actorId: actor.id,
    action: 'department.deleted',
    entityType: 'Department',
    entityId: departmentId,
    oldValue: { name: existing.name },
  });
}

// ------------------------------------------------------------------ helpers

async function assertDepartmentExists(
  db: Db,
  actor: Actor,
  departmentId: string | null | undefined,
): Promise<void> {
  if (departmentId == null) return;
  const found = await db.department.count({
    where: { id: departmentId, organizationId: actor.organizationId },
  });
  if (found === 0) throw notFound('That department');
}

async function assertUserExists(
  db: Db,
  actor: Actor,
  userId: string | null | undefined,
  label: string,
): Promise<void> {
  if (userId == null) return;
  const found = await db.user.count({
    where: { id: userId, organizationId: actor.organizationId },
  });
  if (found === 0) throw notFound(`The ${label}`);
}

async function assertAnotherAdminRemains(db: Db, actor: Actor, excludingId: string): Promise<void> {
  const remaining = await db.user.count({
    where: {
      organizationId: actor.organizationId,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      id: { not: excludingId },
    },
  });
  if (remaining === 0) {
    throw new AppError(
      ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN,
      'This is the only active administrator. Promote someone else first.',
    );
  }
}

async function assertNotLeadingActiveProjects(db: Db, userId: string): Promise<void> {
  const projects = await db.project.findMany({
    where: {
      leadId: userId,
      deletedAt: null,
      status: { in: ['DRAFT', 'PLANNED', 'ACTIVE', 'ON_HOLD', 'AT_RISK'] },
    },
    select: { code: true, name: true },
    take: 5,
  });

  if (projects.length > 0) {
    const names = projects.map((project) => `${project.code} ${project.name}`).join(', ');
    throw new AppError(
      ERROR_CODES.USER_LEADS_ACTIVE_PROJECTS,
      `This person still leads ${names}. Assign a new project lead before deactivating them.`,
    );
  }
}
