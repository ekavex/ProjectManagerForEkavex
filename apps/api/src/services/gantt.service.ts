/**
 * The Gantt data source (spec section 22).
 *
 * Returns a flat, ordered list of bars — phases, WBS items, tasks and milestones — plus
 * the dependency edges between them. The client draws; the server decides the ordering,
 * the hierarchy and the date window, because those rules belong with the data.
 *
 * A phase or WBS bar with no dates of its own spans its children, so an incompletely
 * scheduled plan still renders something truthful rather than nothing.
 */
import type { GanttBar, GanttQuery, GanttResponse } from '@ekavist/shared';
import type { Db } from '../db/prisma.js';
import { compareWbsCodes } from '../domain/wbs.js';
import { isOverdue } from '../domain/task-rules.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  daysBetween,
  maxDate,
  minDate,
  today,
  type DateOnly,
} from '../domain/time.js';
import type { Actor } from '../policy/actor.js';

export async function getGantt(
  db: Db,
  actor: Actor,
  projectId: string,
  query: GanttQuery,
): Promise<GanttResponse> {
  const todayDate = today(actor.timezone);

  const [project, phases, wbsItems, tasks, dependencies, milestones] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { startDate: true, plannedEndDate: true },
    }),
    db.phase.findMany({
      where: { projectId, ...(query.phaseId != null ? { id: query.phaseId } : {}) },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        name: true,
        sequence: true,
        status: true,
        progress: true,
        plannedStart: true,
        plannedEnd: true,
        owner: { select: { fullName: true } },
      },
    }),
    db.wbsItem.findMany({
      where: { projectId, ...(query.phaseId != null ? { phaseId: query.phaseId } : {}) },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
        phaseId: true,
        depth: true,
        progress: true,
        plannedStart: true,
        plannedEnd: true,
        owner: { select: { fullName: true } },
      },
    }),
    db.task.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(query.phaseId != null ? { phaseId: query.phaseId } : {}),
      },
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        progress: true,
        startDate: true,
        dueDate: true,
        phaseId: true,
        wbsItemId: true,
        assignments: {
          where: { isPrimary: true },
          select: { user: { select: { fullName: true } } },
        },
      },
    }),
    db.taskDependency.findMany({
      where: { projectId, predecessor: { deletedAt: null }, successor: { deletedAt: null } },
      select: { id: true, type: true, lagDays: true, predecessorId: true, successorId: true },
    }),
    db.milestone.findMany({
      where: { projectId, ...(query.phaseId != null ? { phaseId: query.phaseId } : {}) },
      select: {
        id: true,
        name: true,
        date: true,
        status: true,
        phaseId: true,
        owner: { select: { fullName: true } },
      },
    }),
  ]);

  // --- task bars, grouped by their parent -------------------------------
  const tasksByWbs = new Map<string, typeof tasks>();
  const tasksByPhase = new Map<string, typeof tasks>();
  const orphanTasks: typeof tasks = [];

  for (const task of tasks) {
    if (task.wbsItemId != null) push(tasksByWbs, task.wbsItemId, task);
    else if (task.phaseId != null) push(tasksByPhase, task.phaseId, task);
    else orphanTasks.push(task);
  }

  // --- derived spans, computed leaves-first ------------------------------
  const wbsChildren = new Map<string, typeof wbsItems>();
  for (const item of wbsItems) {
    if (item.parentId != null) push(wbsChildren, item.parentId, item);
  }

  const spanOfWbs = new Map<string, { start: DateOnly | null; end: DateOnly | null }>();

  const computeWbsSpan = (
    itemId: string,
    seen = new Set<string>(),
  ): { start: DateOnly | null; end: DateOnly | null } => {
    const cached = spanOfWbs.get(itemId);
    if (cached != null) return cached;
    if (seen.has(itemId)) return { start: null, end: null };
    seen.add(itemId);

    const item = wbsItems.find((candidate) => candidate.id === itemId);
    let start = dateColumnToDateOnly(item?.plannedStart ?? null);
    let end = dateColumnToDateOnly(item?.plannedEnd ?? null);

    for (const task of tasksByWbs.get(itemId) ?? []) {
      start = minDate(start, dateColumnToDateOnly(task.startDate));
      end = maxDate(end, dateColumnToDateOnly(task.dueDate));
    }
    for (const child of wbsChildren.get(itemId) ?? []) {
      const childSpan = computeWbsSpan(child.id, seen);
      start = minDate(start, childSpan.start);
      end = maxDate(end, childSpan.end);
    }

    const span = { start, end };
    spanOfWbs.set(itemId, span);
    return span;
  };

  for (const item of wbsItems) computeWbsSpan(item.id);

  // --- assemble the ordered bar list -------------------------------------
  const bars: GanttBar[] = [];

  const addTaskBars = (parentId: string, items: typeof tasks, depth: number): void => {
    const ordered = [...items].sort(byDateThenReference);
    for (const task of ordered) {
      const start = dateColumnToDateOnly(task.startDate);
      const end = dateColumnToDateOnly(task.dueDate);
      bars.push({
        id: task.id,
        kind: 'TASK',
        parentId,
        code: task.reference,
        label: task.name,
        ownerName: task.assignments[0]?.user.fullName ?? null,
        start,
        end,
        durationDays: start != null && end != null ? daysBetween(start, end) + 1 : null,
        progress: task.status === 'COMPLETED' ? 100 : task.progress,
        status: task.status,
        isOverdue: isOverdue({ status: task.status, dueDate: end }, todayDate),
        depth,
        hasChildren: false,
      });
    }
  };

  const addWbsBars = (parentId: string, items: typeof wbsItems, depth: number): void => {
    const ordered = [...items].sort((a, b) => compareWbsCodes(a.code, b.code));
    for (const item of ordered) {
      const span = spanOfWbs.get(item.id) ?? { start: null, end: null };
      const children = wbsChildren.get(item.id) ?? [];
      const ownTasks = tasksByWbs.get(item.id) ?? [];

      bars.push({
        id: item.id,
        kind: 'WBS',
        parentId,
        code: item.code,
        label: item.name,
        ownerName: item.owner?.fullName ?? null,
        start: span.start,
        end: span.end,
        durationDays:
          span.start != null && span.end != null ? daysBetween(span.start, span.end) + 1 : null,
        progress: item.progress,
        status: 'WBS',
        isOverdue: false,
        depth,
        hasChildren: children.length > 0 || ownTasks.length > 0,
      });

      addWbsBars(item.id, children, depth + 1);
      addTaskBars(item.id, ownTasks, depth + 1);
    }
  };

  for (const phase of phases) {
    const roots = wbsItems.filter((item) => item.phaseId === phase.id && item.parentId == null);
    const direct = tasksByPhase.get(phase.id) ?? [];

    let start = dateColumnToDateOnly(phase.plannedStart);
    let end = dateColumnToDateOnly(phase.plannedEnd);
    for (const root of roots) {
      const span = spanOfWbs.get(root.id) ?? { start: null, end: null };
      start = minDate(start, span.start);
      end = maxDate(end, span.end);
    }
    for (const task of direct) {
      start = minDate(start, dateColumnToDateOnly(task.startDate));
      end = maxDate(end, dateColumnToDateOnly(task.dueDate));
    }

    bars.push({
      id: phase.id,
      kind: 'PHASE',
      parentId: null,
      code: `${phase.sequence}`,
      label: phase.name,
      ownerName: phase.owner?.fullName ?? null,
      start,
      end,
      durationDays: start != null && end != null ? daysBetween(start, end) + 1 : null,
      progress: phase.progress,
      status: phase.status,
      isOverdue:
        end != null &&
        end < todayDate &&
        phase.status !== 'COMPLETED' &&
        phase.status !== 'APPROVED',
      depth: 0,
      hasChildren: roots.length > 0 || direct.length > 0,
    });

    addWbsBars(phase.id, roots, 1);
    addTaskBars(phase.id, direct, 1);

    for (const milestone of milestones.filter((item) => item.phaseId === phase.id)) {
      bars.push(milestoneBar(milestone, phase.id, 1, todayDate));
    }
  }

  // Work that belongs to no phase still has to be visible.
  const unphasedWbs = wbsItems.filter((item) => item.phaseId == null && item.parentId == null);
  if (unphasedWbs.length > 0 || orphanTasks.length > 0) {
    addWbsBars('', unphasedWbs, 0);
    addTaskBars('', orphanTasks, 0);
  }
  for (const milestone of milestones.filter((item) => item.phaseId == null)) {
    bars.push(milestoneBar(milestone, null, 0, todayDate));
  }

  // --- window ------------------------------------------------------------
  const projectStart = dateColumnToDateOnly(project.startDate) as DateOnly;
  const projectEnd = dateColumnToDateOnly(project.plannedEndDate) as DateOnly;

  let from = query.from ?? projectStart;
  let to = query.to ?? projectEnd;
  for (const bar of bars) {
    from = minDate(from, bar.start) ?? from;
    to = maxDate(to, bar.end) ?? to;
  }
  // A little air either side so the first and last bars are not flush with the edge.
  from = addDaysTo(from, -3);
  to = addDaysTo(to, 3);

  return {
    from,
    to,
    granularity: query.granularity,
    today: todayDate,
    bars,
    dependencies: dependencies.map((dependency) => ({
      id: dependency.id,
      type: dependency.type,
      fromId: dependency.predecessorId,
      toId: dependency.successorId,
      lagDays: dependency.lagDays,
    })),
  };
}

