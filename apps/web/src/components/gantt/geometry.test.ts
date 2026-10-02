import type { GanttBar, GanttDependency } from '@ekavist/shared';
import { describe, expect, it } from 'vitest';
import { DAY_WIDTH, dependencyPaths, dragDays, draggedDates } from './geometry.js';

const bar = (id: string, start: string, end: string): GanttBar => ({
  id,
  kind: 'TASK',
  parentId: null,
  code: null,
  label: id,
  ownerName: null,
  start,
  end,
  durationDays: null,
  progress: 0,
  status: 'NOT_STARTED',
  isOverdue: false,
  depth: 0,
  hasChildren: false,
});

const link = (type: GanttDependency['type']): GanttDependency => ({
  id: type,
  type,
  fromId: 'a',
  toId: 'b',
  lagDays: 0,
});

describe('draggedDates', () => {
  it('moves the whole bar', () => {
    expect(draggedDates('2026-09-01', '2026-09-05', 3, 'move')).toEqual({
      start: '2026-09-04',
      end: '2026-09-08',
    });
  });

  it('moves one edge without letting it cross the other', () => {
    expect(draggedDates('2026-09-01', '2026-09-05', 2, 'end').end).toBe('2026-09-07');
    expect(draggedDates('2026-09-01', '2026-09-05', -10, 'end')).toEqual({
      start: '2026-09-01',
      end: '2026-09-01',
    });
    expect(draggedDates('2026-09-01', '2026-09-05', 10, 'start')).toEqual({
      start: '2026-09-05',
      end: '2026-09-05',
    });
  });

  it('rounds a drag to whole days at each zoom level', () => {
    expect(dragDays(DAY_WIDTH.day * 2.4, DAY_WIDTH.day)).toBe(2);
    expect(dragDays(-DAY_WIDTH.week * 6.6, DAY_WIDTH.week)).toBe(-7);
  });
});

describe('dependencyPaths', () => {
  // Two tasks: a runs 1–5 September, b runs 10–12 September, on consecutive rows.
  const bars = [bar('a', '2026-09-01', '2026-09-05'), bar('b', '2026-09-10', '2026-09-12')];
  const rows = new Map([
    ['a', 0],
    ['b', 1],
  ]);
  const width = DAY_WIDTH.day;
  const path = (type: GanttDependency['type']) =>
    dependencyPaths([link(type)], bars, rows, '2026-09-01', width)[0]?.d ?? '';

  it('anchors each type at the edges it names', () => {
    // Right edge of a is 5 days in; left edge of b is 9 days in; right edge of b, 12.
    expect(path('FINISH_TO_START')).toMatch(new RegExp(`^M ${5 * width} .* H ${9 * width}$`));
    expect(path('START_TO_START')).toMatch(new RegExp(`^M 0 .* H ${9 * width}$`));
    expect(path('FINISH_TO_FINISH')).toMatch(new RegExp(`^M ${5 * width} .* H ${12 * width}$`));
    expect(path('START_TO_FINISH')).toMatch(new RegExp(`^M 0 .* H ${12 * width}$`));
  });

  it('routes between the rows when a straight elbow would double back', () => {
    const early = [bar('a', '2026-09-01', '2026-09-10'), bar('b', '2026-09-03', '2026-09-12')];
    const d = dependencyPaths([link('FINISH_TO_START')], early, rows, '2026-09-01', width)[0]?.d;
    expect(d?.split(' V ')).toHaveLength(3);
  });
});
