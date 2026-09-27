/**
 * The only place that converts between instants and calendar days.
 *
 * The rule (decision D-003): an instant is a `Date` in UTC; a calendar value is a
 * `YYYY-MM-DD` string interpreted in the organisation's timezone. "Overdue" therefore
 * means "the working day ended where the company is", never "the server clock passed
 * midnight". Every comparison of a due date against now goes through this module.
 */
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, differenceInCalendarDays, startOfWeek, endOfWeek } from 'date-fns';

/** A calendar date with no time component, as stored in `@db.Date` columns. */
export type DateOnly = string;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): value is DateOnly {
  return DATE_ONLY.test(value);
}

/** Formats the calendar date that `instant` falls on, in `timezone`. */
export function toDateOnly(instant: Date, timezone: string): DateOnly {
  const zoned = toZonedTime(instant, timezone);
  const year = zoned.getFullYear();
  const month = `${zoned.getMonth() + 1}`.padStart(2, '0');
  const day = `${zoned.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's calendar date in `timezone`. */
export function today(timezone: string, now: Date = new Date()): DateOnly {
  return toDateOnly(now, timezone);
}

/**
 * The instant at which `date` begins in `timezone`. This is what a `@db.Date` column
 * should be written with, so the stored day is the intended one regardless of where the
 * server runs.
 */
export function startOfDayUtc(date: DateOnly, timezone: string): Date {
  return fromZonedTime(`${date}T00:00:00`, timezone);
}

/** The instant one millisecond before `date` ends in `timezone`. */
export function endOfDayUtc(date: DateOnly, timezone: string): Date {
  return new Date(fromZonedTime(`${date}T00:00:00`, timezone).getTime() + 86_400_000 - 1);
}

/**
 * Reads a `@db.Date` column back as a calendar string.
 *
 * Postgres returns a DATE as midnight UTC, so the calendar day is read in UTC rather than
 * in the organisation timezone — converting it again would shift the day for any zone
 * west of Greenwich.
 */
export function dateColumnToDateOnly(value: Date | null | undefined): DateOnly | null {
  if (value == null) return null;
  return value.toISOString().slice(0, 10);
}

/** Writes a calendar string into a `@db.Date` column. */
export function dateOnlyToDateColumn(value: DateOnly | null | undefined): Date | null {
  if (value == null) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return differenceInCalendarDays(new Date(`${to}T00:00:00Z`), new Date(`${from}T00:00:00Z`));
}

export function addDaysTo(date: DateOnly, days: number): DateOnly {
  return addDays(new Date(`${date}T00:00:00Z`), days)
    .toISOString()
    .slice(0, 10);
}

export function minDate(a: DateOnly | null, b: DateOnly | null): DateOnly | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly | null, b: DateOnly | null): DateOnly | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

/** Monday-to-Sunday week containing `date`. */
export function weekRange(date: DateOnly): { start: DateOnly; end: DateOnly } {
  const anchor = new Date(`${date}T00:00:00Z`);
  return {
    start: startOfWeek(anchor, { weekStartsOn: 1 }).toISOString().slice(0, 10),
    end: endOfWeek(anchor, { weekStartsOn: 1 }).toISOString().slice(0, 10),
  };
}

/**
 * Combines a calendar date and a local `HH:mm` into an instant in `timezone`.
 * Used to decide whether a work session started after the organisation's late threshold.
 */
export function atLocalTime(date: DateOnly, timeOfDay: string, timezone: string): Date {
  return fromZonedTime(`${date}T${timeOfDay}:00`, timezone);
}

/** Minutes between two instants, never negative. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/** `135` becomes `2h 15m`; `0` becomes `0m`. */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
