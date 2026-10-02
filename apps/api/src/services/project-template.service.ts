/**
 * Starting a project from another one (spec section 10, "project template").
 *
 * The plan is copied, not the history: phases with their gates and deliverables, the WBS
 * tree, tasks, dependencies and milestones, every date shifted by the gap between the two
 * start dates. Nothing that belongs to the old project's people or progress comes along —
 * no assignees, owners, comments, statuses or hours — because a template is a plan for a
 * new team, not a copy of what the old one did.
 */
import type { Db } from '../db/prisma.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  type DateOnly,
} from '../domain/time.js';

function shifted(value: Date | null, days: number): Date | null {
  const date = dateColumnToDateOnly(value);
  return date == null ? null : dateOnlyToDateColumn(addDaysTo(date, days));
}

export interface TemplateCopyResult {
  phases: number;
  wbsItems: number;
  tasks: number;
  dependencies: number;
  milestones: number;
}

export async function copyProjectStructure(
  tx: Db,
  sourceProjectId: string,
  targetProjectId: string,
  targetStartDate: DateOnly,
): Promise<TemplateCopyResult> {
  const source = await tx.project.findUniqueOrThrow({
    where: { id: sourceProjectId },
    select: {
      startDate: true,
      completionRequiresNote: true,
      completionRequiresActualHours: true,
      completionRequiresAttachment: true,
    },
  });
  const days =
    dateColumnToDateOnly(source.startDate) == null
      ? 0
      : Math.round(
          (Date.parse(`${targetStartDate}T00:00:00Z`) - source.startDate.getTime()) / 86_400_000,
        );

  const [phases, wbsItems, tasks, dependencies, milestones] = await Promise.all([
    tx.phase.findMany({ where: { projectId: sourceProjectId }, orderBy: { sequence: 'asc' } }),
    tx.wbsItem.findMany({
      where: { projectId: sourceProjectId },
      // Parents before children, so every parent id is mapped by the time it is needed.
      orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    }),
    tx.task.findMany({
      where: { projectId: sourceProjectId, deletedAt: null, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
    }),
    tx.taskDependency.findMany({ where: { projectId: sourceProjectId } }),
    tx.milestone.findMany({
      where: { projectId: sourceProjectId },
      include: { tasks: { select: { taskId: true } } },
    }),
  ]);

  await tx.project.update({
    where: { id: targetProjectId },
    data: {
      completionRequiresNote: source.completionRequiresNote,
      completionRequiresActualHours: source.completionRequiresActualHours,
      completionRequiresAttachment: source.completionRequiresAttachment,
    },
  });

  const phaseIds = new Map<string, string>();
  for (const phase of phases) {
    const created = await tx.phase.create({
      data: {
        projectId: targetProjectId,
        sequence: phase.sequence,
        name: phase.name,
        description: phase.description,
        plannedStart: shifted(phase.plannedStart, days),
        plannedEnd: shifted(phase.plannedEnd, days),
        deliverables: phase.deliverables,
        approvalRequired: phase.approvalRequired,
        gateStatus: phase.approvalRequired ? 'PENDING' : 'NOT_REQUIRED',
      },
      select: { id: true },
    });
    phaseIds.set(phase.id, created.id);
  }

  const wbsIds = new Map<string, string>();
  for (const item of wbsItems) {
    const created = await tx.wbsItem.create({
      data: {
        projectId: targetProjectId,
        phaseId: item.phaseId == null ? null : (phaseIds.get(item.phaseId) ?? null),
        parentId: item.parentId == null ? null : (wbsIds.get(item.parentId) ?? null),
        code: item.code,
        position: item.position,
        depth: item.depth,
        name: item.name,
        description: item.description,
        plannedStart: shifted(item.plannedStart, days),
        plannedEnd: shifted(item.plannedEnd, days),
        deliverable: item.deliverable,
      },
      select: { id: true },
    });
    wbsIds.set(item.id, created.id);
  }

  const taskIds = new Map<string, string>();
  let counter = 0;
  for (const task of tasks) {
    counter += 1;
    const created = await tx.task.create({
      data: {
        projectId: targetProjectId,
        phaseId: task.phaseId == null ? null : (phaseIds.get(task.phaseId) ?? null),
        wbsItemId: task.wbsItemId == null ? null : (wbsIds.get(task.wbsItemId) ?? null),
        reference: `T-${counter}`,
        name: task.name,
        description: task.description,
        priority: task.priority,
        estimatedHours: task.estimatedHours,
        startDate: shifted(task.startDate, days),
        dueDate: shifted(task.dueDate, days),
      },
      select: { id: true },
    });
    taskIds.set(task.id, created.id);
  }
  await tx.project.update({ where: { id: targetProjectId }, data: { taskCounter: counter } });

  let dependencyCount = 0;
  for (const dependency of dependencies) {
    const predecessorId = taskIds.get(dependency.predecessorId);
    const successorId = taskIds.get(dependency.successorId);
    // An edge to a task that was not copied (cancelled or deleted) is dropped with it.
    if (predecessorId == null || successorId == null) continue;
    await tx.taskDependency.create({
      data: {
        projectId: targetProjectId,
        predecessorId,
        successorId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      },
    });
    dependencyCount += 1;
  }

  for (const milestone of milestones) {
    await tx.milestone.create({
      data: {
        projectId: targetProjectId,
        phaseId: milestone.phaseId == null ? null : (phaseIds.get(milestone.phaseId) ?? null),
        name: milestone.name,
        description: milestone.description,
        date: shifted(milestone.date, days) as Date,
        tasks: {
          create: milestone.tasks
            .map((link) => taskIds.get(link.taskId))
            .filter((id): id is string => id != null)
            .map((taskId) => ({ taskId })),
        },
      },
    });
  }

  return {
    phases: phases.length,
    wbsItems: wbsItems.length,
    tasks: tasks.length,
    dependencies: dependencyCount,
    milestones: milestones.length,
  };
}
