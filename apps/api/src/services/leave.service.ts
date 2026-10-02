/**
 * Leave management (spec section 86): request, approval, balance, and the effect of
 * approved leave on attendance and on the person's open tasks.
 *
 * Who may decide a request: the requester's manager, or anyone holding `leave:manage`.
 * Nobody decides their own.
 */
import {
  ERROR_CODES,
  PAID_LEAVE_TYPES,
  type CreateLeaveInput,
  type DecideLeaveInput,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
  type ListLeaveQuery,
  type Paginated,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import {
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { workingDates } from '../domain/working-days.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from '../policy/actor.js';
import { recordAudit } from './audit.service.js';
import { notify, notifyMany } from './notification.service.js';
import { pageMeta, paginate } from './pagination.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

/** Marks the attendance rows that approved leave created, so a cancellation can find them. */
const LEAVE_ADJUSTMENT_REASON = 'Approved leave';

const LEAVE_SELECT = {
  id: true,
  userId: true,
  type: true,
  startDate: true,
  endDate: true,
  days: true,
  halfDay: true,
  reason: true,
  status: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  user: { select: { ...USER_SUMMARY_SELECT, managerId: true } },
  approver: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.LeaveRequestSelect;

type LeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>;

function canDecide(actor: Actor, row: { userId: string; user: { managerId: string | null } }) {
  if (row.userId === actor.id) return false;
  return actor.permissions.has('leave:manage') || row.user.managerId === actor.id;
}

async function holidaySet(db: Db, organizationId: string, from: DateOnly, to: DateOnly) {
  const rows = await db.holiday.findMany({
    where: {
      organizationId,
      date: { gte: dateOnlyToDateColumn(from) as Date, lte: dateOnlyToDateColumn(to) as Date },
    },
    select: { date: true },
  });
  return new Set(rows.map((row) => dateColumnToDateOnly(row.date) as DateOnly));
}

/** Open tasks of each requester that fall due inside their leave. */
async function affectedTasksFor(db: Db, rows: readonly LeaveRow[]) {
  const result = new Map<string, LeaveRequest['affectedTasks']>();
  for (const row of rows) {
    if (row.status === 'REJECTED' || row.status === 'CANCELLED') {
      result.set(row.id, []);
      continue;
    }
    const tasks = await db.task.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        dueDate: { gte: row.startDate, lte: row.endDate },
        assignments: { some: { userId: row.userId } },
        project: { deletedAt: null },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
      select: { id: true, projectId: true, reference: true, name: true, dueDate: true },
    });
    result.set(
      row.id,
      tasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        reference: task.reference,
        name: task.name,
        dueDate: dateColumnToDateOnly(task.dueDate) as DateOnly,
      })),
    );
  }
  return result;
}

function toLeave(
  row: LeaveRow,
  actor: Actor,
  affected: LeaveRequest['affectedTasks'],
): LeaveRequest {
  return {
    id: row.id,
    user: toUserSummary(row.user),
    type: row.type,
    startDate: dateColumnToDateOnly(row.startDate) as DateOnly,
    endDate: dateColumnToDateOnly(row.endDate) as DateOnly,
    days: Number(row.days),
    halfDay: row.halfDay,
    reason: row.reason,
    status: row.status,
    approver: toUserSummaryOrNull(row.approver),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    affectedTasks: affected,
    canDecide: row.status === 'PENDING' && canDecide(actor, row),
  };
}

async function loadOne(db: Db, actor: Actor, leaveId: string): Promise<LeaveRequest> {
  const row = await db.leaveRequest.findFirst({
    where: { id: leaveId, organizationId: actor.organizationId },
    select: LEAVE_SELECT,
  });
  if (row == null) throw notFound('That leave request');
  const affected = await affectedTasksFor(db, [row]);
  return toLeave(row, actor, affected.get(row.id) ?? []);
}

// --------------------------------------------------------------------- list

export async function listLeave(
  db: Db,
  actor: Actor,
  input: ListLeaveQuery,
): Promise<Paginated<LeaveRequest>> {
  const manages = actor.permissions.has('leave:manage');
  if (input.scope === 'all' && !manages) throw forbidden();

  const where: Prisma.LeaveRequestWhereInput = {
    organizationId: actor.organizationId,
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.scope === 'mine'
      ? { userId: actor.id }
      : input.scope === 'review'
        ? {
            userId: { not: actor.id },
            ...(manages ? {} : { user: { managerId: actor.id } }),
          }
        : input.userId != null
          ? { userId: input.userId }
          : {}),
  };

  const [rows, total] = await Promise.all([
    db.leaveRequest.findMany({
      where,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      ...paginate(input),
      select: LEAVE_SELECT,
    }),
    db.leaveRequest.count({ where }),
  ]);

  const affected = await affectedTasksFor(db, rows);
  return {
    data: rows.map((row) => toLeave(row, actor, affected.get(row.id) ?? [])),
    meta: pageMeta(input, total),
  };
}

