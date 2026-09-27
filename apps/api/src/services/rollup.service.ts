/**
 * Progress recomputation.
 *
 * The derived progress on WBS items, phases and the project is a read cache
 * (decision D-006). This module is the only thing that writes it, and it is called inside
 * the same transaction as the task change that invalidated it, so a dashboard can never
 * show a number that disagrees with the task list.
 */
import type { Db } from '../db/prisma.js';
import {
  phaseProgress,
  projectProgress,
  rollupWbsTree,
  type ProgressNode,
  type ProgressTask,
} from '../domain/progress.js';
import { plannedDays } from '../domain/schedule.js';
import { dateColumnToDateOnly } from '../domain/time.js';

/**
 * Recomputes every derived progress value for one project.
 *
 * Deliberately a whole-project recomputation rather than an incremental one: a project has
 * hundreds of tasks, not millions, and the cost of one extra query is far lower than the
 * cost of an incremental update that drifts.
 */
export async function recomputeProjectProgress(db: Db, projectId: string): Promise<number> {
  const [wbsItems, tasks, phases] = await Promise.all([
    db.wbsItem.findMany({
      where: { projectId },
      select: { id: true, parentId: true, phaseId: true, progress: true },
    }),
    db.task.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        status: true,
        progress: true,
        estimatedHours: true,
        wbsItemId: true,
        phaseId: true,
      },
    }),
    db.phase.findMany({
      where: { projectId },
      select: {
        id: true,
        status: true,
        progress: true,
        plannedStart: true,
        plannedEnd: true,
      },
    }),
  ]);

  const tasksByWbs = new Map<string, ProgressTask[]>();
  const tasksByPhaseDirect = new Map<string, ProgressTask[]>();
  const unassigned: ProgressTask[] = [];

  for (const task of tasks) {
    const entry: ProgressTask = {
      id: task.id,
      status: task.status,
      progress: task.progress,
      estimatedHours: task.estimatedHours == null ? null : Number(task.estimatedHours),
    };
    if (task.wbsItemId != null) {
      push(tasksByWbs, task.wbsItemId, entry);
    } else if (task.phaseId != null) {
      push(tasksByPhaseDirect, task.phaseId, entry);
    } else {
      unassigned.push(entry);
    }
  }

  const nodes: ProgressNode[] = wbsItems.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    tasks: tasksByWbs.get(item.id) ?? [],
  }));
  const wbsProgress = rollupWbsTree(nodes);

  // The weight a WBS root carries into its phase is the amount of work beneath it.
  const weightByWbs = new Map<string, number>();
  for (const item of wbsItems) {
    weightByWbs.set(item.id, subtreeWeight(item.id, nodes));
  }

  const phaseResults = phases.map((phase) => {
    const roots = wbsItems
      .filter((item) => item.phaseId === phase.id && item.parentId == null)
      .map((item) => ({
        progress: wbsProgress.get(item.id) ?? 0,
        weight: weightByWbs.get(item.id) ?? 0,
      }));

    const progress = phaseProgress({
      id: phase.id,
      wbsRoots: roots,
      directTasks: tasksByPhaseDirect.get(phase.id) ?? [],
      plannedDays: plannedDays(
        dateColumnToDateOnly(phase.plannedStart),
        dateColumnToDateOnly(phase.plannedEnd),
      ),
      status: phase.status,
    });

    return {
      id: phase.id,
      progress,
      plannedDays: plannedDays(
        dateColumnToDateOnly(phase.plannedStart),
        dateColumnToDateOnly(phase.plannedEnd),
      ),
      cancelled: phase.status === 'CANCELLED',
      previous: phase.progress,
    };
  });

  let overall = projectProgress(phaseResults);

  // A project with no phases at all still has to report something sensible.
  if (phases.length === 0) {
    const everything = [...tasksByWbs.values()].flat().concat(unassigned);
    overall = everything.length === 0 ? 0 : rollupProgressOf(everything);
  }

  // Only write the rows whose value actually changed.
  await Promise.all([
    ...wbsItems
      .filter((item) => (wbsProgress.get(item.id) ?? 0) !== item.progress)
      .map((item) =>
        db.wbsItem.update({
          where: { id: item.id },
          data: { progress: wbsProgress.get(item.id) ?? 0 },
        }),
      ),
    ...phaseResults
      .filter((phase) => phase.progress !== phase.previous)
      .map((phase) =>
        db.phase.update({ where: { id: phase.id }, data: { progress: phase.progress } }),
      ),
  ]);

  await db.project.update({ where: { id: projectId }, data: { progress: overall } });

  return overall;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** Total task weight in a node's subtree, matching the weighting used by the rollup. */
function subtreeWeight(rootId: string, nodes: readonly ProgressNode[]): number {
  const childrenOf = new Map<string, ProgressNode[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    push(childrenOf, node.parentId, node);
  }

  let total = 0;
  const stack = [rootId];
  const seen = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  while (stack.length > 0) {
    const currentId = stack.pop() as string;
    if (seen.has(currentId)) continue;
    seen.add(currentId);

    const node = byId.get(currentId);
    if (node == null) continue;
    for (const task of node.tasks) {
      if (task.status === 'CANCELLED') continue;
      total += task.estimatedHours != null && task.estimatedHours > 0 ? task.estimatedHours : 1;
    }
    for (const child of childrenOf.get(currentId) ?? []) stack.push(child.id);
  }

  return total;
}

function rollupProgressOf(tasks: readonly ProgressTask[]): number {
  let weighted = 0;
  let total = 0;
  for (const task of tasks) {
    if (task.status === 'CANCELLED') continue;
    const weight = task.estimatedHours != null && task.estimatedHours > 0 ? task.estimatedHours : 1;
    weighted += (task.status === 'COMPLETED' ? 100 : task.progress) * weight;
    total += weight;
  }
  return total === 0 ? 0 : Math.round(weighted / total);
}
