/**
 * Attendance and work sessions (spec sections 27 to 30).
 *
 * The distinction the spec insists on: signing in is authentication, starting work is
 * attendance. Nothing here is triggered by a login; a day row appears only when someone
 * presses Start work.
 *
 * Two database-level guarantees back up the service checks: a partial unique index allows
 * at most one open work session per user, and one open break per session
 * (`scripts/apply-search-indexes.ts`).
 */
import {
  ERROR_CODES,
  type AdjustAttendanceInput,
  type AttendanceDay,
  type AttendanceHistoryQuery,
  type AttendanceToday,
  type BreakInput,
  type EndWorkInput,
  type Paginated,
  type StartWorkInput,
  type SwitchWorkContextInput,
  type TeamAttendanceRow,
  type WorkSession,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import {
  deriveAttendanceStatus,
  dayTotals,
  sessionMinutes,
  type SessionSpan,
} from '../domain/attendance.js';
import {
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../policy/actor.js';
import { canReadAttendanceOf } from '../policy/project-access.js';
import { recordAudit } from './audit.service.js';
import { pageMeta, paginate } from './pagination.js';
import { USER_SUMMARY_SELECT, toUserSummary } from './user.mapper.js';

const SESSION_SELECT = {
  id: true,
  startedAt: true,
  endedAt: true,
  minutes: true,
  note: true,
  project: { select: { id: true, code: true, name: true } },
  task: { select: { id: true, reference: true, name: true } },
  breaks: {
    orderBy: { startedAt: 'asc' },
    select: { id: true, startedAt: true, endedAt: true, minutes: true, reason: true },
  },
} satisfies Prisma.WorkSessionSelect;

const DAY_SELECT = {
  id: true,
  workDate: true,
  status: true,
  firstStartedAt: true,
  lastEndedAt: true,
  workMinutes: true,
  breakMinutes: true,
  adjustmentReason: true,
  user: { select: USER_SUMMARY_SELECT },
  adjustedBy: { select: USER_SUMMARY_SELECT },
  sessions: { orderBy: { startedAt: 'asc' }, select: SESSION_SELECT },
} satisfies Prisma.AttendanceDaySelect;

type DayRow = Prisma.AttendanceDayGetPayload<{ select: typeof DAY_SELECT }>;
type SessionRow = Prisma.WorkSessionGetPayload<{ select: typeof SESSION_SELECT }>;

// ---------------------------------------------------------------- start work

export async function startWork(
  db: RootDb,
  actor: Actor,
  input: StartWorkInput,
): Promise<AttendanceToday> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();
  const workDate = today(organization.timezone, now);

  const open = await db.workSession.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: { id: true, startedAt: true },
  });
  if (open != null) {
    throw new AppError(
      ERROR_CODES.WORK_SESSION_ALREADY_OPEN,
      'You already have a work session running. End it before starting another.',
    );
  }

  await assertContextIsVisible(db, actor, input.projectId, input.taskId);

  try {
    await db.$transaction(async (tx) => {
      const day = await tx.attendanceDay.upsert({
        where: {
          userId_workDate: { userId: actor.id, workDate: dateOnlyToDateColumn(workDate) as Date },
        },
        create: {
          userId: actor.id,
          workDate: dateOnlyToDateColumn(workDate) as Date,
          firstStartedAt: now,
          status: 'PRESENT',
        },
        update: {},
        select: { id: true, firstStartedAt: true },
      });

      await tx.workSession.create({
        data: {
          attendanceDayId: day.id,
          userId: actor.id,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          startedAt: now,
          note: input.note ?? null,
        },
      });

      if (day.firstStartedAt == null) {
        await tx.attendanceDay.update({
          where: { id: day.id },
          data: { firstStartedAt: now },
        });
      }

      await refreshDay(tx, day.id, organization, now);
    });
  } catch (error) {
    // The partial unique index is the real guard; this turns a race into a clear message.
    if (isUniqueConstraintError(error)) {
      throw new AppError(
        ERROR_CODES.WORK_SESSION_ALREADY_OPEN,
        'You already have a work session running.',
      );
    }
    throw error;
  }

  await recordAudit(db, {
    actorId: actor.id,
    action: 'attendance.work-started',
    entityType: 'WorkSession',
    entityId: actor.id,
    projectId: input.projectId ?? null,
    newValue: { workDate, projectId: input.projectId ?? null, taskId: input.taskId ?? null },
  });

  return getToday(db, actor);
}

