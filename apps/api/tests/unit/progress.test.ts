import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  phaseProgress,
  progressForStatus,
  projectProgress,
  rollupTasks,
  rollupWbsTree,
  statusForProgress,
  taskProgress,
} from '../../src/domain/progress.js';

const task = (
  id: string,
  status: Parameters<typeof taskProgress>[0]['status'],
  progress: number,
  estimatedHours: number | null = null,
) => ({ id, status, progress, estimatedHours });

describe('taskProgress', () => {
  it('reports a completed task as 100 whatever the stored number says', () => {
    expect(taskProgress(task('t1', 'COMPLETED', 40))).toBe(100);
  });

  it('clamps a value outside 0..100', () => {
    expect(taskProgress(task('t1', 'IN_PROGRESS', 140))).toBe(100);
    expect(taskProgress(task('t1', 'IN_PROGRESS', -20))).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('rollupTasks', () => {
  it('returns zero for an empty set', () => {
    expect(rollupTasks([])).toBe(0);
  });

  it('averages evenly when no estimates are given', () => {
    expect(rollupTasks([task('a', 'IN_PROGRESS', 0), task('b', 'IN_PROGRESS', 50)])).toBe(25);
  });

  it('weights by estimated hours so a long task counts for more', () => {
    // 100% of 30h and 0% of 10h is 75%, not the 50% a plain mean would give.
    const result = rollupTasks([
      task('long', 'COMPLETED', 100, 30),
      task('short', 'NOT_STARTED', 0, 10),
    ]);
    expect(result).toBe(75);
  });

  it('excludes cancelled work rather than counting it as zero', () => {
    const result = rollupTasks([task('done', 'COMPLETED', 100), task('dropped', 'CANCELLED', 0)]);
    expect(result).toBe(100);
  });
});

describe('rollupWbsTree', () => {
  it('rolls child progress into the parent', () => {
    const progress = rollupWbsTree([
      { id: 'root', parentId: null, tasks: [] },
      { id: 'a', parentId: 'root', tasks: [task('t1', 'COMPLETED', 100)] },
      { id: 'b', parentId: 'root', tasks: [task('t2', 'NOT_STARTED', 0)] },
    ]);
    expect(progress.get('a')).toBe(100);
    expect(progress.get('b')).toBe(0);
    expect(progress.get('root')).toBe(50);
  });

  it('does not let an empty branch dilute a busy sibling', () => {
    const progress = rollupWbsTree([
      { id: 'root', parentId: null, tasks: [] },
      { id: 'busy', parentId: 'root', tasks: [task('t1', 'COMPLETED', 100)] },
      { id: 'empty', parentId: 'root', tasks: [] },
    ]);
    expect(progress.get('root')).toBe(100);
  });

  it('treats a cyclic parent chain as a leaf instead of hanging', () => {
    const progress = rollupWbsTree([
      { id: 'a', parentId: 'b', tasks: [task('t1', 'COMPLETED', 100)] },
      { id: 'b', parentId: 'a', tasks: [] },
    ]);
    expect(progress.size).toBe(2);
  });
});

describe('phaseProgress and projectProgress', () => {
  it('combines WBS roots with tasks attached straight to the phase', () => {
    const result = phaseProgress({
      id: 'p1',
      wbsRoots: [{ progress: 100, weight: 1 }],
      directTasks: [task('t1', 'NOT_STARTED', 0)],
      plannedDays: 10,
    });
    expect(result).toBe(50);
  });

  it('weights phases by planned duration', () => {
    // 100% over 30 days and 0% over 10 days is 75%.
    expect(
      projectProgress([
        { progress: 100, plannedDays: 30 },
        { progress: 0, plannedDays: 10 },
      ]),
    ).toBe(75);
  });

  it('ignores cancelled phases', () => {
    expect(
      projectProgress([
        { progress: 100, plannedDays: 10 },
        { progress: 0, plannedDays: 10, cancelled: true },
      ]),
    ).toBe(100);
  });
});

describe('status and progress coupling', () => {
  it('forces 100 when a task is completed', () => {
    expect(progressForStatus('COMPLETED', 30)).toBe(100);
  });

  it('completes a task dragged to 100', () => {
    expect(statusForProgress(100, 'IN_PROGRESS')).toBe('COMPLETED');
  });

  it('starts a not-started task given some progress', () => {
    expect(statusForProgress(20, 'NOT_STARTED')).toBe('IN_PROGRESS');
  });

  it('leaves a cancelled task alone', () => {
    expect(statusForProgress(100, 'CANCELLED')).toBeNull();
  });
});

describe('phase status overrides the task rollup', () => {
  it('reports an approved phase as complete even with no tasks recorded', () => {
    expect(
      phaseProgress({
        id: 'p',
        wbsRoots: [],
        directTasks: [],
        plannedDays: 10,
        status: 'APPROVED',
      }),
    ).toBe(100);
  });

  it('reports a completed phase as complete', () => {
    expect(
      phaseProgress({
        id: 'p',
        wbsRoots: [],
        directTasks: [task('t', 'IN_PROGRESS', 20)],
        plannedDays: 10,
        status: 'COMPLETED',
      }),
    ).toBe(100);
  });

  it('still derives progress from the work for a phase in flight', () => {
    expect(
      phaseProgress({
        id: 'p',
        wbsRoots: [],
        directTasks: [task('t', 'IN_PROGRESS', 40)],
        plannedDays: 10,
        status: 'IN_PROGRESS',
      }),
    ).toBe(40);
  });
});
