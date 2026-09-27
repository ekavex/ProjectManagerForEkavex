/**
 * Deadline reminders and overdue escalation (spec sections 41 and 43).
 *
 * One scan covers every rule. The rules live in the database, so an administrator can
 * change "three days before" without a deploy, and the logic exists here only — no
 * feature computes its own reminders (master prompt section 22).
 *
 * Idempotence comes from the notification `dedupeKey`: one row per user, per rule, per
 * task, per day. Running the job twice produces one reminder.
 */
import type { NotificationType } from '@ekavist/shared';
import type { RootDb } from '../db/prisma.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  daysBetween,
  today,
  type DateOnly,
} from '../domain/time.js';
import { loggerFor } from '../lib/logger.js';
import { listRules, notify, notifyMany } from '../services/notification.service.js';

const log = loggerFor('jobs.deadline');

export interface DeadlineScanStats {
  rulesApplied: number;
  tasksExamined: number;
  notificationsCreated: number;
  leadDigests: number;
}

/**
 * Sends the "due soon", "due today" and "overdue" reminders for one organisation.
 *
 * `now` is injectable so the behaviour is testable without touching the clock.
 */
export async function runDeadlineScan(
  db: RootDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<DeadlineScanStats> {
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const todayDate = today(organization.timezone, now);

  const rules = (await listRules(db, organizationId)).filter((rule) => rule.enabled);
  const stats: DeadlineScanStats = {
    rulesApplied: rules.length,
    tasksExamined: 0,
    notificationsCreated: 0,
    leadDigests: 0,
  };
  if (rules.length === 0) return stats;

  // Every task that is still outstanding and has a due date inside the widest window any
  // rule cares about. One query, then the rules are applied in memory.
  const maxAhead = Math.max(0, ...rules.map((rule) => rule.offsetDays));
  const maxBehind = Math.max(0, ...rules.map((rule) => -rule.offsetDays));

  const tasks = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      dueDate: {
        gte: new Date(`${addDaysTo(todayDate, -maxBehind)}T00:00:00.000Z`),
        lte: new Date(`${addDaysTo(todayDate, maxAhead)}T00:00:00.000Z`),
      },
      project: {
        organizationId,
        deletedAt: null,
        status: { notIn: ['ARCHIVED', 'COMPLETED', 'CANCELLED'] },
      },
    },
    select: {
      id: true,
      reference: true,
      name: true,
      dueDate: true,
      progress: true,
      projectId: true,
      project: { select: { name: true, leadId: true } },
      assignments: { select: { userId: true } },
    },
  });

  stats.tasksExamined = tasks.length;

  for (const task of tasks) {
    const dueDate = dateColumnToDateOnly(task.dueDate);
    if (dueDate == null) continue;

    // Positive when the task is still ahead of its due date, negative once it has passed.
    const daysUntil = daysBetween(todayDate, dueDate);

    for (const rule of rules) {
      if (rule.offsetDays !== daysUntil) continue;

      const recipients = task.assignments.map((assignment) => assignment.userId);
      if (rule.notifyLead && task.project.leadId != null) recipients.push(task.project.leadId);
      if (recipients.length === 0) continue;

      const { type, title, template, whenLabel } = describe(rule.type, daysUntil, task.reference);

      await notifyMany(db, recipients, (userId) => ({
        userId,
        type,
        title,
        body: `${task.reference} ${task.name} in ${task.project.name} is ${whenLabel}.`,
        projectId: task.projectId,
        taskId: task.id,
        entityType: 'Task',
        entityId: task.id,
        link: `/projects/${task.projectId}/tasks/${task.id}`,
        // One reminder per user, per rule, per task, per day.
        dedupeKey: `${userId}:${rule.type}:${rule.offsetDays}:${task.id}:${todayDate}`,
        ...(rule.emailEnabled
          ? {
              email: {
                template,
                payload: {
                  projectId: task.projectId,
                  projectName: task.project.name,
                  taskId: task.id,
                  reference: task.reference,
                  taskName: task.name,
                  dueDate,
                  progress: task.progress,
                  whenLabel,
                  daysOverdue: Math.max(0, -daysUntil),
                },
              },
            }
          : {}),
      }));

      stats.notificationsCreated += recipients.length;
    }
  }

  stats.leadDigests = await sendLeadDigests(db, organizationId, todayDate);

  log.info({ organizationId, ...stats }, 'Deadline scan finished');
  return stats;
}

