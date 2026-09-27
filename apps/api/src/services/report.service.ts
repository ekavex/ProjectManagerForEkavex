/**
 * Reports (spec section 47).
 *
 * Every figure is queried, never stored and never guessed. The derived values come from
 * the same domain functions the dashboards use, so a report and a dashboard opened at the
 * same moment always agree.
 */
import type {
  DailyReport,
  FinalProjectReport,
  PhaseProgressSlice,
  ScheduleMetrics,
  TaskSummary,
  WeeklyReport,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { isOpenIssue, isOpenRisk } from '../domain/risk.js';
import { scheduleMetrics } from '../domain/schedule.js';
import { isOverdue } from '../domain/task-rules.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  daysBetween,
  today,
  weekRange,
  type DateOnly,
} from '../domain/time.js';
import { toTaskSummary } from './task.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

const TASK_SELECT = {
  id: true,
  reference: true,
  name: true,
  status: true,
  priority: true,
  progress: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  updatedAt: true,
  phase: { select: { id: true, name: true } },
  wbsItem: { select: { id: true, code: true } },
  project: { select: { id: true, code: true, name: true } },
  assignments: {
    orderBy: { isPrimary: 'desc' },
    select: { user: { select: USER_SUMMARY_SELECT } },
  },
} satisfies Prisma.TaskSelect;

// ----------------------------------------------------------------- daily

