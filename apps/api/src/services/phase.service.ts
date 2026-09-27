/**
 * The Waterfall engine: phases and their gates (spec sections 4, 5 and 13).
 */
import {
  ERROR_CODES,
  type CreatePhaseInput,
  type DecidePhaseInput,
  type Phase,
  type ReorderPhasesInput,
  type SubmitPhaseInput,
  type UpdatePhaseInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import {
  canPhaseStart,
  canSubmitPhase,
  gateStatusFor,
  resolveApprover,
  statusAfterDecision,
} from '../domain/phase-gate.js';
import { countTasks } from '../domain/task-rules.js';
import { dateColumnToDateOnly, dateOnlyToDateColumn, today } from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordAudit, recordChange, diffValues } from './audit.service.js';
import { notifyMany, projectAudience } from './notification.service.js';
import { recomputeProjectProgress } from './rollup.service.js';
import { USER_SUMMARY_SELECT, toUserSummaryOrNull } from './user.mapper.js';

const PHASE_SELECT = {
  id: true,
  sequence: true,
  name: true,
  description: true,
  status: true,
  progress: true,
  plannedStart: true,
  plannedEnd: true,
  actualStart: true,
  actualEnd: true,
  deliverables: true,
  approvalRequired: true,
  gateStatus: true,
  decidedAt: true,
  decisionNote: true,
  submittedAt: true,
  owner: { select: USER_SUMMARY_SELECT },
  approver: { select: USER_SUMMARY_SELECT },
  submittedBy: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.PhaseSelect;

type PhaseRow = Prisma.PhaseGetPayload<{ select: typeof PHASE_SELECT }>;

export async function listPhases(db: Db, actor: Actor, projectId: string): Promise<Phase[]> {
  const todayDate = today(actor.timezone);
  const [rows, tasks] = await Promise.all([
    db.phase.findMany({
      where: { projectId },
      orderBy: { sequence: 'asc' },
      select: PHASE_SELECT,
    }),
    db.task.findMany({
      where: { projectId, deletedAt: null },
      select: { phaseId: true, status: true, dueDate: true },
    }),
  ]);

  const gateShape = rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    name: row.name,
    status: row.status,
    approvalRequired: row.approvalRequired,
    gateStatus: row.gateStatus,
  }));

  return rows.map((row) => {
    const phaseTasks = tasks
      .filter((task) => task.phaseId === row.id)
      .map((task) => ({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) }));
    const decision = canPhaseStart(
      gateShape.find((phase) => phase.id === row.id) as (typeof gateShape)[number],
      gateShape,
    );
    return toPhase(row, countTasks(phaseTasks, todayDate), decision);
  });
}

export async function getPhase(
  db: Db,
  actor: Actor,
  projectId: string,
  phaseId: string,
): Promise<Phase> {
  const phases = await listPhases(db, actor, projectId);
  const phase = phases.find((candidate) => candidate.id === phaseId);
  if (phase == null) throw notFound('That phase');
  return phase;
}

function toPhase(
  row: PhaseRow,
  taskCounts: Phase['taskCounts'],
  decision: { canStart: boolean; reason: string | null },
): Phase {
  return {
    id: row.id,
    sequence: row.sequence,
    name: row.name,
    description: row.description,
    owner: toUserSummaryOrNull(row.owner),
    status: row.status,
    progress: row.progress,
    plannedStart: dateColumnToDateOnly(row.plannedStart),
    plannedEnd: dateColumnToDateOnly(row.plannedEnd),
    actualStart: dateColumnToDateOnly(row.actualStart),
    actualEnd: dateColumnToDateOnly(row.actualEnd),
    deliverables: row.deliverables,
    gate: {
      approvalRequired: row.approvalRequired,
      status: row.gateStatus,
      approver: toUserSummaryOrNull(row.approver),
      submittedBy: toUserSummaryOrNull(row.submittedBy),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
    },
    taskCounts,
    canStart: decision.canStart,
    blockedReason: decision.reason,
  };
}

// -------------------------------------------------------------------- create

