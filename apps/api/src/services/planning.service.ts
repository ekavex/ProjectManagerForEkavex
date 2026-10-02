/**
 * Resource planning (spec section 84) and the calendar (spec section 85).
 *
 * Capacity answers "who is available, who is overloaded, who has room next month" from
 * data the system already holds: working days, holidays, approved leave, project
 * allocations and the remaining estimated hours of open tasks.
 */
import type {
  CalendarEvent,
  CalendarQuery,
  CapacityQuery,
  CapacityReport,
  CapacityRow,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { mondayOf, workingDates } from '../domain/working-days.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policy/actor.js';
import { loadProjectContext, visibleProjectIds } from '../policy/project-access.js';
import { USER_SUMMARY_SELECT, toUserSummary } from './user.mapper.js';
import { ERROR_CODES } from '@ekavist/shared';

const OPEN_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'UNDER_REVIEW'] as const;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The people whose plans the actor may see: everyone for an administrator or anyone who
 * can read all attendance, otherwise the members of the projects they lead.
 */
async function plannableUserIds(db: Db, actor: Actor): Promise<string[] | null> {
  if (actor.role === 'SUPER_ADMIN' || actor.permissions.has('attendance:read-all')) return null;
  const members = await db.projectMember.findMany({
    where: {
      project: { deletedAt: null, members: { some: { userId: actor.id, projectRole: 'LEAD' } } },
    },
    select: { userId: true },
  });
  return [...new Set([actor.id, ...members.map((member) => member.userId)])];
}

async function holidayDates(db: Db, organizationId: string, from: DateOnly, to: DateOnly) {
  const rows = await db.holiday.findMany({
    where: {
      organizationId,
      date: { gte: dateOnlyToDateColumn(from) as Date, lte: dateOnlyToDateColumn(to) as Date },
    },
    select: { date: true, name: true, id: true },
  });
  return rows.map((row) => ({ ...row, date: dateColumnToDateOnly(row.date) as DateOnly }));
}

// ------------------------------------------------------------------ capacity

