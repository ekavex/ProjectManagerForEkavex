/**
 * Task business rules: what counts as overdue, which status changes are legal, and what
 * a task's counts add up to. Pure functions — every caller (dashboard, report,
 * notification scanner, task list) uses these rather than re-deriving the answer.
 */
import { TERMINAL_TASK_STATUSES, type TaskCounts, type TaskStatus } from '@ekavist/shared';
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

/**
 * Whether starting this task is discouraged because a Finish-to-Start predecessor has not
 * finished (spec section 20). This is a warning, not a prohibition: the user may override
 * it, and the override is recorded.
 */
export function blockingPredecessors<T extends { status: TaskStatus }>(
  predecessors: readonly T[],
): T[] {
  return predecessors.filter((task) => task.status !== 'COMPLETED' && task.status !== 'CANCELLED');
}

/** Statuses that mean work has begun, used to set a phase's actual start date. */
export function hasStarted(status: TaskStatus): boolean {
  return status !== 'NOT_STARTED' && status !== 'CANCELLED';
}