// ------------------------------------------------------------------ balance

export async function getBalance(
  db: Db,
  actor: Actor,
  userId: string,
  year: number,
): Promise<LeaveBalance> {
  if (userId !== actor.id && !actor.permissions.has('leave:manage')) {
    const target = await db.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      select: { managerId: true },
    });
    if (target?.managerId !== actor.id) throw forbidden();
  }

  const [organization, rows] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { annualLeaveDays: true, sickLeaveDays: true, casualLeaveDays: true },
    }),
    db.leaveRequest.groupBy({
      by: ['type', 'status'],
      where: {
        userId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: {
          gte: dateOnlyToDateColumn(`${year}-01-01`) as Date,
          lte: dateOnlyToDateColumn(`${year}-12-31`) as Date,
        },
      },
      _sum: { days: true },
    }),
  ]);

  const allowance: Record<LeaveType, number | null> = {
    ANNUAL: organization.annualLeaveDays,
    SICK: organization.sickLeaveDays,
    CASUAL: organization.casualLeaveDays,
    UNPAID: null,
    OTHER: null,
  };
  const sum = (type: LeaveType, status: 'PENDING' | 'APPROVED') =>
    Number(rows.find((row) => row.type === type && row.status === status)?._sum.days ?? 0);

  return {
    year,
    rows: (Object.keys(allowance) as LeaveType[]).map((type) => {
      const used = sum(type, 'APPROVED');
      const pending = sum(type, 'PENDING');
      const limit = allowance[type];
      return {
        type,
        allowance: limit,
        used,
        pending,
        remaining: limit == null ? null : limit - used - pending,
      };
    }),
  };
}

// ------------------------------------------------------------------- create

export async function requestLeave(
  db: RootDb,
  actor: Actor,
  input: CreateLeaveInput,
): Promise<LeaveRequest> {
  const holidays = await holidaySet(db, actor.organizationId, input.startDate, input.endDate);
  const dates = workingDates(input.startDate, input.endDate, holidays);
  if (dates.length === 0) {
    throw new AppError(
      ERROR_CODES.LEAVE_NO_WORKING_DAYS,
      'Those dates are all weekends or holidays, so there is nothing to request.',
    );
  }
  const days = input.halfDay ? 0.5 : dates.length;

  const overlapping = await db.leaveRequest.findFirst({
    where: {
      userId: actor.id,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: dateOnlyToDateColumn(input.endDate) as Date },
      endDate: { gte: dateOnlyToDateColumn(input.startDate) as Date },
    },
    select: { startDate: true, endDate: true },
  });
  if (overlapping != null) {
    throw new AppError(
      ERROR_CODES.LEAVE_OVERLAP,
      `You already have leave from ${dateColumnToDateOnly(overlapping.startDate)} to ${dateColumnToDateOnly(
        overlapping.endDate,
      )}. Cancel it first, or choose other dates.`,
    );
  }

  // The whole request counts against the year it starts in.
  if (PAID_LEAVE_TYPES.includes(input.type)) {
    const balance = await getBalance(db, actor, actor.id, Number(input.startDate.slice(0, 4)));
    const remaining = balance.rows.find((row) => row.type === input.type)?.remaining ?? 0;
    if (days > remaining) {
      throw new AppError(
        ERROR_CODES.LEAVE_BALANCE_EXCEEDED,
        `This needs ${days} day(s) of ${input.type.toLowerCase()} leave but only ${Math.max(
          0,
          remaining,
        )} remain, counting requests still awaiting a decision.`,
      );
    }
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        type: input.type,
        startDate: dateOnlyToDateColumn(input.startDate) as Date,
        endDate: dateOnlyToDateColumn(input.endDate) as Date,
        days,
        halfDay: input.halfDay,
        reason: input.reason ?? null,
      },
      select: LEAVE_SELECT,
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'leave.requested',
      entityType: 'LeaveRequest',
      entityId: created.id,
      newValue: {
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
      },
    });
    return created;
  });

  const approvers = await approverIds(db, actor.organizationId, row.user.managerId);
  await notifyMany(
    db,
    approvers,
    (userId) => ({
      userId,
      type: 'LEAVE_REQUESTED',
      title: `${actor.fullName} requested leave`,
      body: `${days} day(s) of ${input.type.toLowerCase()} leave, ${input.startDate} to ${input.endDate}.`,
      entityType: 'LeaveRequest',
      entityId: row.id,
      link: '/leave?tab=review',
    }),
    [actor.id],
  );

  return loadOne(db, actor, row.id);
}

