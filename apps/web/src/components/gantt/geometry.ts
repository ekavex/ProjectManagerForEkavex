/**
 * Gantt geometry.
 *
 * Pure functions: dates in, pixel positions out. Kept apart from the component so the
 * arithmetic that decides where a bar sits can be unit-tested without rendering anything
 * (decision D-005).
 */
import type { GanttBar, GanttDependency } from '@ekavist/shared';

export type Granularity = 'day' | 'week' | 'month';

/** Column width in pixels for each zoom level. A day is a column at "day" zoom. */
export const DAY_WIDTH: Record<Granularity, number> = {
  day: 28,
  week: 8,
  month: 3.2,
};

export const ROW_HEIGHT = 32;
export const BAR_HEIGHT = 16;

export function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const result = parseDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Horizontal offset of a date from the start of the window. */
export function xFor(date: string, from: string, dayWidth: number): number {
  return daysBetween(from, date) * dayWidth;
}

export interface BarGeometry {
  /** Left edge in pixels. */
  x: number;
  /** Width in pixels; a milestone is zero and is drawn as a diamond. */
  width: number;
  /** Vertical centre of the row. */
  y: number;
}

export function barGeometry(
  bar: GanttBar,
  rowIndex: number,
  from: string,
  dayWidth: number,
): BarGeometry | null {
  if (bar.start == null || bar.end == null) return null;

  const x = xFor(bar.start, from, dayWidth);
  // A task that starts and ends on the same day still occupies that whole day.
  const width = Math.max(dayWidth * 0.6, (daysBetween(bar.start, bar.end) + 1) * dayWidth);

  return {
    x,
    width: bar.kind === 'MILESTONE' ? 0 : width,
    y: rowIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
  };
}

export interface TimelineColumn {
  label: string;
  /** Left edge in pixels. */
  x: number;
  width: number;
  /** Marks weekends at day zoom and the first column of a month elsewhere. */
  emphasis: boolean;
}

/**
 * The header columns for the current zoom level.
 *
 * At day zoom every day is a column; at week zoom every Monday; at month zoom every first
 * of the month. The label always says enough to locate a bar without counting columns.
 */
export function timelineColumns(
  from: string,
  to: string,
  granularity: Granularity,
): TimelineColumn[] {
  const dayWidth = DAY_WIDTH[granularity];
  const total = daysBetween(from, to) + 1;
  const columns: TimelineColumn[] = [];

  if (granularity === 'day') {
    for (let offset = 0; offset < total; offset += 1) {
      const date = addDays(from, offset);
      const weekday = parseDate(date).getUTCDay();
      columns.push({
        label: String(parseDate(date).getUTCDate()),
        x: offset * dayWidth,
        width: dayWidth,
        emphasis: weekday === 0 || weekday === 6,
      });
    }
    return columns;
  }

  if (granularity === 'week') {
    let offset = 0;
    // Start at the first Monday on or before the window start.
    const firstDay = parseDate(from).getUTCDay();
    const backtrack = (firstDay + 6) % 7;
    offset -= backtrack;

    while (offset < total) {
      const date = addDays(from, offset);
      columns.push({
        label: formatDayMonth(date),
        x: offset * dayWidth,
        width: 7 * dayWidth,
        emphasis: parseDate(date).getUTCDate() <= 7,
      });
      offset += 7;
    }
    return columns;
  }

  // Month zoom.
  let cursor = parseDate(from);
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const end = parseDate(to);

  while (cursor <= end) {
    const monthStart = cursor.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const days = Math.round((next.getTime() - cursor.getTime()) / 86_400_000);

    columns.push({
      label: cursor.toLocaleDateString('en-GB', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      x: daysBetween(from, monthStart) * dayWidth,
      width: days * dayWidth,
      emphasis: cursor.getUTCMonth() === 0,
    });
    cursor = next;
  }
  return columns;
}

function formatDayMonth(date: string): string {
  return parseDate(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

export interface DependencyPath {
  id: string;
  /** SVG path data for the connector. */
  d: string;
}

/**
 * The elbow connector between two bars.
 *
 * Finish-to-Start runs from the right edge of the predecessor to the left edge of the
 * successor. When the successor starts before the predecessor finishes — which the
 * application allows, with a warning — the connector routes around rather than doubling
 * back through the bars.
 */
export function dependencyPaths(
  dependencies: readonly GanttDependency[],
  bars: readonly GanttBar[],
  rowIndexById: ReadonlyMap<string, number>,
  from: string,
  dayWidth: number,
): DependencyPath[] {
  const barsById = new Map(bars.map((bar) => [bar.id, bar]));
  const paths: DependencyPath[] = [];

  for (const dependency of dependencies) {
    const fromBar = barsById.get(dependency.fromId);
    const toBar = barsById.get(dependency.toId);
    const fromRow = rowIndexById.get(dependency.fromId);
    const toRow = rowIndexById.get(dependency.toId);

    if (fromBar == null || toBar == null || fromRow == null || toRow == null) continue;

    const start = barGeometry(fromBar, fromRow, from, dayWidth);
    const finish = barGeometry(toBar, toRow, from, dayWidth);
    if (start == null || finish == null) continue;

    const x1 = start.x + start.width;
    const y1 = start.y + BAR_HEIGHT / 2;
    const x2 = finish.x;
    const y2 = finish.y + BAR_HEIGHT / 2;

    const gap = 10;
    const d =
      x2 >= x1 + gap * 2
        ? // Room to run straight across: out, down, in.
          `M ${x1} ${y1} H ${x1 + gap} V ${y2} H ${x2}`
        : // The successor starts too early; route below the predecessor and come back.
          `M ${x1} ${y1} H ${x1 + gap} V ${y1 + ROW_HEIGHT / 2} H ${x2 - gap} V ${y2} H ${x2}`;

    paths.push({ id: dependency.id, d });
  }

  return paths;
}

/**
 * Flattens the server's ordered bar list into visible rows, honouring which parents the
 * user has collapsed.
 */
export function visibleRows(bars: readonly GanttBar[], collapsed: ReadonlySet<string>): GanttBar[] {
  const hidden = new Set<string>();
  const result: GanttBar[] = [];

  for (const bar of bars) {
    const parentHidden = bar.parentId != null && hidden.has(bar.parentId);
    const parentCollapsed = bar.parentId != null && collapsed.has(bar.parentId);

    if (parentHidden || parentCollapsed) {
      hidden.add(bar.id);
      continue;
    }
    result.push(bar);
  }

  return result;
}
