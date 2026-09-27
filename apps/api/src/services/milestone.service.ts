/**
 * Milestones and the RACI matrix (spec sections 21 and 24).
 */
import {
  ERROR_CODES,
  type CreateMilestoneInput,
  type Milestone,
  type RaciMatrix,
  type ReplaceRaciInput,
  type UpdateMilestoneInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { compareWbsCodes } from '../domain/wbs.js';
import { dateColumnToDateOnly, dateOnlyToDateColumn, type DateOnly } from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordActivity, recordAudit } from './audit.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

const MILESTONE_SELECT = {
  id: true,
  name: true,
  description: true,
  date: true,
  status: true,
  owner: { select: USER_SUMMARY_SELECT },
  phase: { select: { id: true, name: true } },
  tasks: {
    select: { task: { select: { id: true, reference: true, name: true, status: true } } },
  },
} satisfies Prisma.MilestoneSelect;

type MilestoneRow = Prisma.MilestoneGetPayload<{ select: typeof MILESTONE_SELECT }>;

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    date: dateColumnToDateOnly(row.date) as DateOnly,
    status: row.status,
    owner: toUserSummaryOrNull(row.owner),
    phase: row.phase,
    tasks: row.tasks.map((link) => link.task),
  };
}

export async function listMilestones(db: Db, context: ProjectContext): Promise<Milestone[]> {
  assertProjectPermission(context, 'project:read');
  const rows = await db.milestone.findMany({
    where: { projectId: context.projectId },
    orderBy: { date: 'asc' },
    select: MILESTONE_SELECT,
  });
  return rows.map(toMilestone);
}

export async function createMilestone(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateMilestoneInput,
): Promise<Milestone> {
  assertProjectPermission(context, 'milestone:manage');
  assertProjectMutable(context);

  const taskIds = await validateTasks(db, context.projectId, input.taskIds);

  const row = await db.milestone.create({
    data: {
      projectId: context.projectId,
      phaseId: input.phaseId ?? null,
      name: input.name,
      description: input.description ?? null,
      date: dateOnlyToDateColumn(input.date) as Date,
      status: input.status,
      ownerId: input.ownerId ?? null,
      tasks: { create: taskIds.map((taskId) => ({ taskId })) },
    },
    select: MILESTONE_SELECT,
  });

  await recordActivity(db, {
    projectId: context.projectId,
    actorId: actor.id,
    verb: 'created',
    summary: `${actor.fullName} added the milestone ${row.name}`,
    entityType: 'Milestone',
    entityId: row.id,
  });

  return toMilestone(row);
}

export async function updateMilestone(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  milestoneId: string,
  input: UpdateMilestoneInput,
): Promise<Milestone> {
  assertProjectPermission(context, 'milestone:manage');
  assertProjectMutable(context);

  const existing = await db.milestone.findFirst({
    where: { id: milestoneId, projectId: context.projectId },
    select: { id: true, name: true, status: true },
  });
  if (existing == null) throw notFound('That milestone');

  const taskIds =
    input.taskIds == null ? null : await validateTasks(db, context.projectId, input.taskIds);

  const row = await db.$transaction(async (tx) => {
    if (taskIds != null) {
      await tx.milestoneTask.deleteMany({ where: { milestoneId } });
      if (taskIds.length > 0) {
        await tx.milestoneTask.createMany({
          data: taskIds.map((taskId) => ({ milestoneId, taskId })),
        });
      }
    }

    return tx.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.date != null ? { date: dateOnlyToDateColumn(input.date) as Date } : {}),
        ...(input.status != null ? { status: input.status } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
        ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
      },
      select: MILESTONE_SELECT,
    });
  });

  if (input.status != null && input.status !== existing.status) {
    await recordActivity(db, {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'updated',
      summary: `${actor.fullName} marked the milestone ${row.name} as ${input.status
        .toLowerCase()
        .replace(/_/g, ' ')}`,
      entityType: 'Milestone',
      entityId: milestoneId,
    });
  }

  return toMilestone(row);
}

export async function deleteMilestone(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  milestoneId: string,
): Promise<void> {
  assertProjectPermission(context, 'milestone:manage');
  assertProjectMutable(context);

  const existing = await db.milestone.findFirst({
    where: { id: milestoneId, projectId: context.projectId },
    select: { id: true, name: true },
  });
  if (existing == null) throw notFound('That milestone');

  await db.milestone.delete({ where: { id: milestoneId } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'milestone.deleted',
    entityType: 'Milestone',
    entityId: milestoneId,
    oldValue: { name: existing.name },
  });
}

// ------------------------------------------------------------------- RACI

