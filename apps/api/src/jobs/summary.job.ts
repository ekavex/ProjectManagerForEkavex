/**
 * Daily and weekly summaries (spec section 47, master prompt section 48).
 *
 * Both are built from the same report functions the Reports screen uses, so a summary
 * email and the report it summarises can never disagree.
 */
import type { RootDb } from '../db/prisma.js';
import { dateColumnToDateOnly, today, weekRange } from '../domain/time.js';
import { loggerFor } from '../lib/logger.js';
import { notify } from '../services/notification.service.js';
import { buildWeeklyReport } from '../services/report.service.js';

const log = loggerFor('jobs.summary');

export interface SummaryStats {
  recipients: number;
  sent: number;
}

/**
 * One message per person, covering their own work: what they finished, what is still open,
 * and what is overdue. People who did nothing and have nothing outstanding are skipped.
 */
export async function runDailySummary(
  db: RootDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<SummaryStats> {
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const todayDate = today(organization.timezone, now);

  const users = await db.user.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      notificationPreference: { emailDailySummary: true },
    },
    select: { id: true },
  });

  const stats: SummaryStats = { recipients: users.length, sent: 0 };

  for (const user of users) {
    const tasks = await db.task.findMany({
      where: {
        deletedAt: null,
        assignments: { some: { userId: user.id } },
        project: { deletedAt: null, status: { notIn: ['ARCHIVED', 'CANCELLED'] } },
      },
      select: { reference: true, name: true, status: true, dueDate: true, completedAt: true },
    });

    const completedToday = tasks.filter(
      (task) => task.completedAt != null && dateColumnToDateOnly(task.completedAt) === todayDate,
    );
    const overdue = tasks.filter((task) => {
      const dueDate = dateColumnToDateOnly(task.dueDate);
      return (
        dueDate != null &&
        dueDate < todayDate &&
        task.status !== 'COMPLETED' &&
        task.status !== 'CANCELLED'
      );
    });
    const dueTomorrow = tasks.filter(
      (task) =>
        dateColumnToDateOnly(task.dueDate) != null &&
        (dateColumnToDateOnly(task.dueDate) as string) > todayDate &&
        task.status !== 'COMPLETED' &&
        task.status !== 'CANCELLED',
    );

    const lines: string[] = [];
    if (completedToday.length > 0) {
      lines.push(`Completed today: ${completedToday.map((task) => task.reference).join(', ')}`);
    }
    if (overdue.length > 0) {
      lines.push(`Overdue: ${overdue.map((task) => task.reference).join(', ')}`);
    }
    if (dueTomorrow.length > 0) {
      lines.push(`${dueTomorrow.length} task(s) still ahead of you`);
    }
    if (lines.length === 0) continue;

    const result = await notify(db, {
      userId: user.id,
      type: 'DAILY_SUMMARY',
      title: `Your day — ${todayDate}`,
      body: lines.join(' · '),
      link: '/my-work',
      dedupeKey: `${user.id}:DAILY_SUMMARY:${todayDate}`,
      email: {
        template: 'daily-summary',
        payload: { date: todayDate, lines },
      },
    });
    if (result.created) stats.sent += 1;
  }

  log.info({ organizationId, ...stats }, 'Daily summary finished');
  return stats;
}

/** One message per project, to its lead and members, built from the weekly report. */
export async function runWeeklySummary(
  db: RootDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<SummaryStats> {
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const todayDate = today(organization.timezone, now);
  const week = weekRange(todayDate);

  const projects = await db.project.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { notIn: ['ARCHIVED', 'CANCELLED', 'DRAFT'] },
    },
    select: {
      id: true,
      name: true,
      members: {
        where: {
          projectRole: { in: ['LEAD', 'MEMBER'] },
          user: { status: 'ACTIVE', notificationPreference: { emailWeeklySummary: true } },
        },
        select: { userId: true },
      },
    },
  });

  const stats: SummaryStats = { recipients: 0, sent: 0 };

  for (const project of projects) {
    if (project.members.length === 0) continue;
    stats.recipients += project.members.length;

    const report = await buildWeeklyReport(db, project.id, organization.timezone, todayDate);

    const lines = [
      `Overall progress: ${report.schedule.actualProgress}% (plan says ${report.schedule.plannedProgress}%).`,
      `Completed this week: ${report.completed.length}.`,
      `Overdue: ${report.overdue.length}. Blocked: ${report.blocked.length}.`,
      `Open risks: ${report.risks.length}. Open issues: ${report.issues.length}.`,
      `Next week: ${report.nextWeek.length} task(s) due.`,
    ];

    for (const member of project.members) {
      const result = await notify(db, {
        userId: member.userId,
        type: 'WEEKLY_SUMMARY',
        title: `Weekly summary — ${project.name}`,
        body: lines.join(' '),
        projectId: project.id,
        entityType: 'Project',
        entityId: project.id,
        link: `/projects/${project.id}/reports`,
        dedupeKey: `${member.userId}:WEEKLY_SUMMARY:${project.id}:${week.start}`,
        email: {
          template: 'weekly-summary',
          payload: {
            projectId: project.id,
            projectName: project.name,
            weekStart: week.start,
            weekEnd: week.end,
            lines,
          },
        },
      });
      if (result.created) stats.sent += 1;
    }
  }

  log.info({ organizationId, ...stats }, 'Weekly summary finished');
  return stats;
}
