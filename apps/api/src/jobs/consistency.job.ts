/**
 * The derived-progress consistency check (decision D-006, Phase 19).
 *
 * Progress on WBS items, phases and projects is a read cache: `rollup.service.ts` writes
 * it inside the same transaction as the task change that invalidated it. That is correct
 * for every write that goes through a service, and wrong for anything that reaches the
 * database another way — a manual correction, a restored backup, a migration that touches
 * task rows. D-006 recorded that gap; this job closes it.
 *
 * The job recomputes every project from its tasks, writes back whatever had drifted, and
 * reports what it changed. Drift is logged at warn level with the project and the two
 * values, because a project that drifts repeatedly is a bug somewhere else and the log is
 * where that becomes visible.
 */
import type { RootDb } from '../db/prisma.js';
import { loggerFor } from '../lib/logger.js';
import { recomputeProjectProgress } from '../services/rollup.service.js';

const log = loggerFor('jobs.consistency');

/** One row whose cached progress did not match what the tasks beneath it imply. */
export interface ProgressDrift {
  projectId: string;
  projectCode: string;
  entity: 'PROJECT' | 'PHASE' | 'WBS_ITEM';
  id: string;
  was: number;
  now: number;
}

export interface ConsistencyScanStats {
  projectsExamined: number;
  projectsWithDrift: number;
  rowsCorrected: number;
  /** Capped, so a systemic problem cannot write an unbounded row into `ScheduledJobRun`. */
  drift: ProgressDrift[];
}

const MAX_REPORTED_DRIFT = 50;

/**
 * Recomputes derived progress for every live project in one organisation.
 *
 * Each project is recomputed in its own transaction: a project whose recomputation fails
 * must not roll back the corrections already made to the others, and holding one
 * transaction open across every project in the company is a lock no background job should
 * be taking.
 */
export async function runConsistencyScan(
  db: RootDb,
  organizationId: string,
): Promise<ConsistencyScanStats> {
  const projects = await db.project.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });

  const stats: ConsistencyScanStats = {
    projectsExamined: projects.length,
    projectsWithDrift: 0,
    rowsCorrected: 0,
    drift: [],
  };

  for (const project of projects) {
    const before = await snapshot(db, project.id);

    await db.$transaction((tx) => recomputeProjectProgress(tx, project.id));

    const after = await snapshot(db, project.id);
    const differences = diff(project.id, project.code, before, after);

    if (differences.length > 0) {
      stats.projectsWithDrift += 1;
      stats.rowsCorrected += differences.length;
      for (const entry of differences) {
        if (stats.drift.length < MAX_REPORTED_DRIFT) stats.drift.push(entry);
      }
      log.warn(
        { projectId: project.id, code: project.code, corrected: differences.length, differences },
        'Derived progress had drifted and was corrected',
      );
    }
  }

  if (stats.projectsWithDrift === 0) {
    log.info({ projectsExamined: stats.projectsExamined }, 'Derived progress is consistent');
  }

  return stats;
}

interface Snapshot {
  project: number;
  phases: Map<string, number>;
  wbsItems: Map<string, number>;
}

async function snapshot(db: RootDb, projectId: string): Promise<Snapshot> {
  const [project, phases, wbsItems] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { progress: true } }),
    db.phase.findMany({ where: { projectId }, select: { id: true, progress: true } }),
    db.wbsItem.findMany({ where: { projectId }, select: { id: true, progress: true } }),
  ]);

  return {
    project: project.progress,
    phases: new Map(phases.map((row) => [row.id, row.progress])),
    wbsItems: new Map(wbsItems.map((row) => [row.id, row.progress])),
  };
}

function diff(
  projectId: string,
  projectCode: string,
  before: Snapshot,
  after: Snapshot,
): ProgressDrift[] {
  const entries: ProgressDrift[] = [];

  if (before.project !== after.project) {
    entries.push({
      projectId,
      projectCode,
      entity: 'PROJECT',
      id: projectId,
      was: before.project,
      now: after.project,
    });
  }

  for (const [id, now] of after.phases) {
    const was = before.phases.get(id);
    if (was != null && was !== now) {
      entries.push({ projectId, projectCode, entity: 'PHASE', id, was, now });
    }
  }
  for (const [id, now] of after.wbsItems) {
    const was = before.wbsItems.get(id);
    if (was != null && was !== now) {
      entries.push({ projectId, projectCode, entity: 'WBS_ITEM', id, was, now });
    }
  }

  return entries;
}