export async function endWork(
  db: RootDb,
  actor: Actor,
  input: EndWorkInput,
): Promise<AttendanceToday> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();

  const open = await db.workSession.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: {
      id: true,
      attendanceDayId: true,
      startedAt: true,
      breaks: { select: { id: true, startedAt: true, endedAt: true } },
    },
  });
  if (open == null) {
    throw new AppError(
      ERROR_CODES.WORK_SESSION_NOT_OPEN,
      'You do not have a work session running.',
    );
  }

  await db.$transaction(async (tx) => {
    // An open break is closed with the session rather than left dangling.
    for (const span of open.breaks.filter((item) => item.endedAt == null)) {
      await tx.breakSession.update({
        where: { id: span.id },
        data: { endedAt: now, minutes: minutesBetweenDates(span.startedAt, now) },
      });
    }

    const closedBreaks = open.breaks.map((span) => ({
      startedAt: span.startedAt,
      endedAt: span.endedAt ?? now,
    }));

    await tx.workSession.update({
      where: { id: open.id },
      data: {
        endedAt: now,
        minutes: sessionMinutes(
          { startedAt: open.startedAt, endedAt: now, breaks: closedBreaks },
          now,
        ),
        ...(input.note != null ? { note: input.note } : {}),
      },
    });

    await tx.attendanceDay.update({
      where: { id: open.attendanceDayId },
      data: { lastEndedAt: now },
    });

    await refreshDay(tx, open.attendanceDayId, organization, now);
  });

  await recordAudit(db, {
    actorId: actor.id,
    action: 'attendance.work-ended',
    entityType: 'WorkSession',
    entityId: open.id,
  });

  return getToday(db, actor);
}

/**
 * Moves the running session to a different project or task without closing the day: the
 * current session is closed and a new one opened in one transaction, so the totals never
 * double-count (spec section 29, "switch between tasks while keeping attendance active").
 */
export async function switchWorkContext(
  db: RootDb,
  actor: Actor,
  input: SwitchWorkContextInput,
): Promise<AttendanceToday> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();

  const open = await db.workSession.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: {
      id: true,
      attendanceDayId: true,
      startedAt: true,
      breaks: { select: { id: true, startedAt: true, endedAt: true } },
    },
  });
  if (open == null) {
    throw new AppError(
      ERROR_CODES.WORK_SESSION_NOT_OPEN,
      'Start work before switching what you are working on.',
    );
  }

  await assertContextIsVisible(db, actor, input.projectId ?? null, input.taskId ?? null);

  await db.$transaction(async (tx) => {
    for (const span of open.breaks.filter((item) => item.endedAt == null)) {
      await tx.breakSession.update({
        where: { id: span.id },
        data: { endedAt: now, minutes: minutesBetweenDates(span.startedAt, now) },
      });
    }

    const closedBreaks = open.breaks.map((span) => ({
      startedAt: span.startedAt,
      endedAt: span.endedAt ?? now,
    }));

    await tx.workSession.update({
      where: { id: open.id },
      data: {
        endedAt: now,
        minutes: sessionMinutes(
          { startedAt: open.startedAt, endedAt: now, breaks: closedBreaks },
          now,
        ),
      },
    });

    await tx.workSession.create({
      data: {
        attendanceDayId: open.attendanceDayId,
        userId: actor.id,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        startedAt: now,
      },
    });

    await refreshDay(tx, open.attendanceDayId, organization, now);
  });

  return getToday(db, actor);
}

// -------------------------------------------------------------------- breaks