export async function createPhase(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreatePhaseInput,
): Promise<Phase> {
  assertProjectPermission(context, 'phase:create');
  assertProjectMutable(context);

  const phaseId = await db.$transaction(async (tx) => {
    const existing = await tx.phase.findMany({
      where: { projectId: context.projectId },
      orderBy: { sequence: 'asc' },
      select: { id: true, sequence: true },
    });

    const position =
      input.sequence == null ? existing.length + 1 : Math.min(input.sequence, existing.length + 1);

    // Sequences are unique per project, so the shuffle happens in two passes: move the
    // affected rows out of the way, then place them at their new numbers.
    const toShift = existing.filter((phase) => phase.sequence >= position);
    if (toShift.length > 0) {
      await tx.phase.updateMany({
        where: { id: { in: toShift.map((phase) => phase.id) } },
        data: { sequence: { increment: 1000 } },
      });
      for (const phase of toShift) {
        await tx.phase.update({
          where: { id: phase.id },
          data: { sequence: phase.sequence + 1 },
        });
      }
    }

    const created = await tx.phase.create({
      data: {
        projectId: context.projectId,
        sequence: position,
        name: input.name,
        description: input.description ?? null,
        ownerId: input.ownerId ?? null,
        plannedStart: dateOnlyToDateColumn(input.plannedStart ?? null),
        plannedEnd: dateOnlyToDateColumn(input.plannedEnd ?? null),
        deliverables: input.deliverables,
        approvalRequired: input.approvalRequired,
        approverId: input.approverId ?? null,
        gateStatus: input.approvalRequired ? 'PENDING' : 'NOT_REQUIRED',
      },
      select: { id: true, name: true },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'phase.created',
        entityType: 'Phase',
        entityId: created.id,
        newValue: { name: created.name, sequence: position },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `${actor.fullName} added the phase ${created.name}`,
        entityType: 'Phase',
        entityId: created.id,
      },
    );

    return created.id;
  });

  return getPhase(db, actor, context.projectId, phaseId);
}

// -------------------------------------------------------------------- update

export async function updatePhase(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  phaseId: string,
  input: UpdatePhaseInput,
): Promise<Phase> {
  assertProjectPermission(context, 'phase:update');
  assertProjectMutable(context);

  const existing = await db.phase.findFirst({
    where: { id: phaseId, projectId: context.projectId },
    select: {
      name: true,
      description: true,
      ownerId: true,
      plannedStart: true,
      plannedEnd: true,
      status: true,
      approvalRequired: true,
      approverId: true,
      gateStatus: true,
      deliverables: true,
      actualStart: true,
    },
  });
  if (existing == null) throw notFound('That phase');

  // Starting a phase is gated by the phases before it (spec section 5).
  if (input.status === 'IN_PROGRESS' && existing.status !== 'IN_PROGRESS') {
    const phases = await db.phase.findMany({
      where: { projectId: context.projectId },
      select: {
        id: true,
        sequence: true,
        name: true,
        status: true,
        approvalRequired: true,
        gateStatus: true,
      },
    });
    const target = phases.find((phase) => phase.id === phaseId);
    if (target != null) {
      const decision = canPhaseStart(target, phases);
      if (!decision.canStart) {
        throw new AppError(
          ERROR_CODES.PHASE_GATE_BLOCKED,
          decision.reason ?? 'This phase cannot start yet.',
        );
      }
    }
  }

  const approvalRequired = input.approvalRequired ?? existing.approvalRequired;
  const todayDate = today(actor.timezone);

  await db.$transaction(async (tx) => {
    const data: Prisma.PhaseUncheckedUpdateInput = {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
      ...(input.plannedStart !== undefined
        ? { plannedStart: dateOnlyToDateColumn(input.plannedStart) }
        : {}),
      ...(input.plannedEnd !== undefined
        ? { plannedEnd: dateOnlyToDateColumn(input.plannedEnd) }
        : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.approvalRequired != null
        ? {
            approvalRequired: input.approvalRequired,
            gateStatus: gateStatusFor(input.approvalRequired, existing.gateStatus),
          }
        : {}),
      ...(input.approverId !== undefined ? { approverId: input.approverId ?? null } : {}),
      ...(input.deliverables != null ? { deliverables: input.deliverables } : {}),
      // Actual dates are recorded by the system, not typed in, so the timeline is real.
      ...(input.status === 'IN_PROGRESS' && existing.actualStart == null
        ? { actualStart: dateOnlyToDateColumn(todayDate) }
        : {}),
      ...(input.status === 'COMPLETED' || input.status === 'APPROVED'
        ? { actualEnd: dateOnlyToDateColumn(todayDate) }
        : {}),
    };

    await tx.phase.update({ where: { id: phaseId }, data });

    const diff = diffValues(
      existing as Record<string, unknown>,
      {
        ...input,
        approvalRequired,
      } as Record<string, unknown>,
    );
    if (diff != null) {
      await recordAudit(tx, {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'phase.updated',
        entityType: 'Phase',
        entityId: phaseId,
        oldValue: diff.old,
        newValue: diff.new,
      });
    }

    if (input.status != null && input.status !== existing.status) {
      await tx.activityLog.create({
        data: {
          projectId: context.projectId,
          actorId: actor.id,
          verb: 'updated',
          summary: `${actor.fullName} moved ${input.name ?? existing.name} to ${input.status.toLowerCase().replace(/_/g, ' ')}`,
          entityType: 'Phase',
          entityId: phaseId,
        },
      });
    }

    // Phase dates feed the project-level weighting, so progress is refreshed.
    if (input.plannedStart !== undefined || input.plannedEnd !== undefined) {
      await recomputeProjectProgress(tx, context.projectId);
    }
  });

  return getPhase(db, actor, context.projectId, phaseId);
}

