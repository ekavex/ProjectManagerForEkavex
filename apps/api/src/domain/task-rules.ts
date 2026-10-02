/**
 * Task business rules: what counts as overdue, which status changes are legal, and what
 * a task's counts add up to. Pure functions — every caller (dashboard, report,
 * notification scanner, task list) uses these rather than re-deriving the answer.
 */
import {
  TERMINAL_TASK_STATUSES,
  type DependencyType,
  type TaskCompletionRules,
  type TaskCounts,
  type TaskStatus,
} from '@ekavist/shared';
import { daysBetween, type DateOnly } from './time.js';

export interface OverdueInput {
  status: TaskStatus;
  dueDate: DateOnly | null;
}

/**
 * A task is overdue when its due date has passed and the work is not finished.
 *
 * Note that the comparison is against today's date *in the organisation timezone*, which
 * the caller supplies — a task due today is not overdue until that day is over.
 */
export function isOverdue(task: OverdueInput, todayDate: DateOnly): boolean {
  if (task.dueDate == null) return false;
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return false;
  return task.dueDate < todayDate;
}

export function isDueToday(task: OverdueInput, todayDate: DateOnly): boolean {
  if (task.dueDate == null) return false;
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return false;
  return task.dueDate === todayDate;
}

/** Days until the due date: 0 today, negative once overdue, null with no due date. */
export function daysUntilDue(task: OverdueInput, todayDate: DateOnly): number | null {
  if (task.dueDate == null) return null;
  return daysBetween(todayDate, task.dueDate);
}

export function emptyTaskCounts(): TaskCounts {
  return {
    total: 0,
    notStarted: 0,
    inProgress: 0,
    blocked: 0,
    underReview: 0,
    completed: 0,
    cancelled: 0,
    overdue: 0,
    dueToday: 0,
  };
}

const COUNT_KEY: Record<TaskStatus, keyof TaskCounts> = {
  NOT_STARTED: 'notStarted',
  IN_PROGRESS: 'inProgress',
  BLOCKED: 'blocked',
  UNDER_REVIEW: 'underReview',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export function countTasks(tasks: readonly OverdueInput[], todayDate: DateOnly): TaskCounts {
  const counts = emptyTaskCounts();
  for (const task of tasks) {
    counts.total += 1;
    counts[COUNT_KEY[task.status]] += 1;
    if (isOverdue(task, todayDate)) counts.overdue += 1;
    else if (isDueToday(task, todayDate)) counts.dueToday += 1;
  }
  return counts;
}

/**
 * Legal status transitions.
 *
 * Deliberately permissive: project work is messy and a lead reopening a completed task is
 * ordinary. What is forbidden is leaving a cancelled task, which would resurrect work that
 * a decision removed from the plan — that requires creating a new task, so the decision
 * stays visible in the history.
 */
const FORBIDDEN_FROM: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
  CANCELLED: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'UNDER_REVIEW', 'COMPLETED'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return !(FORBIDDEN_FROM[from] ?? []).includes(to);
}

export function transitionError(from: TaskStatus, to: TaskStatus): string {
  if (from === 'CANCELLED') {
    return 'This task was cancelled. Create a new task rather than reopening it, so the cancellation stays in the project history.';
  }
  return `A task cannot move from ${from} to ${to}.`;
}

export interface DependencyLink<T extends { status: TaskStatus }> {
  type: DependencyType;
  predecessor: T;
}

export interface DependencyConflict<T> {
  predecessor: T;
  /** What is unmet, phrased to follow the predecessor's reference. */
  reason: 'has not started yet' | 'has not finished yet';
}

const finished = (status: TaskStatus): boolean => status === 'COMPLETED' || status === 'CANCELLED';
const started = (status: TaskStatus): boolean => status !== 'NOT_STARTED';

/**
 * The dependencies a status change would break (spec section 20), for all four types:
 *
 *   Finish-to-Start   the successor should not start before the predecessor finishes
 *   Start-to-Start    the successor should not start before the predecessor starts
 *   Finish-to-Finish  the successor should not finish before the predecessor finishes
 *   Start-to-Finish   the successor should not finish before the predecessor starts
 *
 * Like the original Finish-to-Start rule these are warnings the user may override, and
 * a cancelled predecessor never blocks anything.
 */
export function dependencyConflicts<T extends { status: TaskStatus }>(
  from: TaskStatus,
  to: TaskStatus,
  links: readonly DependencyLink<T>[],
): DependencyConflict<T>[] {
  const starting =
    from === 'NOT_STARTED' && (to === 'IN_PROGRESS' || to === 'UNDER_REVIEW' || to === 'COMPLETED');
  const completing = to === 'COMPLETED' && from !== 'COMPLETED';
  const conflicts: DependencyConflict<T>[] = [];

  for (const { type, predecessor } of links) {
    const status = predecessor.status;
    if (status === 'CANCELLED') continue;
    if (type === 'FINISH_TO_START' && starting && !finished(status)) {
      conflicts.push({ predecessor, reason: 'has not finished yet' });
    } else if (type === 'START_TO_START' && starting && !started(status)) {
      conflicts.push({ predecessor, reason: 'has not started yet' });
    } else if (type === 'FINISH_TO_FINISH' && completing && !finished(status)) {
      conflicts.push({ predecessor, reason: 'has not finished yet' });
    } else if (type === 'START_TO_FINISH' && completing && !started(status)) {
      conflicts.push({ predecessor, reason: 'has not started yet' });
    }
  }
  return conflicts;
}

/**
 * Whether a dependency is already broken by the tasks' current states, for the project
 * health indicator: the same four rules as `dependencyConflicts`, judged after the fact.
 */
export function isDependencyViolated(
  type: DependencyType,
  predecessor: TaskStatus,
  successor: TaskStatus,
): boolean {
  if (predecessor === 'CANCELLED' || successor === 'CANCELLED') return false;
  const successorStarted = successor !== 'NOT_STARTED';
  const successorFinished = successor === 'COMPLETED';
  switch (type) {
    case 'FINISH_TO_START':
      return successorStarted && !finished(predecessor);
    case 'START_TO_START':
      return successorStarted && !started(predecessor);
    case 'FINISH_TO_FINISH':
      return successorFinished && !finished(predecessor);
    case 'START_TO_FINISH':
      return successorFinished && !started(predecessor);
  }
}

/**
 * What a task still lacks before it may be completed, under the project's completion
 * criteria (business rule 7). Empty means it may complete.
 */
export function unmetCompletionCriteria(
  rules: TaskCompletionRules,
  evidence: { note: string | null | undefined; actualHours: number | null; attachments: number },
): string[] {
  const unmet: string[] = [];
  if (rules.requiresNote && (evidence.note == null || evidence.note.trim() === '')) {
    unmet.push('a completion note');
  }
  if (rules.requiresActualHours && (evidence.actualHours == null || evidence.actualHours <= 0)) {
    unmet.push('the actual hours spent');
  }
  if (rules.requiresAttachment && evidence.attachments === 0) {
    unmet.push('at least one attachment or linked document');
  }
  return unmet;
}

/** Statuses that mean work has begun, used to set a phase's actual start date. */
export function hasStarted(status: TaskStatus): boolean {
  return status !== 'NOT_STARTED' && status !== 'CANCELLED';
}