/**
 * The matrix as the UI needs it: project members across the top, work items down the
 * side, and a cell wherever a role has been assigned.
 */
export async function getRaci(db: Db, context: ProjectContext): Promise<RaciMatrix> {
  assertProjectPermission(context, 'project:read');

  const [members, assignments, tasks, wbsItems] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId: context.projectId },
      orderBy: { projectRole: 'asc' },
      select: { user: { select: USER_SUMMARY_SELECT } },
    }),
    db.raciAssignment.findMany({
      where: { projectId: context.projectId },
      select: { userId: true, role: true, taskId: true, wbsItemId: true },
    }),
    db.task.findMany({
      where: { projectId: context.projectId, deletedAt: null },
      select: { id: true, reference: true, name: true },
    }),
    db.wbsItem.findMany({
      where: { projectId: context.projectId },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const rows: RaciMatrix['rows'] = [
    ...wbsItems
      .sort((a, b) => compareWbsCodes(a.code, b.code))
      .map((item) => ({
        kind: 'WBS' as const,
        id: item.id,
        label: item.name,
        reference: item.code,
        cells: assignments
          .filter((assignment) => assignment.wbsItemId === item.id)
          .map((assignment) => ({ userId: assignment.userId, role: assignment.role })),
      })),
    ...tasks
      .sort((a, b) => a.reference.localeCompare(b.reference, undefined, { numeric: true }))
      .map((task) => ({
        kind: 'TASK' as const,
        id: task.id,
        label: task.name,
        reference: task.reference,
        cells: assignments
          .filter((assignment) => assignment.taskId === task.id)
          .map((assignment) => ({ userId: assignment.userId, role: assignment.role })),
      })),
  ];

  return { members: members.map((member) => toUserSummary(member.user)), rows };
}

/**
 * Replaces the whole matrix in one transaction.
 *
 * A partial update would leave the grid in a state nobody chose; the UI edits a grid, so
 * the API accepts a grid. Exactly one accountable person per item is enforced, because a
 * RACI with two accountable people is not a RACI.
 */
export async function replaceRaci(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: ReplaceRaciInput,
): Promise<RaciMatrix> {
  assertProjectPermission(context, 'raci:manage');
  assertProjectMutable(context);

  const members = await db.projectMember.findMany({
    where: { projectId: context.projectId },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((member) => member.userId));

  const accountableByItem = new Map<string, number>();
  for (const entry of input.entries) {
    if (!memberIds.has(entry.userId)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'RACI can only name people who are on the project.',
      );
    }
    if (entry.role === 'ACCOUNTABLE') {
      const key = entry.taskId ?? entry.wbsItemId ?? '';
      const count = (accountableByItem.get(key) ?? 0) + 1;
      if (count > 1) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Each work item can have only one accountable person.',
        );
      }
      accountableByItem.set(key, count);
    }
  }

  const taskIds = input.entries
    .map((entry) => entry.taskId)
    .filter((id): id is string => id != null);
  const wbsIds = input.entries
    .map((entry) => entry.wbsItemId)
    .filter((id): id is string => id != null);

  const [validTasks, validWbs] = await Promise.all([
    taskIds.length === 0
      ? []
      : db.task.findMany({
          where: { id: { in: taskIds }, projectId: context.projectId, deletedAt: null },
          select: { id: true },
        }),
    wbsIds.length === 0
      ? []
      : db.wbsItem.findMany({
          where: { id: { in: wbsIds }, projectId: context.projectId },
          select: { id: true },
        }),
  ]);

  const validTaskIds = new Set(validTasks.map((task) => task.id));
  const validWbsIds = new Set(validWbs.map((item) => item.id));

  if (taskIds.some((id) => !validTaskIds.has(id)) || wbsIds.some((id) => !validWbsIds.has(id))) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'RACI can only reference work items in this project.',
    );
  }

  await db.$transaction(async (tx) => {
    await tx.raciAssignment.deleteMany({ where: { projectId: context.projectId } });
    if (input.entries.length > 0) {
      await tx.raciAssignment.createMany({
        data: input.entries.map((entry) => ({
          projectId: context.projectId,
          userId: entry.userId,
          role: entry.role,
          taskId: entry.taskId ?? null,
          wbsItemId: entry.wbsItemId ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      projectId: context.projectId,
      action: 'raci.replaced',
      entityType: 'Project',
      entityId: context.projectId,
      newValue: { entries: input.entries.length },
    });
  });

  return getRaci(db, context);
}

async function validateTasks(
  db: Db,
  projectId: string,
  taskIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return [];

  const found = await db.task.findMany({
    where: { id: { in: unique }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A milestone can only reference tasks in the same project.',
    );
  }
  return unique;
}