export async function deletePhase(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  phaseId: string,
): Promise<void> {
  assertProjectPermission(context, 'phase:delete');
  assertProjectMutable(context);

  const phase = await db.phase.findFirst({
    where: { id: phaseId, projectId: context.projectId },
    select: { id: true, name: true, sequence: true, _count: { select: { tasks: true } } },
  });
  if (phase == null) throw notFound('That phase');

  // Tasks survive: `Phase -> Task` is SetNull, so the work becomes unphased rather than
  // disappearing with the phase.
  await db.phase.delete({ where: { id: phaseId } });
  await db.phase.updateMany({
    where: { projectId: context.projectId, sequence: { gt: phase.sequence } },
    data: { sequence: { decrement: 1 } },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'phase.deleted',
    entityType: 'Phase',
    entityId: phaseId,
    oldValue: { name: phase.name, tasksUnphased: phase._count.tasks },
  });
}

export async function reorderPhases(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: ReorderPhasesInput,
): Promise<Phase[]> {
  assertProjectPermission(context, 'phase:update');
  assertProjectMutable(context);

  const existing = await db.phase.findMany({
    where: { projectId: context.projectId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((phase) => phase.id));

  if (
    input.phaseIds.length !== existing.length ||
    input.phaseIds.some((id) => !existingIds.has(id))
  ) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Send the complete list of phase ids in their new order.',
    );
  }

  await db.$transaction(async (tx) => {
    // Park every row above the used range first: the unique constraint on (project,
    // sequence) would otherwise be violated part-way through the reorder.
    await tx.phase.updateMany({
      where: { projectId: context.projectId },
      data: { sequence: { increment: 1000 } },
    });
    for (const [index, phaseId] of input.phaseIds.entries()) {
      await tx.phase.update({ where: { id: phaseId }, data: { sequence: index + 1 } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      projectId: context.projectId,
      action: 'phase.reordered',
      entityType: 'Project',
      entityId: context.projectId,
      newValue: { order: input.phaseIds },
    });
  });

  return listPhases(db, actor, context.projectId);
}

// --------------------------------------------------------------- phase gate

export async function submitPhase(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  phaseId: string,
  input: SubmitPhaseInput,
): Promise<Phase> {
  assertProjectPermission(context, 'phase:update');
  assertProjectMutable(context);

  const phase = await db.phase.findFirst({
    where: { id: phaseId, projectId: context.projectId },
    select: {
      id: true,
      sequence: true,
      name: true,
      status: true,
      approvalRequired: true,
      gateStatus: true,
      approverId: true,
      tasks: { where: { deletedAt: null }, select: { status: true } },
    },
  });
  if (phase == null) throw notFound('That phase');

  const check = canSubmitPhase(
    phase,
    phase.tasks.map((task) => task.status),
  );
  if (!check.canSubmit) {
    throw new AppError(
      phase.gateStatus === 'APPROVED' || phase.gateStatus === 'SUBMITTED'
        ? ERROR_CODES.PHASE_ALREADY_DECIDED
        : ERROR_CODES.PHASE_GATE_BLOCKED,
      check.reason ?? 'This phase cannot be submitted.',
    );
  }

  await db.$transaction(async (tx) => {
    await tx.phase.update({
      where: { id: phaseId },
      data: {
        status: 'UNDER_REVIEW',
        gateStatus: 'SUBMITTED',
        submittedById: actor.id,
        submittedAt: new Date(),
        decisionNote: input.note ?? null,
      },
    });
    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'phase.submitted',
        entityType: 'Phase',
        entityId: phaseId,
        newValue: { incompleteTasks: check.incompleteTasks, note: input.note ?? null },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'submitted',
        summary: `${actor.fullName} submitted ${phase.name} for approval`,
        entityType: 'Phase',
        entityId: phaseId,
      },
    );
  });

  const resolution = resolveApprover(
    { approverId: phase.approverId, submittedById: actor.id },
    context.leadId,
  );

  const recipients = resolution.requiresAdmin
    ? (
        await db.user.findMany({
          where: {
            organizationId: actor.organizationId,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      ).map((user) => user.id)
    : resolution.approverId != null
      ? [resolution.approverId]
      : [];

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { name: true },
  });

  await notifyMany(
    db,
    recipients,
    (userId) => ({
      userId,
      type: 'PHASE_APPROVAL_REQUIRED',
      title: `Approval needed: ${phase.name}`,
      body: `${actor.fullName} submitted ${phase.name} in ${project.name} for approval.`,
      projectId: context.projectId,
      entityType: 'Phase',
      entityId: phaseId,
      link: `/projects/${context.projectId}/phases/${phaseId}`,
      email: {
        template: 'phase-approval-required',
        payload: {
          projectId: context.projectId,
          projectName: project.name,
          phaseId,
          phaseName: phase.name,
          submittedBy: actor.fullName,
          incompleteTasks: check.incompleteTasks,
        },
      },
    }),
    [actor.id],
  );

  return getPhase(db, actor, context.projectId, phaseId);
}