export async function getCapacity(
  db: Db,
  actor: Actor,
  query: CapacityQuery,
): Promise<CapacityReport> {
  const todayDate = today(actor.timezone);
  const start = mondayOf(query.from ?? todayDate);
  const end = addDaysTo(start, query.weeks * 7 - 1);
  const weekStarts = Array.from({ length: query.weeks }, (_, index) => addDaysTo(start, index * 7));

  const allowed = await plannableUserIds(db, actor);
  const [organization, users, holidays] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { fullDayMinutes: true },
    }),
    db.user.findMany({
      where: {
        organizationId: actor.organizationId,
        status: 'ACTIVE',
        ...(allowed == null ? {} : { id: { in: allowed } }),
        ...(query.departmentId != null ? { departmentId: query.departmentId } : {}),
      },
      orderBy: { fullName: 'asc' },
      select: {
        ...USER_SUMMARY_SELECT,
        memberships: {
          where: {
            project: {
              deletedAt: null,
              status: { in: ['PLANNED', 'ACTIVE', 'AT_RISK', 'ON_HOLD'] },
            },
          },
          select: { allocationPercent: true },
        },
      },
    }),
    holidayDates(db, actor.organizationId, start, end),
  ]);
  const userIds = users.map((user) => user.id);
  const hoursPerDay = organization.fullDayMinutes / 60;
  const holidaySet = new Set(holidays.map((holiday) => holiday.date));

  const [leave, tasks] = await Promise.all([
    db.leaveRequest.findMany({
      where: {
        userId: { in: userIds },
        status: 'APPROVED',
        startDate: { lte: dateOnlyToDateColumn(end) as Date },
        endDate: { gte: dateOnlyToDateColumn(start) as Date },
      },
      select: { userId: true, startDate: true, endDate: true, halfDay: true },
    }),
    db.task.findMany({
      where: {
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        estimatedHours: { not: null },
        dueDate: { not: null },
        project: { deletedAt: null, status: { in: ['PLANNED', 'ACTIVE', 'AT_RISK', 'ON_HOLD'] } },
        assignments: { some: { userId: { in: userIds } } },
      },
      select: {
        startDate: true,
        dueDate: true,
        progress: true,
        estimatedHours: true,
        assignments: { select: { userId: true } },
      },
    }),
  ]);

  // Leave per person per date, so a day is never subtracted twice.
  const leaveByUser = new Map<string, Map<DateOnly, number>>();
  for (const request of leave) {
    const days = leaveByUser.get(request.userId) ?? new Map<DateOnly, number>();
    const from = dateColumnToDateOnly(request.startDate) as DateOnly;
    const to = dateColumnToDateOnly(request.endDate) as DateOnly;
    for (const date of workingDates(from, to, holidaySet)) {
      days.set(date, Math.max(days.get(date) ?? 0, request.halfDay ? 0.5 : 1));
    }
    leaveByUser.set(request.userId, days);
  }

  // Remaining hours per person per week. Each task's remaining estimate is shared among
  // its assignees and spread evenly over its working days from today (or its start, if
  // later) to its due date. Overdue work lands in the first week, where it really is.
  const planned = new Map<string, number[]>();
  const firstDay = start > todayDate ? start : todayDate;
  for (const task of tasks) {
    const assignees = task.assignments.map((a) => a.userId).filter((id) => userIds.includes(id));
    if (assignees.length === 0) continue;
    const remaining =
      (Number(task.estimatedHours) * (100 - task.progress)) / 100 / task.assignments.length;
    if (remaining <= 0) continue;

    const due = dateColumnToDateOnly(task.dueDate) as DateOnly;
    const taskStart = dateColumnToDateOnly(task.startDate);
    const from = taskStart != null && taskStart > firstDay ? taskStart : firstDay;
    const spread = due < from ? [] : workingDates(from, due, holidaySet);

    const share = new Array<number>(query.weeks).fill(0);
    if (spread.length === 0) {
      if (due <= end) share[0] = remaining;
    } else {
      for (const date of spread) {
        const week = Math.floor((Date.parse(date) - Date.parse(start)) / (7 * 86_400_000));
        if (week >= 0 && week < query.weeks) share[week]! += remaining / spread.length;
      }
    }
    for (const userId of assignees) {
      const totals = planned.get(userId) ?? new Array<number>(query.weeks).fill(0);
      share.forEach((hours, index) => (totals[index]! += hours));
      planned.set(userId, totals);
    }
  }

  const rows: CapacityRow[] = users.map((user) => {
    const leaveDays = leaveByUser.get(user.id) ?? new Map<DateOnly, number>();
    const totals = planned.get(user.id) ?? new Array<number>(query.weeks).fill(0);
    return {
      user: toUserSummary(user),
      projects: user.memberships.length,
      allocationPercent: user.memberships.reduce((sum, m) => sum + m.allocationPercent, 0),
      weeks: weekStarts.map((weekStart, index) => {
        const dates = workingDates(weekStart, addDaysTo(weekStart, 6), holidaySet);
        const away = dates.reduce((sum, date) => sum + (leaveDays.get(date) ?? 0), 0);
        const capacityHours = round1((dates.length - away) * hoursPerDay);
        const plannedHours = round1(totals[index] ?? 0);
        return {
          weekStart,
          capacityHours,
          plannedHours,
          leaveDays: away,
          utilisation: capacityHours > 0 ? Math.round((plannedHours / capacityHours) * 100) : null,
        };
      }),
    };
  });

  return { from: start, weeks: query.weeks, rows, generatedAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ calendar

const MAX_CALENDAR_DAYS = 100;

export async function getCalendar(
  db: Db,
  actor: Actor,
  query: CalendarQuery,
): Promise<CalendarEvent[]> {
  if (Date.parse(query.to) - Date.parse(query.from) > MAX_CALENDAR_DAYS * 86_400_000) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Ask for at most ${MAX_CALENDAR_DAYS} days at a time.`,
    );
  }
  const from = dateOnlyToDateColumn(query.from) as Date;
  const to = dateOnlyToDateColumn(query.to) as Date;

  let projectIds: string[] | null;
  if (query.projectId != null) {
    await loadProjectContext(db, actor, query.projectId);
    projectIds = [query.projectId];
  } else {
    projectIds = await visibleProjectIds(db, actor);
  }
  const projectWhere: Prisma.ProjectWhereInput = {
    deletedAt: null,
    organizationId: actor.organizationId,
    ...(projectIds == null ? {} : { id: { in: projectIds } }),
  };

  // Leave is shown for the people the caller works with, never with the reason.
  const leaveUserIds = query.mine
    ? [actor.id]
    : (
        await db.projectMember.findMany({
          where: { project: projectWhere },
          select: { userId: true },
        })
      )
        .map((member) => member.userId)
        .concat(actor.id);

  const [tasks, milestones, phases, leave, holidays] = await Promise.all([
    db.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        dueDate: { gte: from, lte: to },
        project: projectWhere,
        ...(query.mine ? { assignments: { some: { userId: actor.id } } } : {}),
      },
      orderBy: { dueDate: 'asc' },
      take: 1000,
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        dueDate: true,
        project: { select: { id: true, code: true } },
      },
    }),
    query.mine
      ? Promise.resolve([])
      : db.milestone.findMany({
          where: { date: { gte: from, lte: to }, project: projectWhere },
          select: {
            id: true,
            name: true,
            status: true,
            date: true,
            project: { select: { id: true, code: true } },
          },
        }),
    query.mine
      ? Promise.resolve([])
      : db.phase.findMany({
          where: {
            project: projectWhere,
            OR: [{ plannedStart: { gte: from, lte: to } }, { plannedEnd: { gte: from, lte: to } }],
          },
          select: {
            id: true,
            name: true,
            status: true,
            plannedStart: true,
            plannedEnd: true,
            project: { select: { id: true, code: true } },
          },
        }),
    db.leaveRequest.findMany({
      where: {
        organizationId: actor.organizationId,
        userId: { in: [...new Set(leaveUserIds)] },
        status: 'APPROVED',
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: {
        id: true,
        type: true,
        startDate: true,
        endDate: true,
        halfDay: true,
        user: { select: { fullName: true } },
      },
    }),
    holidayDates(db, actor.organizationId, query.from, query.to),
  ]);

  const events: CalendarEvent[] = [];
  for (const task of tasks) {
    events.push({
      id: `task-${task.id}`,
      kind: 'TASK_DUE',
      date: dateColumnToDateOnly(task.dueDate) as DateOnly,
      endDate: null,
      title: `${task.reference} ${task.name}`,
      projectId: task.project.id,
      projectCode: task.project.code,
      link: `/projects/${task.project.id}/tasks/${task.id}`,
      status: task.status,
    });
  }
  for (const milestone of milestones) {
    events.push({
      id: `milestone-${milestone.id}`,
      kind: 'MILESTONE',
      date: dateColumnToDateOnly(milestone.date) as DateOnly,
      endDate: null,
      title: milestone.name,
      projectId: milestone.project.id,
      projectCode: milestone.project.code,
      link: `/projects/${milestone.project.id}/milestones`,
      status: milestone.status,
    });
  }
  for (const phase of phases) {
    const startDate = dateColumnToDateOnly(phase.plannedStart);
    const endDate = dateColumnToDateOnly(phase.plannedEnd);
    for (const [kind, date] of [
      ['PHASE_START', startDate],
      ['PHASE_END', endDate],
    ] as const) {
      if (date == null || date < query.from || date > query.to) continue;
      events.push({
        id: `${kind.toLowerCase()}-${phase.id}`,
        kind,
        date,
        endDate: null,
        title: `${phase.name} ${kind === 'PHASE_START' ? 'starts' : 'ends'}`,
        projectId: phase.project.id,
        projectCode: phase.project.code,
        link: `/projects/${phase.project.id}/phases`,
        status: phase.status,
      });
    }
  }
  for (const request of leave) {
    events.push({
      id: `leave-${request.id}`,
      kind: 'LEAVE',
      date: dateColumnToDateOnly(request.startDate) as DateOnly,
      endDate: dateColumnToDateOnly(request.endDate),
      title: `${request.user.fullName} on ${request.halfDay ? 'half-day ' : ''}leave`,
      projectId: null,
      projectCode: null,
      link: null,
      status: request.type,
    });
  }
  for (const holiday of holidays) {
    events.push({
      id: `holiday-${holiday.id}`,
      kind: 'HOLIDAY',
      date: holiday.date,
      endDate: null,
      title: holiday.name,
      projectId: null,
      projectCode: null,
      link: null,
      status: null,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
