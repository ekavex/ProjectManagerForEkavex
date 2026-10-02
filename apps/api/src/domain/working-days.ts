/**
 * Working days: Monday to Friday, less the organisation's public holidays. Used by leave
 * (how many days a request consumes) and by capacity planning (how many hours a person
 * has in a week).
 */
import { addDaysTo, type DateOnly } from './time.js';

export function isWeekend(date: DateOnly): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Every working date from `start` to `end` inclusive, in order. */
export function workingDates(
  start: DateOnly,
  end: DateOnly,
  holidays: ReadonlySet<DateOnly>,
): DateOnly[] {
  const dates: DateOnly[] = [];
  for (let date = start; date <= end; date = addDaysTo(date, 1)) {
    if (!isWeekend(date) && !holidays.has(date)) dates.push(date);
  }
  return dates;
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: DateOnly): DateOnly {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysTo(date, day === 0 ? -6 : 1 - day);
}
