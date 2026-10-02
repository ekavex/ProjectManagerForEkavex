/**
 * Task dependencies (spec section 20).
 *
 * All four dependency types are accepted; how each is enforced lives in
 * `dependencyConflicts` (domain/task-rules.ts). The rule that matters here is that the
 * graph stays acyclic: an edge that would close a cycle is refused before it is written, and the
 * error names the tasks in the loop so the user can see what to change.
 */
import { ERROR_CODES, type CreateDependencyInput, type TaskLink } from '@ekavist/shared';
import type { Db } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import { findCycle } from '../domain/dependency.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordChange } from './audit.service.js';

export interface DependencyRow {
  id: string;
  type: TaskLink['type'];
  lagDays: number;
  predecessor: { id: string; reference: string; name: string };
  successor: { id: string; reference: string; name: string };
}

export async function listDependencies(db: Db, projectId: string): Promise<DependencyRow[]> {
  const rows = await db.taskDependency.findMany({
    where: { projectId, predecessor: { deletedAt: null }, successor: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      lagDays: true,
      predecessor: { select: { id: true, reference: true, name: true } },
      successor: { select: { id: true, reference: true, name: true } },
    },
  });
  return rows;
}

export async function createDependency(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  input: CreateDependencyInput,
): Promise<DependencyRow[]> {
  assertProjectPermission(context, 'dependency:manage');
  assertProjectMutable(context);

  if (input.predecessorId === input.successorId) {
    throw new AppError(ERROR_CODES.TASK_DEPENDENCY_SELF, 'A task cannot depend on itself.');
  }

  const tasks = await db.task.findMany({
    where: {
      id: { in: [input.predecessorId, input.successorId] },
      projectId: context.projectId,
      deletedAt: null,
    },
    select: { id: true, reference: true, name: true },
  });
  if (tasks.length !== 2) {
    throw notFound('One of those tasks');
  }

  const existing = await db.taskDependency.findMany({
    where: { projectId: context.projectId },
    select: { predecessorId: true, successorId: true },
  });

  const cycle = findCycle(existing, {
    predecessorId: input.predecessorId,
    successorId: input.successorId,
  });

  if (cycle != null) {
    const references = await referencesFor(db, cycle);
    throw new AppError(
      ERROR_CODES.TASK_DEPENDENCY_CYCLE,
      `That dependency would create a loop: ${references.join(' then ')}. A task cannot end up waiting for itself.`,
    );
  }

  const predecessor = tasks.find((task) => task.id === input.predecessorId);
  const successor = tasks.find((task) => task.id === input.successorId);

  try {
    await db.taskDependency.create({
      data: {
        projectId: context.projectId,
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type,
        lagDays: input.lagDays,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(
        ERROR_CODES.TASK_DEPENDENCY_DUPLICATE,
        `${successor?.reference} already depends on ${predecessor?.reference}.`,
      );
    }
    throw error;
  }

  await recordChange(
    db,
    {
      actorId: actor.id,
      projectId: context.projectId,
      action: 'dependency.created',
      entityType: 'TaskDependency',
      entityId: `${input.predecessorId}->${input.successorId}`,
      newValue: {
        predecessor: predecessor?.reference,
        successor: successor?.reference,
        type: input.type,
        lagDays: input.lagDays,
      },
    },
    {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'linked',
      summary: `${actor.fullName} made ${successor?.reference} depend on ${predecessor?.reference}`,
      entityType: 'Task',
      entityId: input.successorId,
    },
  );

  return listDependencies(db, context.projectId);
}

export async function deleteDependency(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  dependencyId: string,
): Promise<DependencyRow[]> {
  assertProjectPermission(context, 'dependency:manage');
  assertProjectMutable(context);

  const dependency = await db.taskDependency.findFirst({
    where: { id: dependencyId, projectId: context.projectId },
    select: {
      id: true,
      predecessor: { select: { reference: true } },
      successor: { select: { id: true, reference: true } },
    },
  });
  if (dependency == null) throw notFound('That dependency');

  await db.taskDependency.delete({ where: { id: dependencyId } });

  await recordChange(
    db,
    {
      actorId: actor.id,
      projectId: context.projectId,
      action: 'dependency.deleted',
      entityType: 'TaskDependency',
      entityId: dependencyId,
      oldValue: {
        predecessor: dependency.predecessor.reference,
        successor: dependency.successor.reference,
      },
    },
    {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'unlinked',
      summary: `${actor.fullName} removed the dependency between ${dependency.predecessor.reference} and ${dependency.successor.reference}`,
      entityType: 'Task',
      entityId: dependency.successor.id,
    },
  );

  return listDependencies(db, context.projectId);
}

/** Turns a cycle of task ids into readable references for the error message. */
async function referencesFor(db: Db, taskIds: readonly string[]): Promise<string[]> {
  const tasks = await db.task.findMany({
    where: { id: { in: [...new Set(taskIds)] } },
    select: { id: true, reference: true },
  });
  const byId = new Map(tasks.map((task) => [task.id, task.reference]));
  return taskIds.map((id) => byId.get(id) ?? id);
}