function describe(
  ruleType: NotificationType,
  daysUntil: number,
  reference: string,
): {
  type: NotificationType;
  title: string;
  template: 'task-due-soon' | 'task-overdue';
  whenLabel: string;
} {
  if (daysUntil < 0) {
    const days = -daysUntil;
    return {
      type: 'TASK_OVERDUE',
      title: `${reference} is overdue`,
      template: 'task-overdue',
      whenLabel: `${days} day${days === 1 ? '' : 's'} overdue`,
    };
  }
  if (daysUntil === 0) {
    return {
      type: 'TASK_DUE_TODAY',
      title: `${reference} is due today`,
      template: 'task-due-soon',
      whenLabel: 'due today',
    };
  }
  return {
    type: ruleType === 'TASK_DUE_TODAY' ? 'TASK_DUE_SOON' : ruleType,
    title: `${reference} is due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
    template: 'task-due-soon',
    whenLabel: `due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
  };
}

/**
 * The project-lead digest (spec section 43): one message per project summarising what
 * needs attention, rather than one message per overdue task.
 */
async function sendLeadDigests(
  db: RootDb,
  organizationId: string,
  todayDate: DateOnly,
): Promise<number> {
  const projects = await db.project.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { notIn: ['ARCHIVED', 'COMPLETED', 'CANCELLED'] },
      leadId: { not: null },
    },
    select: {
      id: true,
      name: true,
      leadId: true,
      tasks: {
        where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        select: { status: true, dueDate: true },
      },
      phases: {
        where: { status: { notIn: ['COMPLETED', 'APPROVED', 'CANCELLED'] } },
        select: { name: true, plannedEnd: true, approvalRequired: true, gateStatus: true },
      },
    },
  });

  let sent = 0;

  for (const project of projects) {
    if (project.leadId == null) continue;

    const overdue = project.tasks.filter((task) => {
      const dueDate = dateColumnToDateOnly(task.dueDate);
      return dueDate != null && dueDate < todayDate;
    }).length;
    const blocked = project.tasks.filter((task) => task.status === 'BLOCKED').length;
    const dueToday = project.tasks.filter(
      (task) => dateColumnToDateOnly(task.dueDate) === todayDate,
    ).length;
    const phasesPastDue = project.phases.filter((phase) => {
      const plannedEnd = dateColumnToDateOnly(phase.plannedEnd);
      return plannedEnd != null && plannedEnd < todayDate;
    });
    const gatesWaiting = project.phases.filter(
      (phase) => phase.approvalRequired && phase.gateStatus === 'SUBMITTED',
    );

    const lines: string[] = [];
    if (overdue > 0) lines.push(`${overdue} task${overdue === 1 ? ' is' : 's are'} overdue.`);
    if (blocked > 0) lines.push(`${blocked} task${blocked === 1 ? ' is' : 's are'} blocked.`);
    if (dueToday > 0) lines.push(`${dueToday} task${dueToday === 1 ? ' is' : 's are'} due today.`);
    for (const phase of phasesPastDue) {
      lines.push(`${phase.name} has passed its planned completion date.`);
    }
    for (const phase of gatesWaiting) {
      lines.push(`${phase.name} is waiting for an approval decision.`);
    }

    // Nothing to say is a good day; no message is sent.
    if (lines.length === 0) continue;

    const result = await notify(db, {
      userId: project.leadId,
      type: 'LEAD_OVERDUE_DIGEST',
      title: `${project.name}: ${lines.length} item${lines.length === 1 ? '' : 's'} need attention`,
      body: lines.join(' '),
      projectId: project.id,
      entityType: 'Project',
      entityId: project.id,
      link: `/projects/${project.id}`,
      dedupeKey: `${project.leadId}:LEAD_DIGEST:${project.id}:${todayDate}`,
      email: {
        template: 'lead-overdue-digest',
        payload: { projectId: project.id, projectName: project.name, lines },
      },
    });

    if (result.created) sent += 1;
  }

  return sent;
}