export async function startBreak(
  db: RootDb,
  actor: Actor,
  input: BreakInput,
): Promise<AttendanceToday> {
  const now = new Date();
  const open = await db.workSession.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: { id: true, breaks: { where: { endedAt: null }, select: { id: true } } },
  });

  if (open == null) {
    throw new AppError(ERROR_CODES.WORK_SESSION_NOT_OPEN, 'Start work before taking a break.');
  }
  if (open.breaks.length > 0) {
    throw new AppError(ERROR_CODES.BREAK_ALREADY_OPEN, 'You are already on a break.');
  }

  try {
    await db.breakSession.create({
      data: { workSessionId: open.id, startedAt: now, reason: input.reason ?? null },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(ERROR_CODES.BREAK_ALREADY_OPEN, 'You are already on a break.');
    }
    throw error;
  }

  return getToday(db, actor);
}

export async function endBreak(db: RootDb, actor: Actor): Promise<AttendanceToday> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();

  const open = await db.workSession.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: {
      id: true,
      attendanceDayId: true,
      breaks: { where: { endedAt: null }, select: { id: true, startedAt: true } },
    },
  });

  const span = open?.breaks[0];
  if (open == null || span == null) {
    throw new AppError(ERROR_CODES.BREAK_NOT_OPEN, 'You are not on a break.');
  }

  await db.$transaction(async (tx) => {
    await tx.breakSession.update({
      where: { id: span.id },
      data: { endedAt: now, minutes: minutesBetweenDates(span.startedAt, now) },
    });
    await refreshDay(tx, open.attendanceDayId, organization, now);
  });

  return getToday(db, actor);
}

// --------------------------------------------------------------------- reads

export async function getToday(db: Db, actor: Actor): Promise<AttendanceToday> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();
  const workDate = today(organization.timezone, now);

  const day = await db.attendanceDay.findUnique({
    where: {
      userId_workDate: { userId: actor.id, workDate: dateOnlyToDateColumn(workDate) as Date },
    },
    select: DAY_SELECT,
  });

  if (day == null) {
    return {
      workDate,
      status: null,
      isWorking: false,
      isOnBreak: false,
      openSession: null,
      workMinutes: 0,
      breakMinutes: 0,
    };
  }

  const openSession = day.sessions.find((session) => session.endedAt == null) ?? null;
  const totals = dayTotals(day.sessions.map(toSpan), now);

  return {
    workDate,
    status: day.status,
    isWorking: openSession != null,
    isOnBreak: openSession?.breaks.some((span) => span.endedAt == null) ?? false,
    openSession: openSession == null ? null : toWorkSession(openSession, now),
    workMinutes: totals.workMinutes,
    breakMinutes: totals.breakMinutes,
  };
}

