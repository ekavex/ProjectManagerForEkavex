/**
 * Tasks (spec sections 16 to 19).
 *
 * The rules that live here rather than in a route or the UI:
 *   * a completed task is 100% and carries a completion time;
 *   * a member may only change the tasks assigned to them, and only their status,
 *     progress and actual hours;
 *   * starting a task whose predecessor is unfinished warns rather than refuses, and the
 *     override is recorded;
 *   * every write refreshes the derived progress inside the same transaction.
 */
import {
  ERROR_CODES,
  MEMBER_SETTABLE_TASK_STATUSES,
  type CreateTaskCommentInput,
  type CreateTaskInput,
  type CreateTaskLinkAttachmentInput,
  type ListTasksQuery,
  type Paginated,
  type TaskComment,
  type TaskDetail,
  type TaskLink,
  type TaskSummary,
  type UpdateTaskInput,
  type UpdateTaskProgressInput,
  type UpdateTaskStatusInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { progressForStatus, statusForProgress } from '../domain/progress.js';
import {
  blockingPredecessors,
  canTransition,
  daysUntilDue,
  isOverdue,
  transitionError,
} from '../domain/task-rules.js';
import {
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { emitToProject } from '../realtime/emitter.js';
import { recordActivity, recordAudit, recordChange, diffValues } from './audit.service.js';
import { notifyMany } from './notification.service.js';
import { pageMeta, paginate } from './pagination.js';
import { recomputeProjectProgress } from './rollup.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

const TASK_SUMMARY_SELECT = {
  id: true,
  reference: true,
  name: true,
  status: true,
  priority: true,
  progress: true,
  startDate: true,
  dueDate: true,
  phase: { select: { id: true, name: true } },
  wbsItem: { select: { id: true, code: true } },
  project: { select: { id: true, code: true, name: true } },
  assignments: {
    orderBy: { isPrimary: 'desc' },
    select: { user: { select: USER_SUMMARY_SELECT } },
  },
} satisfies Prisma.TaskSelect;

const TASK_DETAIL_SELECT = {
  ...TASK_SUMMARY_SELECT,
  description: true,
  estimatedHours: true,
  actualHours: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  accountable: { select: USER_SUMMARY_SELECT },
  createdBy: { select: USER_SUMMARY_SELECT },
  _count: { select: { comments: true } },
  attachments: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      kind: true,
      name: true,
      url: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      addedBy: { select: USER_SUMMARY_SELECT },
    },
  },
  predecessors: {
    select: {
      id: true,
      type: true,
      lagDays: true,
      predecessor: {
        select: { id: true, reference: true, name: true, status: true, dueDate: true },
      },
    },
  },
  successors: {
    select: {
      id: true,
      type: true,
      lagDays: true,
      successor: {
        select: { id: true, reference: true, name: true, status: true, dueDate: true },
      },
    },
  },
} satisfies Prisma.TaskSelect;

type SummaryRow = Prisma.TaskGetPayload<{ select: typeof TASK_SUMMARY_SELECT }>;
type DetailRow = Prisma.TaskGetPayload<{ select: typeof TASK_DETAIL_SELECT }>;

export function toTaskSummary(row: SummaryRow, todayDate: DateOnly): TaskSummary {
  const dueDate = dateColumnToDateOnly(row.dueDate);
  const shape = { status: row.status, dueDate };
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    startDate: dateColumnToDateOnly(row.startDate),
    dueDate,
    isOverdue: isOverdue(shape, todayDate),
    daysUntilDue: daysUntilDue(shape, todayDate),
    assignees: row.assignments.map((assignment) => toUserSummary(assignment.user)),
    phase: row.phase,
    wbs: row.wbsItem,
    project: row.project,
  };
}

