/**
 * Attendance arithmetic and status derivation.
 *
 * Two rules drive everything here (spec sections 27 to 30):
 *   1. Logging in is not attendance. A day exists only once someone starts work.
 *   2. Break time is not work time. Work minutes are session minutes minus break minutes.
 */
import type { AttendanceStatus } from '@ekavist/shared';
import { atLocalTime, minutesBetween, type DateOnly } from './time.js';

export interface BreakSpan {
  startedAt: Date;
  endedAt: Date | null;
}

export interface SessionSpan {
  startedAt: Date;
  endedAt: Date | null;
  breaks: BreakSpan[];
}

/**
 * Minutes of a single session, excluding breaks. An open session is measured up to `now`,
 * so the dashboard can show a running total without writing to the database.
 */
export function sessionMinutes(session: SessionSpan, now: Date = new Date()): number {
  const end = session.endedAt ?? now;
  const gross = minutesBetween(session.startedAt, end);
  return Math.max(0, gross - breakMinutes(session.breaks, now));
}

export function breakMinutes(breaks: readonly BreakSpan[], now: Date = new Date()): number {
  let total = 0;
  for (const span of breaks) {
    total += minutesBetween(span.startedAt, span.endedAt ?? now);
  }
  return total;
}

export interface DayTotals {
  workMinutes: number;
  breakMinutes: number;
  firstStartedAt: Date | null;
  lastEndedAt: Date | null;
}

export function dayTotals(sessions: readonly SessionSpan[], now: Date = new Date()): DayTotals {
  let work = 0;
  let breaks = 0;
  let first: Date | null = null;
  let last: Date | null = null;

  for (const session of sessions) {
    work += sessionMinutes(session, now);
    breaks += breakMinutes(session.breaks, now);
    if (first == null || session.startedAt < first) first = session.startedAt;
    if (session.endedAt != null && (last == null || session.endedAt > last)) {
      last = session.endedAt;
    }
  }

  return { workMinutes: work, breakMinutes: breaks, firstStartedAt: first, lastEndedAt: last };
}

export interface AttendanceStatusInput {
  workDate: DateOnly;
  firstStartedAt: Date | null;
  workMinutes: number;
  timezone: string;
  /** Organisation settings. */
  lateAfter: string;
  halfDayMinutes: number;
  isHoliday: boolean;
  onLeave: boolean;
}

/**
 * Derives the day's status. Explicit leave and holidays win; otherwise the status follows
 * from when work started and how long it lasted.
 *
 * A day with no session at all is ABSENT, but note that a day row is only created when
 * someone starts work — marking a person absent is the reporting layer's job, not this
 * function's.
 */
export function deriveAttendanceStatus(input: AttendanceStatusInput): AttendanceStatus {
  if (input.onLeave) return 'LEAVE';
  if (input.isHoliday) return 'HOLIDAY';
  if (input.firstStartedAt == null) return 'ABSENT';

  if (input.workMinutes > 0 && input.workMinutes < input.halfDayMinutes) return 'HALF_DAY';

  const threshold = atLocalTime(input.workDate, input.lateAfter, input.timezone);
  if (input.firstStartedAt > threshold) return 'LATE';

  return 'PRESENT';
}

/**
 * Whether two sessions overlap in time. Used to refuse a backdated or corrected session
 * that would double-count a stretch of the day (spec section 74, duplicate prevention).
 */
export function overlaps(
  a: { startedAt: Date; endedAt: Date | null },
  b: { startedAt: Date; endedAt: Date | null },
  now: Date = new Date(),
): boolean {
  const aEnd = a.endedAt ?? now;
  const bEnd = b.endedAt ?? now;
  return a.startedAt < bEnd && b.startedAt < aEnd;
}
