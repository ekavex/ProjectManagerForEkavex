/**
 * Schedule metrics and project health (spec sections 51 and 52).
 *
 * Health is derived from measurable conditions, never from someone's opinion, and every
 * indicator carries the sentence that explains it — a dashboard that says "Attention"
 * without saying why is not useful.
 */
import type { HealthLevel, ScheduleMetrics, HealthIndicator, ProjectHealth } from '@ekavist/shared';
import { daysBetween, type DateOnly } from './time.js';

export interface ScheduleInput {
  startDate: DateOnly;
  plannedEndDate: DateOnly;
  actualProgress: number;
  todayDate: DateOnly;
}

/**
 * Planned progress is the share of the planned duration that has elapsed. It is the
 * simplest defensible baseline, and the spec explicitly defers earned value to a later
 * version (section 53).
 */
export function scheduleMetrics(input: ScheduleInput): ScheduleMetrics {
  const totalDays = Math.max(1, daysBetween(input.startDate, input.plannedEndDate) + 1);
  const elapsedRaw = daysBetween(input.startDate, input.todayDate) + 1;
  const elapsedDays = Math.min(totalDays, Math.max(0, elapsedRaw));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const plannedProgress = Math.round((elapsedDays / totalDays) * 100);
  const actualProgress = Math.min(100, Math.max(0, Math.round(input.actualProgress)));

  return {
    plannedProgress,
    actualProgress,
    variance: actualProgress - plannedProgress,
    elapsedDays,
    totalDays,
    remainingDays,
    forecastEndDate: forecastEnd(input, elapsedRaw),
  };
}

/**
 * Straight-line forecast: at the rate achieved so far, when would the work finish?
 * Returns null before any measurable progress, rather than inventing a date.
 */
function forecastEnd(input: ScheduleInput, elapsedRaw: number): DateOnly | null {
  if (input.actualProgress <= 0 || elapsedRaw <= 0) return null;
  const projectedDays = Math.ceil((elapsedRaw / input.actualProgress) * 100);
  const date = new Date(`${input.startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + projectedDays - 1);
  return date.toISOString().slice(0, 10);
}

export interface HealthInput {
  schedule: ScheduleMetrics;
  taskTotal: number;
  overdueTasks: number;
  blockedTasks: number;
  /** Dependencies whose predecessor is unfinished while the successor is already running. */
  violatedDependencies: number;
  /** Gates waiting on a decision past the phase's planned end. */
  overdueGates: number;
  openHighRisks: number;
  openIssues: number;
}

/** Thresholds, kept together so the rules are visible in one place rather than scattered. */
const THRESHOLDS = {
  scheduleAttention: -10,
  scheduleCritical: -25,
  overdueAttentionRatio: 0.05,
  overdueCriticalRatio: 0.15,
  blockedAttention: 1,
  blockedCritical: 5,
  issuesAttention: 1,
  issuesCritical: 5,
  risksAttention: 1,
  risksCritical: 3,
} as const;

export function projectHealth(input: HealthInput): ProjectHealth {
  const indicators: HealthIndicator[] = [];

  // --- schedule ----------------------------------------------------------
  const variance = input.schedule.variance;
  indicators.push({
    key: 'SCHEDULE',
    label: 'Schedule',
    level:
      variance <= THRESHOLDS.scheduleCritical
        ? 'CRITICAL'
        : variance <= THRESHOLDS.scheduleAttention
          ? 'ATTENTION'
          : 'OK',
    detail:
      variance < 0
        ? `${Math.abs(variance)}% behind the plan (${input.schedule.actualProgress}% done, ${input.schedule.plannedProgress}% expected).`
        : `On or ahead of plan (${input.schedule.actualProgress}% done, ${input.schedule.plannedProgress}% expected).`,
  });

  // --- tasks and overdue -------------------------------------------------
  const overdueRatio = input.taskTotal === 0 ? 0 : input.overdueTasks / input.taskTotal;
  indicators.push({
    key: 'OVERDUE',
    label: 'Overdue tasks',
    level:
      overdueRatio >= THRESHOLDS.overdueCriticalRatio
        ? 'CRITICAL'
        : input.overdueTasks > 0 && overdueRatio >= THRESHOLDS.overdueAttentionRatio
          ? 'ATTENTION'
          : input.overdueTasks > 0
            ? 'ATTENTION'
            : 'OK',
    detail:
      input.overdueTasks === 0
        ? 'Nothing is past its due date.'
        : `${input.overdueTasks} of ${input.taskTotal} tasks are past their due date.`,
  });

  indicators.push({
    key: 'TASKS',
    label: 'Blocked work',
    level:
      input.blockedTasks >= THRESHOLDS.blockedCritical
        ? 'CRITICAL'
        : input.blockedTasks >= THRESHOLDS.blockedAttention
          ? 'ATTENTION'
          : 'OK',
    detail:
      input.blockedTasks === 0
        ? 'No tasks are blocked.'
        : `${input.blockedTasks} task${input.blockedTasks === 1 ? ' is' : 's are'} blocked.`,
  });

  // --- dependencies ------------------------------------------------------
  indicators.push({
    key: 'DEPENDENCIES',
    label: 'Dependencies',
    level: input.violatedDependencies === 0 ? 'OK' : 'ATTENTION',
    detail:
      input.violatedDependencies === 0
        ? 'Every running task has its predecessors finished.'
        : `${input.violatedDependencies} task${input.violatedDependencies === 1 ? '' : 's'} started before a predecessor finished.`,
  });

  // --- phase gates -------------------------------------------------------
  indicators.push({
    key: 'PHASE_GATE',
    label: 'Phase gates',
    level: input.overdueGates === 0 ? 'OK' : 'ATTENTION',
    detail:
      input.overdueGates === 0
        ? 'No approval is overdue.'
        : `${input.overdueGates} phase gate${input.overdueGates === 1 ? ' is' : 's are'} waiting for a decision past the planned date.`,
  });

  // --- risks and issues --------------------------------------------------
  indicators.push({
    key: 'RISKS',
    label: 'Risks',
    level:
      input.openHighRisks >= THRESHOLDS.risksCritical
        ? 'CRITICAL'
        : input.openHighRisks >= THRESHOLDS.risksAttention
          ? 'ATTENTION'
          : 'OK',
    detail:
      input.openHighRisks === 0
        ? 'No open high-severity risks.'
        : `${input.openHighRisks} open high-severity risk${input.openHighRisks === 1 ? '' : 's'}.`,
  });

  indicators.push({
    key: 'ISSUES',
    label: 'Issues',
    level:
      input.openIssues >= THRESHOLDS.issuesCritical
        ? 'CRITICAL'
        : input.openIssues >= THRESHOLDS.issuesAttention
          ? 'ATTENTION'
          : 'OK',
    detail:
      input.openIssues === 0
        ? 'No open issues.'
        : `${input.openIssues} open issue${input.openIssues === 1 ? '' : 's'}.`,
  });

  return { overall: worstLevel(indicators.map((indicator) => indicator.level)), indicators };
}

export function worstLevel(levels: readonly HealthLevel[]): HealthLevel {
  if (levels.includes('CRITICAL')) return 'CRITICAL';
  if (levels.includes('ATTENTION')) return 'ATTENTION';
  return 'OK';
}

/** Planned duration of a phase in days; null when it has no planned dates. */
export function plannedDays(start: DateOnly | null, end: DateOnly | null): number | null {
  if (start == null || end == null) return null;
  return Math.max(1, daysBetween(start, end) + 1);
}