function toTaskDetail(row: DetailRow, todayDate: DateOnly): TaskDetail {
  const predecessors: TaskLink[] = row.predecessors.map((dependency) => ({
    dependencyId: dependency.id,
    type: dependency.type,
    lagDays: dependency.lagDays,
    task: {
      id: dependency.predecessor.id,
      reference: dependency.predecessor.reference,
      name: dependency.predecessor.name,
      status: dependency.predecessor.status,
      dueDate: dateColumnToDateOnly(dependency.predecessor.dueDate),
    },
  }));

  return {
    ...toTaskSummary(row, todayDate),
    description: row.description,
    accountable: toUserSummaryOrNull(row.accountable),
    estimatedHours: row.estimatedHours == null ? null : Number(row.estimatedHours),
    actualHours: row.actualHours == null ? null : Number(row.actualHours),
    predecessors,
    successors: row.successors.map((dependency) => ({
      dependencyId: dependency.id,
      type: dependency.type,
      lagDays: dependency.lagDays,
      task: {
        id: dependency.successor.id,
        reference: dependency.successor.reference,
        name: dependency.successor.name,
        status: dependency.successor.status,
        dueDate: dateColumnToDateOnly(dependency.successor.dueDate),
      },
    })),
    blockingPredecessors: predecessors.filter(
      (link) => link.task.status !== 'COMPLETED' && link.task.status !== 'CANCELLED',
    ),
    commentCount: row._count.comments,
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      url: attachment.url,
      sizeBytes: attachment.sizeBytes,
      mimeType: attachment.mimeType,
      addedBy: toUserSummaryOrNull(attachment.addedBy),
      createdAt: attachment.createdAt.toISOString(),
    })),
    createdBy: toUserSummaryOrNull(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------- list

export async function listTasks(
  db: Db,
  actor: Actor,
  projectId: string,
  query: ListTasksQuery,
): Promise<Paginated<TaskSummary>> {
  const todayDate = today(actor.timezone);

  const where: Prisma.TaskWhereInput = {
    projectId,
    deletedAt: null,
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.phaseId ? { phaseId: query.phaseId } : {}),
    ...(query.wbsItemId ? { wbsItemId: query.wbsItemId } : {}),
    ...(query.assigneeId ? { assignments: { some: { userId: query.assigneeId } } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.dueFrom != null || query.dueTo != null
      ? {
          dueDate: {
            ...(query.dueFrom != null ? { gte: new Date(`${query.dueFrom}T00:00:00.000Z`) } : {}),
            ...(query.dueTo != null ? { lte: new Date(`${query.dueTo}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
    // Overdue is derived from today in the caller's timezone, matching domain/task-rules.
    ...(query.overdueOnly
      ? {
          dueDate: { lt: new Date(`${todayDate}T00:00:00.000Z`) },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      select: TASK_SUMMARY_SELECT,
      // Tasks with no due date sort last rather than first.
      orderBy: [{ [query.sort]: { sort: query.direction, nulls: 'last' } }],
      ...paginate(query),
    }),
  ]);

  return {
    data: rows.map((row) => toTaskSummary(row, todayDate)),
    meta: pageMeta(query, total),
  };
}

export async function getTask(
  db: Db,
  actor: Actor,
  projectId: string,
  taskId: string,
): Promise<TaskDetail> {
  const row = await db.task.findFirst({
    where: { id: taskId, projectId, deletedAt: null },
    select: TASK_DETAIL_SELECT,
  });
  if (row == null) throw notFound('That task');
  return toTaskDetail(row, today(actor.timezone));
}

// -------------------------------------------------------------------- create

export async function createTask(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateTaskInput,
): Promise<TaskDetail> {
  assertProjectPermission(context, 'task:create');
  assertProjectMutable(context);

  const { phaseId, wbsItemId } = await resolvePlacement(
    db,
    context.projectId,
    input.phaseId,
    input.wbsItemId,
  );
  const assigneeIds = await validateAssignees(db, context.projectId, input.assigneeIds);

  const taskId = await db.$transaction(async (tx) => {
    // The per-project counter behind T-1, T-2, … An atomic increment keeps two concurrent
    // creations from claiming the same reference.
    const project = await tx.project.update({
      where: { id: context.projectId },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true, leadId: true, name: true },
    });

    const created = await tx.task.create({
      data: {
        projectId: context.projectId,
        phaseId,
        wbsItemId,
        reference: `T-${project.taskCounter}`,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        progress: input.status === 'COMPLETED' ? 100 : 0,
        completedAt: input.status === 'COMPLETED' ? new Date() : null,
        startDate: dateOnlyToDateColumn(input.startDate ?? null),
        dueDate: dateOnlyToDateColumn(input.dueDate ?? null),
        estimatedHours: input.estimatedHours ?? null,
        accountableId: input.accountableId ?? project.leadId,
        createdById: actor.id,
        assignments: {
          create: assigneeIds.map((userId, index) => ({ userId, isPrimary: index === 0 })),
        },
      },
      select: { id: true, reference: true, name: true },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'task.created',
        entityType: 'Task',
        entityId: created.id,
        newValue: {
          reference: created.reference,
          name: created.name,
          assigneeIds,
          dueDate: input.dueDate ?? null,
        },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `${actor.fullName} created ${created.reference} ${created.name}`,
        entityType: 'Task',
        entityId: created.id,
      },
    );

    await recomputeProjectProgress(tx, context.projectId);
    return created.id;
  });

  await notifyAssigned(db, actor, context.projectId, taskId, assigneeIds);

  const detail = await getTask(db, actor, context.projectId, taskId);
  emitToProject(context.projectId, 'task:updated', { projectId: context.projectId, task: detail });
  return detail;
}

// -------------------------------------------------------------------- update

export async function updateTask(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskDetail> {
  assertProjectPermission(context, 'task:update');
  assertProjectMutable(context);

  const existing = await db.task.findFirst({
    where: { id: taskId, projectId: context.projectId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      phaseId: true,
      wbsItemId: true,
      startDate: true,
      dueDate: true,
      estimatedHours: true,
      actualHours: true,
      priority: true,
      accountableId: true,
      assignments: { select: { userId: true } },
    },
  });
  if (existing == null) throw notFound('That task');

  const placement =
    input.phaseId !== undefined || input.wbsItemId !== undefined
      ? await resolvePlacement(
          db,
          context.projectId,
          input.phaseId === undefined ? existing.phaseId : input.phaseId,
          input.wbsItemId === undefined ? existing.wbsItemId : input.wbsItemId,
        )
      : null;

  const startDate =
    input.startDate === undefined ? dateColumnToDateOnly(existing.startDate) : input.startDate;
  const dueDate =
    input.dueDate === undefined ? dateColumnToDateOnly(existing.dueDate) : input.dueDate;
  if (startDate != null && dueDate != null && dueDate < startDate) {
    throw new AppError(
      ERROR_CODES.TASK_DATES_INVALID,
      'The due date cannot be before the start date.',
      {
        details: [{ path: 'dueDate', message: 'Must not be before the start date.' }],
      },
    );
  }

  const assigneeIds =
    input.assigneeIds == null
      ? null
      : await validateAssignees(db, context.projectId, input.assigneeIds);

  const previousAssignees = new Set(existing.assignments.map((assignment) => assignment.userId));
  const newlyAssigned = assigneeIds?.filter((id) => !previousAssignees.has(id)) ?? [];

  await db.$transaction(async (tx) => {
    const data: Prisma.TaskUncheckedUpdateInput = {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(placement != null ? { phaseId: placement.phaseId, wbsItemId: placement.wbsItemId } : {}),
      ...(input.startDate !== undefined
        ? { startDate: dateOnlyToDateColumn(input.startDate) }
        : {}),
      ...(input.dueDate !== undefined ? { dueDate: dateOnlyToDateColumn(input.dueDate) } : {}),
      ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
      ...(input.actualHours !== undefined ? { actualHours: input.actualHours } : {}),
      ...(input.priority != null ? { priority: input.priority } : {}),
      ...(input.accountableId !== undefined ? { accountableId: input.accountableId ?? null } : {}),
    };

    await tx.task.update({ where: { id: taskId }, data });

    if (assigneeIds != null) {
      await tx.taskAssignment.deleteMany({ where: { taskId } });
      if (assigneeIds.length > 0) {
        await tx.taskAssignment.createMany({
          data: assigneeIds.map((userId, index) => ({
            taskId,
            userId,
            isPrimary: index === 0,
          })),
        });
      }
    }

    const diff = diffValues(existing as Record<string, unknown>, input as Record<string, unknown>);
    if (diff != null || assigneeIds != null) {
      await recordAudit(tx, {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'task.updated',
        entityType: 'Task',
        entityId: taskId,
        oldValue: {
          ...(diff?.old ?? {}),
          ...(assigneeIds != null ? { assigneeIds: [...previousAssignees] } : {}),
        },
        newValue: {
          ...(diff?.new ?? {}),
          ...(assigneeIds != null ? { assigneeIds } : {}),
        },
      });
    }

    // A deadline change is the kind of thing a project manager needs to see in the feed
    // (spec section 89).
    if (
      input.dueDate !== undefined &&
      dateColumnToDateOnly(existing.dueDate) !== (input.dueDate ?? null)
    ) {
      await recordActivity(tx, {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'rescheduled',
        summary: `${actor.fullName} changed the due date of ${existing.reference} from ${
          dateColumnToDateOnly(existing.dueDate) ?? 'none'
        } to ${input.dueDate ?? 'none'}`,
        entityType: 'Task',
        entityId: taskId,
      });
    }

    if (input.estimatedHours !== undefined) {
      await recomputeProjectProgress(tx, context.projectId);
    }
  });

  if (newlyAssigned.length > 0) {
    await notifyAssigned(db, actor, context.projectId, taskId, newlyAssigned);
  }

  const detail = await getTask(db, actor, context.projectId, taskId);
  emitToProject(context.projectId, 'task:updated', { projectId: context.projectId, task: detail });
  return detail;
}

// ----------------------------------------------------------- status/progress

export async function updateTaskStatus(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
  input: UpdateTaskStatusInput,
): Promise<TaskDetail> {
  assertProjectMutable(context);

  const task = await loadTaskForOwnUpdate(db, actor, context, taskId);

  if (!canTransition(task.status, input.status)) {
    throw new AppError(
      ERROR_CODES.TASK_STATUS_TRANSITION_INVALID,
      transitionError(task.status, input.status),
    );
  }

  // A member may set only the subset of statuses that describe their own work.
  const isLead = context.permissions.has('task:update');
  if (!isLead && !MEMBER_SETTABLE_TASK_STATUSES.includes(input.status)) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only a project lead can cancel a task. Mark it blocked and raise it with your lead instead.',
    );
  }

  // Finish-to-Start: starting a task whose predecessor is unfinished is a warning the
  // user may accept, and the acceptance is recorded (spec section 20).
  let overrodeWarning = false;
  if (input.status === 'IN_PROGRESS' && task.status === 'NOT_STARTED') {
    const blocking = blockingPredecessors(
      task.predecessors.map((dependency) => dependency.predecessor),
    );
    if (blocking.length > 0) {
      if (!input.overridePredecessorWarning) {
        throw new AppError(
          ERROR_CODES.TASK_PREDECESSOR_INCOMPLETE,
          `${blocking.map((item) => item.reference).join(', ')} ${
            blocking.length === 1 ? 'has' : 'have'
          } not finished yet. Start this task anyway only if you are sure.`,
          {
            details: blocking.map((item) => ({
              path: item.reference,
              message: `${item.name} is ${item.status.toLowerCase().replace(/_/g, ' ')}.`,
            })),
          },
        );
      }
      overrodeWarning = true;
    }
  }

  const progress = progressForStatus(input.status, task.progress);

  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: input.status,
        ...(progress != null ? { progress } : {}),
        completedAt: input.status === 'COMPLETED' ? new Date() : null,
      },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'task.status-changed',
        entityType: 'Task',
        entityId: taskId,
        oldValue: { status: task.status, progress: task.progress },
        newValue: {
          status: input.status,
          progress: progress ?? task.progress,
          note: input.note ?? null,
          ...(overrodeWarning ? { overrodePredecessorWarning: true } : {}),
        },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'updated',
        summary: `${actor.fullName} moved ${task.reference} to ${input.status
          .toLowerCase()
          .replace(/_/g, ' ')}${input.note ? `: ${input.note}` : ''}`,
        entityType: 'Task',
        entityId: taskId,
      },
    );

    await maybeStartPhase(tx, context.projectId, task.phaseId, input.status, actor);
    await recomputeProjectProgress(tx, context.projectId);
  });

  await notifyStatusChange(db, actor, context.projectId, taskId, input.status);

  const detail = await getTask(db, actor, context.projectId, taskId);
  emitToProject(context.projectId, 'task:updated', { projectId: context.projectId, task: detail });
  return detail;
}

export async function updateTaskProgress(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
  input: UpdateTaskProgressInput,
): Promise<TaskDetail> {
  assertProjectMutable(context);

  const task = await loadTaskForOwnUpdate(db, actor, context, taskId);
  const status = statusForProgress(input.progress, task.status);

  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        progress: input.progress,
        ...(status != null ? { status } : {}),
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(input.actualHours != null ? { actualHours: input.actualHours } : {}),
      },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'task.progress-updated',
        entityType: 'Task',
        entityId: taskId,
        oldValue: { progress: task.progress, status: task.status },
        newValue: {
          progress: input.progress,
          status: status ?? task.status,
          note: input.note ?? null,
        },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'updated',
        summary: `${actor.fullName} updated ${task.reference} to ${input.progress}%`,
        entityType: 'Task',
        entityId: taskId,
      },
    );

    await maybeStartPhase(tx, context.projectId, task.phaseId, status ?? task.status, actor);
    await recomputeProjectProgress(tx, context.projectId);
  });

  if (status === 'COMPLETED') {
    await notifyStatusChange(db, actor, context.projectId, taskId, 'COMPLETED');
  }

  const detail = await getTask(db, actor, context.projectId, taskId);
  emitToProject(context.projectId, 'task:updated', { projectId: context.projectId, task: detail });
  return detail;
}

export async function deleteTask(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
): Promise<void> {
  assertProjectPermission(context, 'task:delete');
  assertProjectMutable(context);

  const task = await db.task.findFirst({
    where: { id: taskId, projectId: context.projectId, deletedAt: null },
    select: { id: true, reference: true, name: true },
  });
  if (task == null) throw notFound('That task');

  await db.$transaction(async (tx) => {
    // Soft delete: dependencies, comments and audit entries keep pointing at a real row.
    await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    await tx.taskDependency.deleteMany({
      where: { OR: [{ predecessorId: taskId }, { successorId: taskId }] },
    });
    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'task.deleted',
        entityType: 'Task',
        entityId: taskId,
        oldValue: { reference: task.reference, name: task.name },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'deleted',
        summary: `${actor.fullName} deleted ${task.reference} ${task.name}`,
        entityType: 'Task',
        entityId: taskId,
      },
    );
    await recomputeProjectProgress(tx, context.projectId);
  });
}

// ------------------------------------------------------- comments and files

export async function listComments(
  db: Db,
  projectId: string,
  taskId: string,
): Promise<TaskComment[]> {
  const rows = await db.taskComment.findMany({
    where: { taskId, task: { projectId } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: { select: USER_SUMMARY_SELECT },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    author: toUserSummary(row.author),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function addComment(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
  input: CreateTaskCommentInput,
): Promise<TaskComment[]> {
  assertProjectPermission(context, 'task:comment');
  assertProjectMutable(context);

  const task = await db.task.findFirst({
    where: { id: taskId, projectId: context.projectId, deletedAt: null },
    select: { id: true, reference: true },
  });
  if (task == null) throw notFound('That task');

  await db.taskComment.create({
    data: { taskId, authorId: actor.id, body: input.body },
  });
  await recordActivity(db, {
    projectId: context.projectId,
    actorId: actor.id,
    verb: 'commented',
    summary: `${actor.fullName} commented on ${task.reference}`,
    entityType: 'Task',
    entityId: taskId,
  });

  return listComments(db, context.projectId, taskId);
}

export async function addLinkAttachment(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  taskId: string,
  input: CreateTaskLinkAttachmentInput,
): Promise<TaskDetail> {
  assertProjectPermission(context, 'task:attach');
  assertProjectMutable(context);

  const task = await db.task.findFirst({
    where: { id: taskId, projectId: context.projectId, deletedAt: null },
    select: { id: true, reference: true },
  });
  if (task == null) throw notFound('That task');

  await db.taskAttachment.create({
    data: {
      taskId,
      // Drive links are recognised by host so the resource library can group them; there
      // is no Drive integration behind this (decision D-007).
      kind: isGoogleDriveUrl(input.url) ? 'GOOGLE_DRIVE' : 'LINK',
      name: input.name,
      url: input.url,
      addedById: actor.id,
    },
  });

  await recordActivity(db, {
    projectId: context.projectId,
    actorId: actor.id,
    verb: 'attached',
    summary: `${actor.fullName} attached ${input.name} to ${task.reference}`,
    entityType: 'Task',
    entityId: taskId,
  });

  return getTask(db, actor, context.projectId, taskId);
}

export function isGoogleDriveUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'drive.google.com' ||
      host === 'docs.google.com' ||
      host.endsWith('.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Loads a task for a status or progress change and checks that the caller is entitled to
 * make it: either they manage the project, or the task is assigned to them.
 */
async function loadTaskForOwnUpdate(db: Db, actor: Actor, context: ProjectContext, taskId: string) {
  const task = await db.task.findFirst({
    where: { id: taskId, projectId: context.projectId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      progress: true,
      phaseId: true,
      assignments: { select: { userId: true } },
      predecessors: {
        where: { type: 'FINISH_TO_START' },
        select: {
          predecessor: { select: { id: true, reference: true, name: true, status: true } },
        },
      },
    },
  });
  if (task == null) throw notFound('That task');

  const managesProject = context.permissions.has('task:update');
  if (managesProject) return task;

  assertProjectPermission(context, 'task:update-own-progress');
  const assigned = task.assignments.some((assignment) => assignment.userId === actor.id);
  if (!assigned) {
    throw new AppError(
      ERROR_CODES.TASK_NOT_ASSIGNED_TO_YOU,
      'You can only update tasks that are assigned to you.',
    );
  }
  return task;
}

/** A phase and a WBS item must agree: the WBS item wins, because it is the finer choice. */
async function resolvePlacement(
  db: Db,
  projectId: string,
  phaseId: string | null | undefined,
  wbsItemId: string | null | undefined,
): Promise<{ phaseId: string | null; wbsItemId: string | null }> {
  if (wbsItemId != null) {
    const wbs = await db.wbsItem.findFirst({
      where: { id: wbsItemId, projectId },
      select: { id: true, phaseId: true },
    });
    if (wbs == null) throw notFound('That WBS item');
    return { wbsItemId: wbs.id, phaseId: wbs.phaseId };
  }

  if (phaseId != null) {
    const found = await db.phase.count({ where: { id: phaseId, projectId } });
    if (found === 0) throw notFound('That phase');
    return { phaseId, wbsItemId: null };
  }

  return { phaseId: null, wbsItemId: null };
}

/** Assignees must be members of the project (data integrity rule in master prompt §43). */
async function validateAssignees(
  db: Db,
  projectId: string,
  assigneeIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(assigneeIds)];
  if (unique.length === 0) return [];

  const members = await db.projectMember.findMany({
    where: { projectId, userId: { in: unique } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((member) => member.userId));
  const strangers = unique.filter((id) => !memberIds.has(id));

  if (strangers.length > 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A task can only be assigned to people who are on the project. Add them to the team first.',
      {
        details: strangers.map((id) => ({
          path: 'assigneeIds',
          message: `${id} is not a project member.`,
        })),
      },
    );
  }

  return unique;
}

/** The first real activity in a phase starts it, so actual dates reflect what happened. */
async function maybeStartPhase(
  db: Db,
  projectId: string,
  phaseId: string | null,
  status: string,
  actor: Actor,
): Promise<void> {
  if (phaseId == null) return;
  if (status === 'NOT_STARTED' || status === 'CANCELLED') return;

  const phase = await db.phase.findUnique({
    where: { id: phaseId },
    select: { status: true, actualStart: true },
  });
  if (phase == null) return;
  if (phase.actualStart != null && phase.status !== 'NOT_STARTED') return;

  await db.phase.update({
    where: { id: phaseId },
    data: {
      ...(phase.actualStart == null
        ? { actualStart: dateOnlyToDateColumn(today(actor.timezone)) }
        : {}),
      ...(phase.status === 'NOT_STARTED' ? { status: 'IN_PROGRESS' } : {}),
    },
  });
}

async function notifyAssigned(
  db: Db,
  actor: Actor,
  projectId: string,
  taskId: string,
  assigneeIds: readonly string[],
): Promise<void> {
  if (assigneeIds.length === 0) return;

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      reference: true,
      name: true,
      dueDate: true,
      priority: true,
      project: { select: { id: true, name: true } },
    },
  });

  await notifyMany(
    db,
    assigneeIds,
    (userId) => ({
      userId,
      type: 'TASK_ASSIGNED',
      title: `${task.reference} assigned to you`,
      body: `${actor.fullName} assigned you ${task.reference} ${task.name} in ${task.project.name}.`,
      projectId,
      taskId,
      entityType: 'Task',
      entityId: taskId,
      link: `/projects/${projectId}/tasks/${taskId}`,
      email: {
        template: 'task-assigned',
        payload: {
          projectId,
          projectName: task.project.name,
          taskId,
          reference: task.reference,
          taskName: task.name,
          dueDate: dateColumnToDateOnly(task.dueDate) ?? 'No due date',
          priority: task.priority,
          assignedBy: actor.fullName,
        },
      },
    }),
    [actor.id],
  );
}

/** Tells the lead when work becomes blocked, and the assignees when it is finished. */
async function notifyStatusChange(
  db: Db,
  actor: Actor,
  projectId: string,
  taskId: string,
  status: string,
): Promise<void> {
  if (status !== 'BLOCKED' && status !== 'COMPLETED') return;

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      reference: true,
      name: true,
      project: { select: { name: true, leadId: true } },
      assignments: { select: { userId: true } },
    },
  });

  const recipients =
    status === 'BLOCKED'
      ? task.project.leadId != null
        ? [task.project.leadId]
        : []
      : [
          ...task.assignments.map((assignment) => assignment.userId),
          ...(task.project.leadId != null ? [task.project.leadId] : []),
        ];

  await notifyMany(
    db,
    recipients,
    (userId) => ({
      userId,
      type: status === 'BLOCKED' ? 'TASK_BLOCKED' : 'TASK_COMPLETED',
      title:
        status === 'BLOCKED' ? `${task.reference} is blocked` : `${task.reference} is complete`,
      body: `${actor.fullName} marked ${task.reference} ${task.name} as ${status.toLowerCase()} in ${task.project.name}.`,
      projectId,
      taskId,
      entityType: 'Task',
      entityId: taskId,
      link: `/projects/${projectId}/tasks/${taskId}`,
    }),
    [actor.id],
  );
}
