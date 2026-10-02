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

type Side = 'start' | 'end';

/** Which edge of each bar a dependency type connects (spec section 20). */
export const DEPENDENCY_ANCHORS: Record<GanttDependency['type'], { from: Side; to: Side }> = {
  FINISH_TO_START: { from: 'end', to: 'start' },
  START_TO_START: { from: 'start', to: 'start' },
  FINISH_TO_FINISH: { from: 'end', to: 'end' },
  START_TO_FINISH: { from: 'start', to: 'end' },
};

/**
 * The elbow connector between two bars.
 *
 * The connector leaves the predecessor from the edge its type names and enters the
 * successor from the edge its type names — Finish-to-Start runs from the right edge of the
 * predecessor to the left edge of the successor, Start-to-Start from left edge to left
 * edge, and so on. When a straight elbow would double back through a bar, the connector
 * routes through the gap between the rows instead.
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
  const gap = 10;

  for (const dependency of dependencies) {
    const fromBar = barsById.get(dependency.fromId);
    const toBar = barsById.get(dependency.toId);
    const fromRow = rowIndexById.get(dependency.fromId);
    const toRow = rowIndexById.get(dependency.toId);

    if (fromBar == null || toBar == null || fromRow == null || toRow == null) continue;

    const start = barGeometry(fromBar, fromRow, from, dayWidth);
    const finish = barGeometry(toBar, toRow, from, dayWidth);
    if (start == null || finish == null) continue;

    const anchors = DEPENDENCY_ANCHORS[dependency.type];
    const x1 = anchors.from === 'end' ? start.x + start.width : start.x;
    const y1 = start.y + BAR_HEIGHT / 2;
    const x2 = anchors.to === 'start' ? finish.x : finish.x + finish.width;
    const y2 = finish.y + BAR_HEIGHT / 2;

    // Step out of the predecessor, and the point from which to step into the successor.
    const out = anchors.from === 'end' ? x1 + gap : x1 - gap;
    const into = anchors.to === 'start' ? x2 - gap : x2 + gap;
    // A straight elbow works when the vertical run sits on the correct side of both edges.
    const straight =
      (anchors.from === 'end' ? into >= out : into <= out) ||
      (anchors.from === 'end' && anchors.to === 'end') ||
      (anchors.from === 'start' && anchors.to === 'start');

    const d = straight
      ? (() => {
          // Same-side links share one vertical run, placed outside both edges.
          const run =
            anchors.from === anchors.to
              ? anchors.from === 'end'
                ? Math.max(out, into)
                : Math.min(out, into)
              : out;
          return `M ${x1} ${y1} H ${run} V ${y2} H ${x2}`;
        })()
      : `M ${x1} ${y1} H ${out} V ${y1 + ROW_HEIGHT / 2} H ${into} V ${y2} H ${x2}`;

    paths.push({ id: dependency.id, d });
  }

  return paths;
}

export type DragMode = 'move' | 'start' | 'end';

/**
 * New dates for a task bar dragged by `deltaDays`: the whole bar moves, or one edge does.
 * An edge never crosses the other, so a task always lasts at least its first day.
 */
export function draggedDates(
  start: string,
  end: string,
  deltaDays: number,
  mode: DragMode,
): { start: string; end: string } {
  if (mode === 'move') return { start: addDays(start, deltaDays), end: addDays(end, deltaDays) };
  if (mode === 'end') {
    const next = addDays(end, deltaDays);
    return { start, end: next < start ? start : next };
  }
  const next = addDays(start, deltaDays);
  return { start: next > end ? end : next, end };
}

/** Whole days a horizontal drag of `dx` pixels represents at this zoom. */
export function dragDays(dx: number, dayWidth: number): number {
  return Math.round(dx / dayWidth);
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