/** The requester's manager plus everyone whose organisation role holds `leave:manage`. */
async function approverIds(
  db: Db,
  organizationId: string,
  managerId: string | null,
): Promise<string[]> {
  const grants = await db.rolePermission.findMany({
    where: { organizationId, permission: 'leave:manage' },
    select: { role: true },
  });
  const roles = [...new Set(['SUPER_ADMIN' as const, ...grants.map((grant) => grant.role)])];
  const users = await db.user.findMany({
    where: { organizationId, status: 'ACTIVE', role: { in: roles } },
    select: { id: true },
  });
  return [...new Set([...(managerId != null ? [managerId] : []), ...users.map((u) => u.id)])];
}

// ------------------------------------------------------------------- decide

export async function decideLeave(
  db: RootDb,
  actor: Actor,
  leaveId: string,
  input: DecideLeaveInput,
): Promise<LeaveRequest> {
  const row = await db.leaveRequest.findFirst({
    where: { id: leaveId, organizationId: actor.organizationId },
    select: LEAVE_SELECT,
  });
  if (row == null) throw notFound('That leave request');
  if (!canDecide(actor, row)) {
    throw forbidden(
      row.userId === actor.id
        ? 'You cannot decide your own leave request.'
        : 'Only their manager or a leave administrator can decide this request.',
    );
  }
  if (row.status !== 'PENDING') {
    throw new AppError(
      ERROR_CODES.LEAVE_ALREADY_DECIDED,
      `This request is already ${row.status.toLowerCase()}.`,
    );
  }

  const status = input.approve ? 'APPROVED' : 'REJECTED';
  const start = dateColumnToDateOnly(row.startDate) as DateOnly;
  const end = dateColumnToDateOnly(row.endDate) as DateOnly;

  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status,
        approverId: actor.id,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });

    if (input.approve) {
      // Approved leave shows on the attendance record; a half day stays open for work.
      const holidays = await holidaySet(tx, actor.organizationId, start, end);
      for (const date of workingDates(start, end, holidays)) {
        const workDate = dateOnlyToDateColumn(date) as Date;
        const leaveStatus = row.halfDay ? 'HALF_DAY' : 'LEAVE';
        await tx.attendanceDay.upsert({
          where: { userId_workDate: { userId: row.userId, workDate } },
          create: {
            userId: row.userId,
            workDate,
            status: leaveStatus,
            adjustedById: actor.id,
            adjustmentReason: LEAVE_ADJUSTMENT_REASON,
          },
          update: {
            status: leaveStatus,
            adjustedById: actor.id,
            adjustmentReason: LEAVE_ADJUSTMENT_REASON,
          },
        });
      }
    }

    await recordAudit(tx, {
      actorId: actor.id,
      action: input.approve ? 'leave.approved' : 'leave.rejected',
      entityType: 'LeaveRequest',
      entityId: leaveId,
      oldValue: { status: 'PENDING' },
      newValue: { status, note: input.note ?? null },
    });
  });

  await notify(db, {
    userId: row.userId,
    type: 'LEAVE_DECIDED',
    title: input.approve ? 'Your leave was approved' : 'Your leave was not approved',
    body: `${start} to ${end}${input.note ? `: ${input.note}` : '.'}`,
    entityType: 'LeaveRequest',
    entityId: leaveId,
    link: '/leave',
  });

  return loadOne(db, actor, leaveId);
}

// ------------------------------------------------------------------- cancel

/**
 * The requester may withdraw a pending request, or an approved one that has not started.
 * Leave already under way is corrected by an administrator through attendance instead.
 */
export async function cancelLeave(
  db: RootDb,
  actor: Actor,
  leaveId: string,
): Promise<LeaveRequest> {
  const row = await db.leaveRequest.findFirst({
    where: { id: leaveId, organizationId: actor.organizationId },
    select: LEAVE_SELECT,
  });
  if (row == null) throw notFound('That leave request');
  if (row.userId !== actor.id) throw forbidden('Only the person who asked can withdraw a request.');

  const start = dateColumnToDateOnly(row.startDate) as DateOnly;
  const todayDate = today(actor.timezone);
  const cancellable = row.status === 'PENDING' || (row.status === 'APPROVED' && start > todayDate);
  if (!cancellable) {
    throw new AppError(
      ERROR_CODES.LEAVE_ALREADY_DECIDED,
      row.status === 'APPROVED'
        ? 'This leave has already started. Ask an administrator to correct your attendance.'
        : `This request is already ${row.status.toLowerCase()}.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: leaveId }, data: { status: 'CANCELLED' } });
    if (row.status === 'APPROVED') {
      await tx.attendanceDay.deleteMany({
        where: {
          userId: row.userId,
          workDate: { gte: row.startDate, lte: row.endDate },
          adjustmentReason: LEAVE_ADJUSTMENT_REASON,
          sessions: { none: {} },
        },
      });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'leave.cancelled',
      entityType: 'LeaveRequest',
      entityId: leaveId,
      oldValue: { status: row.status },
      newValue: { status: 'CANCELLED' },
    });
  });

  return loadOne(db, actor, leaveId);
}