export async function getHistory(
  db: Db,
  actor: Actor,
  query: AttendanceHistoryQuery,
): Promise<Paginated<AttendanceDay>> {
  const targetUserId = query.userId ?? actor.id;

  if (targetUserId !== actor.id && !(await canReadAttendanceOf(db, actor, targetUserId))) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'You do not have permission to see that person’s attendance.',
    );
  }

  const where: Prisma.AttendanceDayWhereInput = {
    userId: targetUserId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.from != null || query.to != null
      ? {
          workDate: {
            ...(query.from != null ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to != null ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
    ...(query.projectId != null ? { sessions: { some: { projectId: query.projectId } } } : {}),
  };

  const [total, rows] = await Promise.all([
    db.attendanceDay.count({ where }),
    db.attendanceDay.findMany({
      where,
      select: DAY_SELECT,
      orderBy: { workDate: 'desc' },
      ...paginate(query),
    }),
  ]);

  const now = new Date();
  return { data: rows.map((row) => toAttendanceDay(row, now)), meta: pageMeta(query, total) };
}

/**
 * Who is working today. Scoped to the projects the caller leads unless they hold
 * `attendance:read-all`.
 */
export async function getTeamAttendance(
  db: Db,
  actor: Actor,
  options: { date?: DateOnly; projectId?: string },
): Promise<TeamAttendanceRow[]> {
  const organization = await loadOrganization(db, actor.organizationId);
  const now = new Date();
  const workDate = options.date ?? today(organization.timezone, now);

  const seesEveryone = actor.permissions.has('attendance:read-all');
  if (!seesEveryone && !actor.permissions.has('attendance:read-team')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'You do not have permission to see team attendance.');
  }

  const users = await db.user.findMany({
    where: {
      organizationId: actor.organizationId,
      status: 'ACTIVE',
      ...(options.projectId != null
        ? { memberships: { some: { projectId: options.projectId } } }
        : seesEveryone
          ? {}
          : {
              memberships: {
                some: { project: { members: { some: { userId: actor.id, projectRole: 'LEAD' } } } },
              },
            }),
    },
    orderBy: { fullName: 'asc' },
    select: USER_SUMMARY_SELECT,
  });

  if (users.length === 0) return [];

  const days = await db.attendanceDay.findMany({
    where: {
      userId: { in: users.map((user) => user.id) },
      workDate: dateOnlyToDateColumn(workDate) as Date,
    },
    select: {
      userId: true,
      status: true,
      firstStartedAt: true,
      sessions: { select: SESSION_SELECT },
    },
  });

  const byUser = new Map(days.map((day) => [day.userId, day]));

  return users.map((user) => {
    const day = byUser.get(user.id);
    const openSession = day?.sessions.find((session) => session.endedAt == null) ?? null;
    const totals = day == null ? null : dayTotals(day.sessions.map(toSpan), now);

    return {
      user: toUserSummary(user),
      status: day?.status ?? null,
      isWorking: openSession != null,
      isOnBreak: openSession?.breaks.some((span) => span.endedAt == null) ?? false,
      firstStartedAt: day?.firstStartedAt?.toISOString() ?? null,
      workMinutes: totals?.workMinutes ?? 0,
      currentTask: openSession?.task ?? null,
    };
  });
}

/** An administrative correction, always audited (spec section 28). */
export async function adjustDay(
  db: RootDb,
  actor: Actor,
  userId: string,
  workDate: DateOnly,
  input: AdjustAttendanceInput,
): Promise<AttendanceDay> {
  if (!actor.permissions.has('attendance:read-all')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only an administrator can adjust attendance.');
  }

  const existing = await db.attendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate: dateOnlyToDateColumn(workDate) as Date } },
    select: { id: true, status: true },
  });

  const row =
    existing == null
      ? await db.attendanceDay.create({
          data: {
            userId,
            workDate: dateOnlyToDateColumn(workDate) as Date,
            status: input.status,
            adjustedById: actor.id,
            adjustmentReason: input.reason,
          },
          select: DAY_SELECT,
        })
      : await db.attendanceDay.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            adjustedById: actor.id,
            adjustmentReason: input.reason,
          },
          select: DAY_SELECT,
        });

  await recordAudit(db, {
    actorId: actor.id,
    action: 'attendance.adjusted',
    entityType: 'AttendanceDay',
    entityId: row.id,
    oldValue: { status: existing?.status ?? null },
    newValue: { status: input.status, reason: input.reason },
  });

  return toAttendanceDay(row, new Date());
}

// ------------------------------------------------------------------ helpers

interface OrganizationSettings {
  id: string;
  timezone: string;
  lateAfter: string;
  halfDayMinutes: number;
}

async function loadOrganization(db: Db, organizationId: string): Promise<OrganizationSettings> {
  return db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, timezone: true, lateAfter: true, halfDayMinutes: true },
  });
}

/**
 * Recomputes the day's totals and status from its sessions. The only writer of
 * `workMinutes`, `breakMinutes` and `status`.
 */