function milestoneBar(
  milestone: {
    id: string;
    name: string;
    date: Date;
    status: string;
    owner: { fullName: string } | null;
  },
  parentId: string | null,
  depth: number,
  todayDate: DateOnly,
): GanttBar {
  const date = dateColumnToDateOnly(milestone.date);
  return {
    id: milestone.id,
    kind: 'MILESTONE',
    parentId,
    code: null,
    label: milestone.name,
    ownerName: milestone.owner?.fullName ?? null,
    start: date,
    end: date,
    durationDays: 0,
    progress: milestone.status === 'ACHIEVED' ? 100 : 0,
    status: milestone.status,
    isOverdue:
      date != null &&
      date < todayDate &&
      milestone.status !== 'ACHIEVED' &&
      milestone.status !== 'CANCELLED',
    depth,
    hasChildren: false,
  };
}

function byDateThenReference(
  a: { startDate: Date | null; dueDate: Date | null; reference: string },
  b: { startDate: Date | null; dueDate: Date | null; reference: string },
): number {
  const aStart =
    dateColumnToDateOnly(a.startDate) ?? dateColumnToDateOnly(a.dueDate) ?? '9999-12-31';
  const bStart =
    dateColumnToDateOnly(b.startDate) ?? dateColumnToDateOnly(b.dueDate) ?? '9999-12-31';
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  return a.reference.localeCompare(b.reference, undefined, { numeric: true });
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