export async function buildDailyReport(
  db: Db,
  projectId: string,
  timezone: string,
  date?: DateOnly,
): Promise<DailyReport> {
  const reportDate = date ?? today(timezone);
  const dayStart = new Date(`${reportDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${reportDate}T23:59:59.999Z`);

  const [project, tasks, activity, sessions] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, code: true, name: true },
    }),
    db.task.findMany({
      where: { projectId, deletedAt: null },
      select: TASK_SELECT,
    }),
    db.activityLog.findMany({
      where: { projectId, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { actorId: true, actor: { select: USER_SUMMARY_SELECT } },
    }),
    db.workSession.findMany({
      where: { projectId, startedAt: { gte: dayStart, lte: dayEnd } },
      select: {
        userId: true,
        minutes: true,
        attendanceDay: { select: { user: { select: USER_SUMMARY_SELECT } } },
      },
    }),
  ]);

  const summaries = tasks.map((task) => toTaskSummary(task, reportDate));

  const completed = summaries.filter((_, index) => {
    const completedAt = tasks[index]?.completedAt;
    return completedAt != null && dateColumnToDateOnly(completedAt) === reportDate;
  });

  // "Started today" means the task is in progress and was touched today. The activity log
  // is the record of what happened, so it is what decides.
  const startedIds = new Set(
    tasks
      .filter(
        (task) =>
          task.status === 'IN_PROGRESS' && dateColumnToDateOnly(task.updatedAt) === reportDate,
      )
      .map((task) => task.id),
  );

  const perUser = new Map<
    string,
    { user: ReturnType<typeof toUserSummary>; updates: number; workMinutes: number }
  >();

  for (const entry of activity) {
    if (entry.actor == null) continue;
    const bucket = perUser.get(entry.actor.id) ?? {
      user: toUserSummary(entry.actor),
      updates: 0,
      workMinutes: 0,
    };
    bucket.updates += 1;
    perUser.set(entry.actor.id, bucket);
  }
  for (const session of sessions) {
    const user = session.attendanceDay.user;
    const bucket = perUser.get(session.userId) ?? {
      user: toUserSummary(user),
      updates: 0,
      workMinutes: 0,
    };
    bucket.workMinutes += session.minutes;
    perUser.set(session.userId, bucket);
  }

  return {
    date: reportDate,
    project,
    completed,
    started: summaries.filter((task) => startedIds.has(task.id)),
    overdue: summaries.filter((task) => task.isOverdue),
    blocked: summaries.filter((task) => task.status === 'BLOCKED'),
    activity: [...perUser.values()].sort((a, b) => b.updates - a.updates),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- weekly

export async function buildWeeklyReport(
  db: Db,
  projectId: string,
  timezone: string,
  weekOf?: DateOnly,
): Promise<WeeklyReport> {
  const anchor = weekOf ?? today(timezone);
  const week = weekRange(anchor);
  const todayDate = today(timezone);

  const [project, tasks, phases, risks, issues] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        code: true,
        name: true,
        progress: true,
        startDate: true,
        plannedEndDate: true,
      },
    }),
    db.task.findMany({ where: { projectId, deletedAt: null }, select: TASK_SELECT }),
    db.phase.findMany({
      where: { projectId },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        name: true,
        sequence: true,
        status: true,
        progress: true,
        plannedStart: true,
        plannedEnd: true,
      },
    }),
    db.risk.findMany({
      where: { projectId },
      orderBy: { severityScore: 'desc' },
      select: { id: true, reference: true, title: true, severity: true, status: true },
    }),
    db.issue.findMany({
      where: { projectId },
      select: { id: true, reference: true, title: true, priority: true, status: true },
    }),
  ]);

  const summaries = tasks.map((task) => toTaskSummary(task, todayDate));
  const nextWeek = weekRange(addDaysTo(week.end, 1));

  const completedThisWeek = summaries.filter((_, index) => {
    const completedAt = tasks[index]?.completedAt;
    if (completedAt == null) return false;
    const completedOn = dateColumnToDateOnly(completedAt) as DateOnly;
    return completedOn >= week.start && completedOn <= week.end;
  });

  return {
    weekStart: week.start,
    weekEnd: week.end,
    project: { id: project.id, code: project.code, name: project.name },
    schedule: scheduleMetrics({
      startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
      plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
      actualProgress: project.progress,
      todayDate,
    }),
    completed: completedThisWeek,
    overdue: summaries.filter((task) => task.isOverdue),
    blocked: summaries.filter((task) => task.status === 'BLOCKED'),
    phases: phases.map(toPhaseSlice),
    risks: risks
      .filter((risk) => isOpenRisk(risk.status))
      .map((risk) => ({
        id: risk.id,
        reference: risk.reference,
        title: risk.title,
        severity: risk.severity,
        status: risk.status,
      })),
    issues: issues
      .filter((issue) => isOpenIssue(issue.status))
      .map((issue) => ({
        id: issue.id,
        reference: issue.reference,
        title: issue.title,
        priority: issue.priority,
        status: issue.status,
      })),
    nextWeek: summaries.filter(
      (task) =>
        task.dueDate != null &&
        task.dueDate >= nextWeek.start &&
        task.dueDate <= nextWeek.end &&
        task.status !== 'COMPLETED' &&
        task.status !== 'CANCELLED',
    ),
    generatedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------ final

/**
 * The project completion report (spec section 47).
 *
 * "Delayed" is measured against the plan: a task finished after its due date, or still
 * unfinished past it. Deliverables are matched against the documents actually filed under
 * Final deliverables, so the report cannot claim a deliverable that does not exist.
 */
export async function buildFinalReport(
  db: Db,
  projectId: string,
  timezone: string,
): Promise<FinalProjectReport> {
  const todayDate = today(timezone);

  const [project, tasks, phases, decisions, changes, risks, issues, lessons, finalDocs] =
    await Promise.all([
      db.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          startDate: true,
          plannedEndDate: true,
          actualStartDate: true,
          actualEndDate: true,
          deliverables: true,
          handoverNote: true,
          lead: { select: USER_SUMMARY_SELECT },
        },
      }),
      db.task.findMany({
        where: { projectId, deletedAt: null },
        select: { status: true, dueDate: true, completedAt: true },
      }),
      db.phase.findMany({
        where: { projectId },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          name: true,
          sequence: true,
          status: true,
          progress: true,
          plannedStart: true,
          plannedEnd: true,
        },
      }),
      db.decisionLog.findMany({
        where: { projectId },
        orderBy: { decidedOn: 'asc' },
        select: {
          reference: true,
          title: true,
          decidedOn: true,
          decisionMaker: { select: USER_SUMMARY_SELECT },
        },
      }),
      db.changeRequest.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: { reference: true, title: true, status: true, scheduleImpactDays: true },
      }),
      db.risk.findMany({
        where: { projectId },
        orderBy: { severityScore: 'desc' },
        select: { reference: true, title: true, severity: true, status: true },
      }),
      db.issue.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: { reference: true, title: true, priority: true, status: true },
      }),
      db.projectLesson.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: {
          category: true,
          note: true,
          author: { select: USER_SUMMARY_SELECT },
        },
      }),
      db.document.findMany({
        where: { projectId, deletedAt: null, category: 'FINAL_DELIVERABLES' },
        select: { name: true },
      }),
    ]);

  const plannedStart = dateColumnToDateOnly(project.startDate) as DateOnly;
  const plannedEnd = dateColumnToDateOnly(project.plannedEndDate) as DateOnly;
  const actualStart = dateColumnToDateOnly(project.actualStartDate);
  const actualEnd = dateColumnToDateOnly(project.actualEndDate);

  const plannedDays = daysBetween(plannedStart, plannedEnd) + 1;
  const actualDays =
    actualStart != null && actualEnd != null ? daysBetween(actualStart, actualEnd) + 1 : null;

  const completed = tasks.filter((task) => task.status === 'COMPLETED');
  const cancelled = tasks.filter((task) => task.status === 'CANCELLED');
  const delayed = tasks.filter((task) => {
    const dueDate = dateColumnToDateOnly(task.dueDate);
    if (dueDate == null) return false;
    if (task.completedAt != null) {
      return (dateColumnToDateOnly(task.completedAt) as DateOnly) > dueDate;
    }
    return isOverdue({ status: task.status, dueDate }, todayDate);
  });

  const counted = tasks.length - cancelled.length;
  const deliveredNames = finalDocs.map((document) => document.name.toLowerCase());

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      lead: toUserSummaryOrNull(project.lead),
    },
    duration: {
      plannedStart,
      plannedEnd,
      actualStart,
      actualEnd,
      plannedDays,
      actualDays,
      varianceDays: actualDays == null ? null : actualDays - plannedDays,
    },
    tasks: {
      planned: tasks.length,
      completed: completed.length,
      cancelled: cancelled.length,
      delayed: delayed.length,
      completionRate: counted === 0 ? 0 : Math.round((completed.length / counted) * 100),
    },
    phases: phases.map(toPhaseSlice),
    deliverables: project.deliverables.map((name) => ({
      name,
      // A deliverable counts as delivered when a final document mentions it.
      delivered: deliveredNames.some(
        (document) =>
          document.includes(name.toLowerCase()) || name.toLowerCase().includes(document),
      ),
    })),
    decisions: decisions.map((decision) => ({
      reference: decision.reference,
      title: decision.title,
      decidedOn: dateColumnToDateOnly(decision.decidedOn) as DateOnly,
      by: decision.decisionMaker?.fullName ?? null,
    })),
    changeRequests: changes,
    risks,
    issues,
    lessons: lessons.map((lesson) => ({
      category: lesson.category,
      note: lesson.note,
      author: lesson.author?.fullName ?? null,
    })),
    handoverNote: project.handoverNote,
    generatedAt: new Date().toISOString(),
  };
}

function toPhaseSlice(phase: {
  id: string;
  name: string;
  sequence: number;
  status: string;
  progress: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}): PhaseProgressSlice {
  return {
    id: phase.id,
    name: phase.name,
    sequence: phase.sequence,
    status: phase.status,
    progress: phase.progress,
    plannedStart: dateColumnToDateOnly(phase.plannedStart),
    plannedEnd: dateColumnToDateOnly(phase.plannedEnd),
  };
}

export type { ScheduleMetrics, TaskSummary };
