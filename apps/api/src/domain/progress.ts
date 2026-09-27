/**
 * The single authoritative progress calculation (decision D-006, master prompt section 46).
 *
 * Task progress is authored by a person. Everything above it is derived:
 *
 *   wbsItem  = hours-weighted mean of its tasks and of its child WBS items
 *   phase    = rollup of its root WBS items, or of its direct tasks when it has no WBS
 *   project  = duration-weighted mean of its phases, or a plain task rollup when unphased
 *
 * Weighting by estimated hours means a two-hour task cannot outvote a two-week one. When
 * hours are missing the weight falls back to 1, which degrades to a simple mean.
 *
 * Every function here is pure: it takes plain records and returns numbers. Dashboards,
 * reports, the Gantt and the notification scanner all call these, so they cannot disagree.
 */
import { TERMINAL_TASK_STATUSES, type PhaseStatus, type TaskStatus } from '@ekavist/shared';

export interface ProgressTask {
  id: string;
  status: TaskStatus;
  progress: number;
  estimatedHours: number | null;
}

export interface ProgressNode {
  id: string;
  parentId: string | null;
  /** Direct tasks attached to this node. */
  tasks: ProgressTask[];
}

/** Weight of one task in a rollup. Never zero, so a task always counts for something. */
function weightOf(task: ProgressTask): number {
  const hours = task.estimatedHours;
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return 1;
  return hours;
}

/**
 * Effective progress of a single task.
 *
 * A completed task is 100 whatever the stored number says, and a cancelled task is
 * excluded from rollups entirely by `rollupTasks` rather than being counted as zero —
 * cancelling work should not drag a project's progress down.
 */
export function taskProgress(task: ProgressTask): number {
  if (task.status === 'COMPLETED') return 100;
  return clampPercent(task.progress);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Weighted mean over the tasks that still count as work. */
export function rollupTasks(tasks: readonly ProgressTask[]): number {
  const counted = tasks.filter((task) => task.status !== 'CANCELLED');
  if (counted.length === 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const task of counted) {
    const weight = weightOf(task);
    weighted += taskProgress(task) * weight;
    total += weight;
  }
  return total === 0 ? 0 : clampPercent(weighted / total);
}

/**
 * Rolls a WBS forest up from the leaves.
 *
 * Returns progress for every node, including nodes whose own tasks are empty but whose
 * children carry work. A node's weight in its parent is the summed weight of the work
 * beneath it, so an empty branch does not dilute a busy sibling.
 */
export function rollupWbsTree(nodes: readonly ProgressNode[]): Map<string, number> {
  const childrenOf = new Map<string, ProgressNode[]>();
  const roots: ProgressNode[] = [];
  for (const node of nodes) {
    if (node.parentId == null) {
      roots.push(node);
    } else {
      const siblings = childrenOf.get(node.parentId);
      if (siblings) siblings.push(node);
      else childrenOf.set(node.parentId, [node]);
    }
  }

  const progressById = new Map<string, number>();
  const weightById = new Map<string, number>();
  const visiting = new Set<string>();

  function visit(node: ProgressNode): { progress: number; weight: number } {
    const cached = progressById.get(node.id);
    if (cached != null) return { progress: cached, weight: weightById.get(node.id) ?? 0 };

    // A malformed tree must not hang the request; treat a cycle as a leaf.
    if (visiting.has(node.id)) return { progress: 0, weight: 0 };
    visiting.add(node.id);

    let weighted = 0;
    let total = 0;

    for (const task of node.tasks) {
      if (task.status === 'CANCELLED') continue;
      const weight = weightOf(task);
      weighted += taskProgress(task) * weight;
      total += weight;
    }

    for (const child of childrenOf.get(node.id) ?? []) {
      const result = visit(child);
      if (result.weight > 0) {
        weighted += result.progress * result.weight;
        total += result.weight;
      }
    }

    visiting.delete(node.id);
    const progress = total === 0 ? 0 : clampPercent(weighted / total);
    progressById.set(node.id, progress);
    weightById.set(node.id, total);
    return { progress, weight: total };
  }

  for (const root of roots) visit(root);
  // Nodes unreachable from a root (an orphaned parentId) still deserve a value.
  for (const node of nodes) if (!progressById.has(node.id)) visit(node);

  return progressById;
}

export interface PhaseProgressInput {
  id: string;
  /** Root WBS items belonging to the phase, with their rolled-up progress and weight. */
  wbsRoots: { progress: number; weight: number }[];
  /** Tasks attached straight to the phase without a WBS item. */
  directTasks: ProgressTask[];
  /** Planned duration in days; used to weight the phase inside the project. */
  plannedDays: number | null;
  /**
   * The phase's own status. A phase that has been completed or had its gate approved is
   * finished by decision, whatever its task list looks like — a Waterfall phase can
   * legitimately be signed off with no tasks recorded against it at all, and reporting
   * such a phase as 0% would understate the project.
   */
  status?: PhaseStatus;
}

export function phaseProgress(input: PhaseProgressInput): number {
  if (input.status === 'COMPLETED' || input.status === 'APPROVED') return 100;

  let weighted = 0;
  let total = 0;

  for (const root of input.wbsRoots) {
    if (root.weight <= 0) continue;
    weighted += root.progress * root.weight;
    total += root.weight;
  }
  for (const task of input.directTasks) {
    if (task.status === 'CANCELLED') continue;
    const weight = weightOf(task);
    weighted += taskProgress(task) * weight;
    total += weight;
  }

  return total === 0 ? 0 : clampPercent(weighted / total);
}

/**
 * Project progress: phases weighted by their planned duration, so a six-week Execution
 * phase counts for more than a two-day Kickoff. Phases with no planned dates fall back to
 * an equal weight of one day.
 */
export function projectProgress(
  phases: readonly { progress: number; plannedDays: number | null; cancelled?: boolean }[],
): number {
  const counted = phases.filter((phase) => !phase.cancelled);
  if (counted.length === 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const phase of counted) {
    const weight = phase.plannedDays != null && phase.plannedDays > 0 ? phase.plannedDays : 1;
    weighted += clampPercent(phase.progress) * weight;
    total += weight;
  }
  return total === 0 ? 0 : clampPercent(weighted / total);
}

/**
 * The progress a status implies when a user changes only the status.
 * Returning null means "leave the authored number alone".
 */
export function progressForStatus(status: TaskStatus, current: number): number | null {
  if (status === 'COMPLETED') return 100;
  if (status === 'NOT_STARTED' && current === 100) return 0;
  if (status === 'IN_PROGRESS' && current === 0) return 10;
  return null;
}

/**
 * The status a progress value implies when a user drags a progress bar.
 * Returning null means "leave the status alone".
 */
export function statusForProgress(progress: number, current: TaskStatus): TaskStatus | null {
  if (TERMINAL_TASK_STATUSES.includes(current)) return null;
  if (progress >= 100) return 'COMPLETED';
  if (progress > 0 && current === 'NOT_STARTED') return 'IN_PROGRESS';
  return null;
}