export async function decidePhase(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  phaseId: string,
  approved: boolean,
  input: DecidePhaseInput,
): Promise<Phase> {
  assertProjectMutable(context);

  const phase = await db.phase.findFirst({
    where: { id: phaseId, projectId: context.projectId },
    select: {
      id: true,
      name: true,
      gateStatus: true,
      approverId: true,
      submittedById: true,
    },
  });
  if (phase == null) throw notFound('That phase');

  if (phase.gateStatus !== 'SUBMITTED') {
    throw new AppError(
      ERROR_CODES.PHASE_NOT_SUBMITTED,
      'This phase is not waiting for a decision.',
    );
  }

  // Decision D-008: the named approver decides, and a gate whose approver submitted it
  // escalates to an administrator.
  const resolution = resolveApprover(phase, context.leadId);
  const isAdmin = actor.role === 'SUPER_ADMIN';

  if (resolution.requiresAdmin) {
    if (!isAdmin) {
      throw new AppError(
        ERROR_CODES.PHASE_APPROVER_IS_SUBMITTER,
        'The approver for this gate is the person who submitted it, so an administrator has to decide.',
      );
    }
  } else if (resolution.approverId !== actor.id && !isAdmin) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only the named approver can decide this phase.');
  } else if (!isAdmin) {
    assertProjectPermission(context, 'phase:approve');
  }

  const status = statusAfterDecision(approved, input.requiresRework);
  const todayDate = today(actor.timezone);

  await db.$transaction(async (tx) => {
    await tx.phase.update({
      where: { id: phaseId },
      data: {
        status,
        gateStatus: approved ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        ...(approved ? { actualEnd: dateOnlyToDateColumn(todayDate), progress: 100 } : {}),
      },
    });
    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: approved ? 'phase.approved' : 'phase.rejected',
        entityType: 'Phase',
        entityId: phaseId,
        oldValue: { gateStatus: 'SUBMITTED' },
        newValue: { gateStatus: approved ? 'APPROVED' : 'REJECTED', note: input.note ?? null },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: approved ? 'approved' : 'rejected',
        summary: `${actor.fullName} ${approved ? 'approved' : 'rejected'} ${phase.name}`,
        entityType: 'Phase',
        entityId: phaseId,
      },
    );
  });

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { name: true },
  });
  const audience = await projectAudience(db, context.projectId);

  await notifyMany(
    db,
    [...audience, ...(phase.submittedById != null ? [phase.submittedById] : [])],
    (userId) => ({
      userId,
      type: approved ? 'PHASE_APPROVED' : 'PHASE_REJECTED',
      title: `${phase.name} was ${approved ? 'approved' : 'rejected'}`,
      body: `${actor.fullName} ${approved ? 'approved' : 'rejected'} ${phase.name} in ${project.name}.`,
      projectId: context.projectId,
      entityType: 'Phase',
      entityId: phaseId,
      link: `/projects/${context.projectId}/phases/${phaseId}`,
      email: {
        template: 'phase-decided',
        payload: {
          projectId: context.projectId,
          projectName: project.name,
          phaseId,
          phaseName: phase.name,
          decision: approved ? 'approved' : 'rejected',
          decidedBy: actor.fullName,
          note: input.note ?? '',
        },
      },
    }),
    [actor.id],
  );

  return getPhase(db, actor, context.projectId, phaseId);
}