async function refreshDay(
  db: Db,
  attendanceDayId: string,
  organization: OrganizationSettings,
  now: Date,
): Promise<void> {
  const day = await db.attendanceDay.findUnique({
    where: { id: attendanceDayId },
    select: {
      id: true,
      workDate: true,
      status: true,
      adjustedById: true,
      sessions: {
        select: {
          startedAt: true,
          endedAt: true,
          breaks: { select: { startedAt: true, endedAt: true } },
        },
      },
    },
  });
  if (day == null) return;

  const totals = dayTotals(day.sessions.map(toSpan), now);
  const workDate = dateColumnToDateOnly(day.workDate) as DateOnly;

  const isHoliday =
    (await db.holiday.count({
      where: { organizationId: organization.id, date: day.workDate },
    })) > 0;

  // An administrator's correction is not overwritten by the automatic derivation.
  const status =
    day.adjustedById != null
      ? day.status
      : deriveAttendanceStatus({
          workDate,
          firstStartedAt: totals.firstStartedAt,
          workMinutes: totals.workMinutes,
          timezone: organization.timezone,
          lateAfter: organization.lateAfter,
          halfDayMinutes: organization.halfDayMinutes,
          isHoliday,
          onLeave: day.status === 'LEAVE',
        });

  await db.attendanceDay.update({
    where: { id: day.id },
    data: {
      workMinutes: totals.workMinutes,
      breakMinutes: totals.breakMinutes,
      status,
      ...(totals.firstStartedAt != null ? { firstStartedAt: totals.firstStartedAt } : {}),
      ...(totals.lastEndedAt != null ? { lastEndedAt: totals.lastEndedAt } : {}),
    },
  });
}

/** A session may only be attributed to a project the person can actually see. */
async function assertContextIsVisible(
  db: Db,
  actor: Actor,
  projectId: string | null | undefined,
  taskId: string | null | undefined,
): Promise<void> {
  if (projectId != null) {
    const visible = await db.project.count({
      where: {
        id: projectId,
        deletedAt: null,
        ...(actor.role === 'SUPER_ADMIN'
          ? { organizationId: actor.organizationId }
          : { members: { some: { userId: actor.id } } }),
      },
    });
    if (visible === 0) throw notFound('That project');
  }

  if (taskId != null) {
    const task = await db.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { projectId: true },
    });
    if (task == null) throw notFound('That task');
    if (projectId != null && task.projectId !== projectId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'That task does not belong to the project you selected.',
      );
    }
  }
}

function toSpan(session: {
  startedAt: Date;
  endedAt: Date | null;
  breaks: { startedAt: Date; endedAt: Date | null }[];
}): SessionSpan {
  return { startedAt: session.startedAt, endedAt: session.endedAt, breaks: session.breaks };
}

function toWorkSession(row: SessionRow, now: Date): WorkSession {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    minutes: row.endedAt == null ? sessionMinutes(toSpan(row), now) : row.minutes,
    project: row.project,
    task: row.task,
    note: row.note,
    breaks: row.breaks.map((span) => ({
      id: span.id,
      startedAt: span.startedAt.toISOString(),
      endedAt: span.endedAt?.toISOString() ?? null,
      reason: span.reason,
      minutes: span.endedAt == null ? minutesBetweenDates(span.startedAt, now) : span.minutes,
    })),
  };
}

function toAttendanceDay(row: DayRow, now: Date): AttendanceDay {
  const totals = dayTotals(row.sessions.map(toSpan), now);
  return {
    id: row.id,
    workDate: dateColumnToDateOnly(row.workDate) as DateOnly,
    user: toUserSummary(row.user),
    status: row.status,
    firstStartedAt: row.firstStartedAt?.toISOString() ?? null,
    lastEndedAt: row.lastEndedAt?.toISOString() ?? null,
    workMinutes: totals.workMinutes,
    breakMinutes: totals.breakMinutes,
    sessions: row.sessions.map((session) => toWorkSession(session, now)),
    adjustedBy: row.adjustedBy == null ? null : toUserSummary(row.adjustedBy),
    adjustmentReason: row.adjustmentReason,
  };
}

function minutesBetweenDates(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}
