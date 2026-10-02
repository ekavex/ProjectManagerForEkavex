/**
 * Earned-value metrics (spec sections 52 and 53).
 *
 * Measured in estimated hours rather than money, because every task can carry an estimate
 * and actual hours while very few carry a cost. The arithmetic is the standard one:
 *
 *   BAC  budget at completion   sum of estimates of the tasks still in the plan
 *   PV   planned value          the share of each estimate scheduled to be done by today
 *   EV   earned value           the share of each estimate actually done (its progress)
 *   AC   actual cost            hours actually booked
 *   SPI = EV / PV, CPI = EV / AC, EAC = BAC / CPI
 */
import type { EarnedValueMetrics, TaskStatus } from '@ekavist/shared';
import { daysBetween, type DateOnly } from './time.js';

export interface EarnedValueTask {
  status: TaskStatus;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
}

/**
 * How much of a task should be done by `todayDate`, from 0 to 1, assuming the work is
 * spread evenly between its start and due dates. A task with only a due date is planned to
 * finish on that date; one with no dates has no schedule, so it contributes nothing to PV.
 */
export function plannedFraction(task: EarnedValueTask, todayDate: DateOnly): number {
  const end = task.dueDate ?? null;
  if (end == null) return 0;
  const start = task.startDate ?? end;
  if (todayDate < start) return 0;
  if (todayDate >= end) return 1;
  const total = daysBetween(start, end) + 1;
  const elapsed = daysBetween(start, todayDate) + 1;
  return Math.min(1, Math.max(0, elapsed / total));
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function earnedValue(
  tasks: readonly EarnedValueTask[],
  todayDate: DateOnly,
): EarnedValueMetrics {
  let bac = 0;
  let pv = 0;
  let ev = 0;
  let ac = 0;
  let withoutEstimate = 0;

  for (const task of tasks) {
    // A cancelled task is out of the plan; any hours booked against it still count as cost.
    if (task.status === 'CANCELLED') {
      ac += task.actualHours ?? 0;
      continue;
    }
    ac += task.actualHours ?? 0;
    if (task.estimatedHours == null) {
      if (task.status !== 'COMPLETED') withoutEstimate += 1;
      continue;
    }
    const estimate = task.estimatedHours;
    const progress = task.status === 'COMPLETED' ? 100 : task.progress;
    bac += estimate;
    pv += estimate * plannedFraction(task, todayDate);
    ev += (estimate * progress) / 100;
  }

  const spi = pv > 0 ? round2(ev / pv) : null;
  const cpi = ac > 0 ? round2(ev / ac) : null;

  return {
    asOf: todayDate,
    unit: 'HOURS',
    budgetAtCompletion: round1(bac),
    plannedValue: round1(pv),
    earnedValue: round1(ev),
    actualCost: round1(ac),
    scheduleVariance: round1(ev - pv),
    costVariance: round1(ev - ac),
    spi,
    cpi,
    estimateAtCompletion: cpi != null && cpi > 0 ? round1(bac / (ev / ac)) : null,
    tasksWithoutEstimate: withoutEstimate,
  };
}
