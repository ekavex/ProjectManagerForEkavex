/**
 * The background scheduler (decision D-004).
 *
 * `node-cron` inside the API process, behind a `JobRunner` interface so the business logic
 * never knows what drives it. Every execution is recorded in `ScheduledJobRun`, keyed by a
 * logical window, so a restart cannot make a daily job fire twice for the same day, and a
 * failure leaves a row saying what went wrong rather than vanishing.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { prisma, isUniqueConstraintError, type RootDb } from '../db/prisma.js';
import { today } from '../domain/time.js';
import { loggerFor } from '../lib/logger.js';
import { dispatchQueue } from '../mail/outbox.js';
import { purgeExpiredTokens } from '../services/auth.service.js';
import { runConsistencyScan } from './consistency.job.js';
import { runDeadlineScan } from './deadline.job.js';
import { runDailySummary, runWeeklySummary } from './summary.job.js';

const log = loggerFor('scheduler');

export interface JobDefinition {
  name: string;
  cronExpression: string;
  /** The logical window this run belongs to, used to make the run idempotent. */
  runKey: (now: Date, timezone: string) => string;
  run: (db: RootDb, organizationId: string, now: Date) => Promise<unknown>;
}

const JOBS: JobDefinition[] = [
  {
    name: 'deadline-scan',
    cronExpression: env.JOBS_DEADLINE_SCAN_CRON,
    runKey: (now, timezone) => today(timezone, now),
    run: (db, organizationId, now) => runDeadlineScan(db, organizationId, now),
  },
  {
    name: 'daily-summary',
    cronExpression: env.JOBS_DAILY_SUMMARY_CRON,
    runKey: (now, timezone) => today(timezone, now),
    run: (db, organizationId, now) => runDailySummary(db, organizationId, now),
  },
  {
    name: 'weekly-summary',
    cronExpression: env.JOBS_WEEKLY_SUMMARY_CRON,
    runKey: (now, timezone) => today(timezone, now),
    run: (db, organizationId, now) => runWeeklySummary(db, organizationId, now),
  },
  {
    name: 'consistency-scan',
    cronExpression: env.JOBS_CONSISTENCY_SCAN_CRON,
    runKey: (now, timezone) => today(timezone, now),
    run: (db, organizationId) => runConsistencyScan(db, organizationId),
  },
  {
    name: 'token-purge',
    cronExpression: '30 3 * * *',
    runKey: (now, timezone) => today(timezone, now),
    run: async (db) => purgeExpiredTokens(db),
  },
];

let tasks: ScheduledTask[] = [];

/**
 * Runs one job for one organisation, exactly once per logical window.
 *
 * The `ScheduledJobRun` insert is the lock: a unique constraint on (jobName, runKey) means
 * a second attempt for the same window simply finds the row taken and returns.
 */
export async function runJobOnce(
  db: RootDb,
  job: JobDefinition,
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; error?: string }> {
  const runKey = `${organizationId}:${job.runKey(now, timezone)}`;

  let runId: string;
  try {
    const row = await db.scheduledJobRun.create({
      data: { jobName: job.name, runKey },
      select: { id: true },
    });
    runId = row.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      log.debug({ job: job.name, runKey }, 'Job already ran for this window');
      return { ran: false };
    }
    throw error;
  }

  try {
    const stats = await job.run(db, organizationId, now);
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        succeeded: true,
        stats: (stats ?? {}) as never,
      },
    });
    return { ran: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A failed job is recorded rather than swallowed, and does not bring the process down.
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: { finishedAt: new Date(), succeeded: false, error: message.slice(0, 2000) },
    });
    log.error({ err: error, job: job.name, organizationId }, 'Scheduled job failed');
    return { ran: true, error: message };
  }
}

export function startScheduler(): void {
  if (!env.JOBS_ENABLED) {
    log.info('Background jobs are disabled by configuration');
    return;
  }

  for (const job of JOBS) {
    if (!cron.validate(job.cronExpression)) {
      log.error(
        { job: job.name, cron: job.cronExpression },
        'Invalid cron expression; job not scheduled',
      );
      continue;
    }

    const task = cron.schedule(
      job.cronExpression,
      () => {
        void (async () => {
          const organizations = await prisma.organization.findMany({
            select: { id: true, timezone: true },
          });
          for (const organization of organizations) {
            await runJobOnce(prisma, job, organization.id, organization.timezone);
          }
        })().catch((error: unknown) => {
          log.error({ err: error, job: job.name }, 'Scheduled job crashed');
        });
      },
      { timezone: env.ORG_TIMEZONE },
    );

    tasks.push(task);
    log.info({ job: job.name, cron: job.cronExpression }, 'Job scheduled');
  }

  // Mail delivery is not per-organisation and has no daily window: it drains whatever is
  // queued, as often as configured.
  if (cron.validate(env.JOBS_MAIL_DISPATCH_CRON)) {
    const mailTask = cron.schedule(env.JOBS_MAIL_DISPATCH_CRON, () => {
      void dispatchQueue(prisma)
        .then((stats) => {
          if (stats.attempted > 0) log.info(stats, 'Mail queue dispatched');
        })
        .catch((error: unknown) => log.error({ err: error }, 'Mail dispatch failed'));
    });
    tasks.push(mailTask);
    log.info({ cron: env.JOBS_MAIL_DISPATCH_CRON }, 'Mail dispatch scheduled');
  }
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks = [];
}

/** Exposed so an administrator can trigger a scan, and so tests can drive it directly. */
export const jobs = JOBS;
