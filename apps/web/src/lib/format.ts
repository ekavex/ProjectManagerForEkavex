/**
 * Display formatting.
 *
 * The server sends calendar dates as `YYYY-MM-DD` and instants as UTC ISO strings. This
 * module is the only place that turns either into something a person reads, so a date is
 * never rendered two different ways on two different screens.
 */
import type {
  AttendanceStatus,
  HealthLevel,
  IssueStatus,
  PhaseStatus,
  Priority,
  ProjectStatus,
  RiskLevel,
  RiskStatus,
  TaskStatus,
} from '@ekavist/shared';

/** A calendar date, e.g. "12 Sep 2026". Never shifted by a timezone: it has no time. */
export function formatDate(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (year == null || month == null || day == null) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A short calendar date without the year, for dense tables. */
export function formatDateShort(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (year == null || month == null || day == null) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** An instant, rendered in the viewer's own timezone. */
export function formatDateTime(value: string | null | undefined): string {
  if (value == null) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value: string | null | undefined): string {
  if (value == null) return '—';
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "just now", "12 minutes ago", "3 days ago". */
export function formatRelative(value: string | null | undefined): string {
  if (value == null) return '—';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(value.slice(0, 10));
}

export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return `${Math.round(hours * 10) / 10}h`;
}

/** Turns SCREAMING_SNAKE into "Screaming snake". */
export function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

// --------------------------------------------------------------- status tones

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  UNDER_REVIEW: 'warn',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
};

export const PHASE_STATUS_TONE: Record<PhaseStatus, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  UNDER_REVIEW: 'warn',
  APPROVED: 'ok',
  BLOCKED: 'danger',
  REWORK_REQUIRED: 'danger',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  DRAFT: 'neutral',
  PLANNED: 'info',
  ACTIVE: 'accent',
  ON_HOLD: 'warn',
  AT_RISK: 'danger',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
  ARCHIVED: 'neutral',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warn',
  CRITICAL: 'danger',
};

export const HEALTH_TONE: Record<HealthLevel, Tone> = {
  OK: 'ok',
  ATTENTION: 'warn',
  CRITICAL: 'danger',
};

export const RISK_TONE: Record<RiskLevel, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warn',
  VERY_HIGH: 'danger',
};

export const RISK_STATUS_TONE: Record<RiskStatus, Tone> = {
  OPEN: 'warn',
  MONITORING: 'info',
  MITIGATED: 'ok',
  CLOSED: 'neutral',
  OCCURRED: 'danger',
};

export const ISSUE_STATUS_TONE: Record<IssueStatus, Tone> = {
  OPEN: 'warn',
  INVESTIGATING: 'info',
  IN_PROGRESS: 'info',
  RESOLVED: 'ok',
  CLOSED: 'neutral',
};

export const ATTENDANCE_TONE: Record<AttendanceStatus, Tone> = {
  PRESENT: 'ok',
  LATE: 'warn',
  HALF_DAY: 'warn',
  LEAVE: 'info',
  ABSENT: 'danger',
  HOLIDAY: 'neutral',
};

/** Progress bar colour follows the schedule, not the number alone. */
export function progressTone(
  progress: number,
  variance?: number,
): 'accent' | 'ok' | 'warn' | 'danger' {
  if (progress >= 100) return 'ok';
  if (variance == null) return 'accent';
  if (variance <= -25) return 'danger';
  if (variance <= -10) return 'warn';
  return 'accent';
}

/** "3 days left", "Due today", "4 days overdue". */
export function dueLabel(daysUntilDue: number | null, isOverdue: boolean): string | null {
  if (daysUntilDue == null) return null;
  if (isOverdue) {
    const days = Math.abs(daysUntilDue);
    return `${days} day${days === 1 ? '' : 's'} overdue`;
  }
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  return `${daysUntilDue} days left`;
}
