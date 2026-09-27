/**
 * Risks, issues and change requests (spec sections 44 to 46).
 *
 * Two things are enforced here rather than trusted from the client:
 *   * risk severity is derived from probability and impact, so the register can be sorted
 *     and filtered meaningfully;
 *   * a change request cannot be approved before its impact has been analysed, and an
 *     approval only moves the plan when the approver explicitly asks for it. Scope never
 *     changes silently (master prompt section 31).
 */
import {
  ERROR_CODES,
  type AnalyseChangeRequestInput,
  type ChangeRequest,
  type CreateChangeRequestInput,
  type CreateIssueInput,
  type CreateRiskInput,
  type DecideChangeRequestInput,
  type Issue,
  type ListChangeRequestsQuery,
  type ListIssuesQuery,
  type ListRisksQuery,
  type Paginated,
  type Risk,
  type UpdateIssueInput,
  type UpdateRiskInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { riskSeverity, riskSeverityScore } from '../domain/risk.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordActivity, recordAudit, recordChange } from './audit.service.js';
import { notify, notifyMany, projectLeads } from './notification.service.js';
import { pageMeta, paginate } from './pagination.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

// ----------------------------------------------------------------------- risks

const RISK_SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  probability: true,
  impact: true,
  severity: true,
  severityScore: true,
  mitigation: true,
  contingency: true,
  status: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: USER_SUMMARY_SELECT },
  phase: { select: { id: true, name: true } },
  task: { select: { id: true, reference: true } },
} satisfies Prisma.RiskSelect;

type RiskRow = Prisma.RiskGetPayload<{ select: typeof RISK_SELECT }>;

function toRisk(row: RiskRow): Risk {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    probability: row.probability,
    impact: row.impact,
    severity: row.severity,
    severityScore: row.severityScore,
    owner: toUserSummaryOrNull(row.owner),
    mitigation: row.mitigation,
    contingency: row.contingency,
    status: row.status,
    dueDate: dateColumnToDateOnly(row.dueDate),
    phase: row.phase,
    task: row.task,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRisks(
  db: Db,
  context: ProjectContext,
  query: ListRisksQuery,
): Promise<Paginated<Risk>> {
  assertProjectPermission(context, 'project:read');

  const where: Prisma.RiskWhereInput = {
    projectId: context.projectId,
    ...(query.status != null ? { status: query.status } : {}),
    ...(query.severity != null ? { severity: query.severity } : {}),
    ...(query.ownerId != null ? { ownerId: query.ownerId } : {}),
    ...(query.search != null
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  // Sorting by severity means by score, so VERY_HIGH beats HIGH rather than sorting
  // alphabetically.
  const orderBy: Prisma.RiskOrderByWithRelationInput =
    query.sort === 'severity'
      ? { severityScore: query.direction === 'asc' ? 'asc' : 'desc' }
      : { [query.sort]: query.direction };

  const [total, rows] = await Promise.all([
    db.risk.count({ where }),
    db.risk.findMany({ where, select: RISK_SELECT, orderBy, ...paginate(query) }),
  ]);

  return { data: rows.map(toRisk), meta: pageMeta(query, total) };
}

export async function createRisk(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateRiskInput,
): Promise<Risk> {
  assertProjectPermission(context, 'risk:manage');
  assertProjectMutable(context);

  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: context.projectId },
      data: { riskCounter: { increment: 1 } },
      select: { riskCounter: true },
    });

    const created = await tx.risk.create({
      data: {
        projectId: context.projectId,
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        reference: `R-${project.riskCounter}`,
        title: input.title,
        description: input.description ?? null,
        probability: input.probability,
        impact: input.impact,
        severity: riskSeverity(input.probability, input.impact),
        severityScore: riskSeverityScore(input.probability, input.impact),
        ownerId: input.ownerId ?? null,
        mitigation: input.mitigation ?? null,
        contingency: input.contingency ?? null,
        status: input.status,
        dueDate: dateOnlyToDateColumn(input.dueDate ?? null),
      },
      select: RISK_SELECT,
    });

    await recordActivity(tx, {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'raised',
      summary: `${actor.fullName} raised the risk ${created.reference}: ${created.title}`,
      entityType: 'Risk',
      entityId: created.id,
    });

    return created;
  });

  if (input.ownerId != null) {
    await notifyRiskOwner(db, actor, context.projectId, row);
  }

  return toRisk(row);
}

export async function updateRisk(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  riskId: string,
  input: UpdateRiskInput,
): Promise<Risk> {
  assertProjectPermission(context, 'risk:manage');
  assertProjectMutable(context);

  const existing = await db.risk.findFirst({
    where: { id: riskId, projectId: context.projectId },
    select: {
      id: true,
      probability: true,
      impact: true,
      severity: true,
      status: true,
      ownerId: true,
      title: true,
    },
  });
  if (existing == null) throw notFound('That risk');

  const probability = input.probability ?? existing.probability;
  const impact = input.impact ?? existing.impact;

  const row = await db.risk.update({
    where: { id: riskId },
    data: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      // Recomputed on every write, so severity can never drift from its inputs.
      probability,
      impact,
      severity: riskSeverity(probability, impact),
      severityScore: riskSeverityScore(probability, impact),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
      ...(input.mitigation !== undefined ? { mitigation: input.mitigation ?? null } : {}),
      ...(input.contingency !== undefined ? { contingency: input.contingency ?? null } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: dateOnlyToDateColumn(input.dueDate) } : {}),
      ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId ?? null } : {}),
    },
    select: RISK_SELECT,
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'risk.updated',
    entityType: 'Risk',
    entityId: riskId,
    oldValue: { severity: existing.severity, status: existing.status, ownerId: existing.ownerId },
    newValue: { severity: row.severity, status: row.status, ownerId: row.owner?.id ?? null },
  });

  if (input.ownerId != null && input.ownerId !== existing.ownerId) {
    await notifyRiskOwner(db, actor, context.projectId, row);
  }

  return toRisk(row);
}

export async function deleteRisk(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  riskId: string,
): Promise<void> {
  assertProjectPermission(context, 'risk:manage');
  assertProjectMutable(context);

  const existing = await db.risk.findFirst({
    where: { id: riskId, projectId: context.projectId },
    select: { id: true, reference: true, title: true },
  });
  if (existing == null) throw notFound('That risk');

  await db.risk.delete({ where: { id: riskId } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'risk.deleted',
    entityType: 'Risk',
    entityId: riskId,
    oldValue: { reference: existing.reference, title: existing.title },
  });
}

async function notifyRiskOwner(
  db: Db,
  actor: Actor,
  projectId: string,
  risk: RiskRow,
): Promise<void> {
  const ownerId = risk.owner?.id;
  if (ownerId == null || ownerId === actor.id) return;

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true },
  });

  await notify(db, {
    userId: ownerId,
    type: 'RISK_ASSIGNED',
    title: `You own risk ${risk.reference}`,
    body: `${actor.fullName} assigned you ${risk.reference} ${risk.title} in ${project.name}.`,
    projectId,
    entityType: 'Risk',
    entityId: risk.id,
    link: `/projects/${projectId}/risks`,
    email: {
      template: 'risk-assigned',
      payload: {
        projectId,
        projectName: project.name,
        reference: risk.reference,
        title: risk.title,
        severity: risk.severity,
      },
    },
  });
}

// ---------------------------------------------------------------------- issues

const ISSUE_SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  priority: true,
  identifiedOn: true,
  targetResolution: true,
  status: true,
  resolution: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: USER_SUMMARY_SELECT },
  phase: { select: { id: true, name: true } },
  task: { select: { id: true, reference: true } },
} satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_SELECT }>;

function toIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    priority: row.priority,
    owner: toUserSummaryOrNull(row.owner),
    identifiedOn: dateColumnToDateOnly(row.identifiedOn) as DateOnly,
    targetResolution: dateColumnToDateOnly(row.targetResolution),
    status: row.status,
    resolution: row.resolution,
    phase: row.phase,
    task: row.task,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIssues(
  db: Db,
  context: ProjectContext,
  query: ListIssuesQuery,
): Promise<Paginated<Issue>> {
  assertProjectPermission(context, 'project:read');

  const where: Prisma.IssueWhereInput = {
    projectId: context.projectId,
    ...(query.status != null ? { status: query.status } : {}),
    ...(query.priority != null ? { priority: query.priority } : {}),
    ...(query.ownerId != null ? { ownerId: query.ownerId } : {}),
    ...(query.search != null
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.issue.count({ where }),
    db.issue.findMany({
      where,
      select: ISSUE_SELECT,
      orderBy: { [query.sort]: query.direction },
      ...paginate(query),
    }),
  ]);

  return { data: rows.map(toIssue), meta: pageMeta(query, total) };
}

export async function createIssue(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateIssueInput,
): Promise<Issue> {
  assertProjectPermission(context, 'issue:manage');
  assertProjectMutable(context);

  const identifiedOn = input.identifiedOn ?? today(actor.timezone);

  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: context.projectId },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    });

    const created = await tx.issue.create({
      data: {
        projectId: context.projectId,
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        reference: `I-${project.issueCounter}`,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        ownerId: input.ownerId ?? null,
        identifiedOn: dateOnlyToDateColumn(identifiedOn) as Date,
        targetResolution: dateOnlyToDateColumn(input.targetResolution ?? null),
        status: input.status,
        resolution: input.resolution ?? null,
      },
      select: ISSUE_SELECT,
    });

    await recordActivity(tx, {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'raised',
      summary: `${actor.fullName} raised the issue ${created.reference}: ${created.title}`,
      entityType: 'Issue',
      entityId: created.id,
    });

    return created;
  });

  if (row.owner != null && row.owner.id !== actor.id) {
    const project = await db.project.findUniqueOrThrow({
      where: { id: context.projectId },
      select: { name: true },
    });
    await notify(db, {
      userId: row.owner.id,
      type: 'ISSUE_ASSIGNED',
      title: `You own issue ${row.reference}`,
      body: `${actor.fullName} assigned you ${row.reference} ${row.title} in ${project.name}.`,
      projectId: context.projectId,
      entityType: 'Issue',
      entityId: row.id,
      link: `/projects/${context.projectId}/issues`,
      email: {
        template: 'issue-assigned',
        payload: {
          projectId: context.projectId,
          projectName: project.name,
          reference: row.reference,
          title: row.title,
          priority: row.priority,
        },
      },
    });
  }

  return toIssue(row);
}

export async function updateIssue(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  issueId: string,
  input: UpdateIssueInput,
): Promise<Issue> {
  assertProjectPermission(context, 'issue:manage');
  assertProjectMutable(context);

  const existing = await db.issue.findFirst({
    where: { id: issueId, projectId: context.projectId },
    select: { id: true, status: true, ownerId: true },
  });
  if (existing == null) throw notFound('That issue');

  const resolving =
    input.status != null &&
    (input.status === 'RESOLVED' || input.status === 'CLOSED') &&
    existing.status !== 'RESOLVED' &&
    existing.status !== 'CLOSED';

  const row = await db.issue.update({
    where: { id: issueId },
    data: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.priority != null ? { priority: input.priority } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
      ...(input.identifiedOn != null
        ? { identifiedOn: dateOnlyToDateColumn(input.identifiedOn) as Date }
        : {}),
      ...(input.targetResolution !== undefined
        ? { targetResolution: dateOnlyToDateColumn(input.targetResolution) }
        : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution ?? null } : {}),
      ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId ?? null } : {}),
      ...(resolving ? { resolvedAt: new Date() } : {}),
    },
    select: ISSUE_SELECT,
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'issue.updated',
    entityType: 'Issue',
    entityId: issueId,
    oldValue: { status: existing.status },
    newValue: { status: row.status },
  });

  return toIssue(row);
}

export async function deleteIssue(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  issueId: string,
): Promise<void> {
  assertProjectPermission(context, 'issue:manage');
  assertProjectMutable(context);

  const existing = await db.issue.findFirst({
    where: { id: issueId, projectId: context.projectId },
    select: { id: true, reference: true, title: true },
  });
  if (existing == null) throw notFound('That issue');

  await db.issue.delete({ where: { id: issueId } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'issue.deleted',
    entityType: 'Issue',
    entityId: issueId,
    oldValue: { reference: existing.reference, title: existing.title },
  });
}

// -------------------------------------------------------------- change requests

const CHANGE_SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  reason: true,
  status: true,
  requestedOn: true,
  scopeImpact: true,
  scheduleImpactDays: true,
  effortImpactHours: true,
  resourceImpact: true,
  costImpact: true,
  riskImpact: true,
  affectedTaskIds: true,
  analysedAt: true,
  decidedAt: true,
  decisionNote: true,
  scheduleImpactApplied: true,
  createdAt: true,
  requester: { select: USER_SUMMARY_SELECT },
  analysedBy: { select: USER_SUMMARY_SELECT },
  approver: { select: USER_SUMMARY_SELECT },
  phase: { select: { id: true, name: true } },
} satisfies Prisma.ChangeRequestSelect;

type ChangeRow = Prisma.ChangeRequestGetPayload<{ select: typeof CHANGE_SELECT }>;

async function toChangeRequest(db: Db, row: ChangeRow): Promise<ChangeRequest> {
  const affectedTasks =
    row.affectedTaskIds.length === 0
      ? []
      : await db.task.findMany({
          where: { id: { in: row.affectedTaskIds } },
          select: { id: true, reference: true, name: true },
        });

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    reason: row.reason,
    status: row.status,
    requester: toUserSummary(row.requester),
    requestedOn: dateColumnToDateOnly(row.requestedOn) as DateOnly,
    phase: row.phase,
    impact:
      row.analysedAt == null
        ? null
        : {
            scopeImpact: row.scopeImpact,
            scheduleImpactDays: row.scheduleImpactDays,
            effortImpactHours: Number(row.effortImpactHours),
            resourceImpact: row.resourceImpact,
            costImpact: row.costImpact == null ? null : Number(row.costImpact),
            riskImpact: row.riskImpact,
            affectedTasks,
            analysedBy: toUserSummaryOrNull(row.analysedBy),
            analysedAt: row.analysedAt.toISOString(),
          },
    approver: toUserSummaryOrNull(row.approver),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    scheduleImpactApplied: row.scheduleImpactApplied,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listChangeRequests(
  db: Db,
  context: ProjectContext,
  query: ListChangeRequestsQuery,
): Promise<Paginated<ChangeRequest>> {
  assertProjectPermission(context, 'project:read');

  const where: Prisma.ChangeRequestWhereInput = {
    projectId: context.projectId,
    ...(query.status != null ? { status: query.status } : {}),
    ...(query.requesterId != null ? { requesterId: query.requesterId } : {}),
    ...(query.search != null
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.changeRequest.count({ where }),
    db.changeRequest.findMany({
      where,
      select: CHANGE_SELECT,
      orderBy: { [query.sort]: query.direction },
      ...paginate(query),
    }),
  ]);

  return {
    data: await Promise.all(rows.map((row) => toChangeRequest(db, row))),
    meta: pageMeta(query, total),
  };
}

export async function getChangeRequest(
  db: Db,
  context: ProjectContext,
  changeRequestId: string,
): Promise<ChangeRequest> {
  assertProjectPermission(context, 'project:read');
  const row = await db.changeRequest.findFirst({
    where: { id: changeRequestId, projectId: context.projectId },
    select: CHANGE_SELECT,
  });
  if (row == null) throw notFound('That change request');
  return toChangeRequest(db, row);
}

export async function createChangeRequest(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateChangeRequestInput,
): Promise<ChangeRequest> {
  assertProjectPermission(context, 'change-request:create');
  assertProjectMutable(context);

  const requestedOn = input.requestedOn ?? today(actor.timezone);

  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: context.projectId },
      data: { changeCounter: { increment: 1 } },
      select: { changeCounter: true },
    });

    const created = await tx.changeRequest.create({
      data: {
        projectId: context.projectId,
        phaseId: input.phaseId ?? null,
        reference: `CR-${project.changeCounter}`,
        title: input.title,
        description: input.description ?? null,
        reason: input.reason ?? null,
        requesterId: actor.id,
        requestedOn: dateOnlyToDateColumn(requestedOn) as Date,
        status: 'REQUESTED',
      },
      select: CHANGE_SELECT,
    });

    await recordActivity(tx, {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'requested',
      summary: `${actor.fullName} raised the change request ${created.reference}: ${created.title}`,
      entityType: 'ChangeRequest',
      entityId: created.id,
    });

    return created;
  });

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { name: true },
  });
  const leads = await projectLeads(db, context.projectId);

  await notifyMany(
    db,
    leads,
    (userId) => ({
      userId,
      type: 'CHANGE_REQUEST_CREATED',
      title: `Change request ${row.reference}`,
      body: `${actor.fullName} raised ${row.reference} ${row.title} in ${project.name}.`,
      projectId: context.projectId,
      entityType: 'ChangeRequest',
      entityId: row.id,
      link: `/projects/${context.projectId}/change-requests/${row.id}`,
      email: {
        template: 'change-request-created',
        payload: {
          projectId: context.projectId,
          projectName: project.name,
          changeRequestId: row.id,
          reference: row.reference,
          title: row.title,
          requesterName: actor.fullName,
        },
      },
    }),
    [actor.id],
  );

  return toChangeRequest(db, row);
}

export async function analyseChangeRequest(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  changeRequestId: string,
  input: AnalyseChangeRequestInput,
): Promise<ChangeRequest> {
  assertProjectPermission(context, 'change-request:decide');
  assertProjectMutable(context);

  const existing = await db.changeRequest.findFirst({
    where: { id: changeRequestId, projectId: context.projectId },
    select: { id: true, status: true, reference: true },
  });
  if (existing == null) throw notFound('That change request');

  if (existing.status === 'APPROVED' || existing.status === 'REJECTED') {
    throw new AppError(
      ERROR_CODES.CHANGE_REQUEST_ALREADY_DECIDED,
      'This change request has already been decided.',
    );
  }

  // Only tasks in this project may be named as affected.
  const affected =
    input.affectedTaskIds.length === 0
      ? []
      : (
          await db.task.findMany({
            where: {
              id: { in: input.affectedTaskIds },
              projectId: context.projectId,
              deletedAt: null,
            },
            select: { id: true },
          })
        ).map((task) => task.id);

  const row = await db.changeRequest.update({
    where: { id: changeRequestId },
    data: {
      status: 'UNDER_REVIEW',
      scopeImpact: input.scopeImpact ?? null,
      scheduleImpactDays: input.scheduleImpactDays,
      effortImpactHours: input.effortImpactHours,
      resourceImpact: input.resourceImpact ?? null,
      costImpact: input.costImpact ?? null,
      riskImpact: input.riskImpact ?? null,
      affectedTaskIds: affected,
      analysedById: actor.id,
      analysedAt: new Date(),
    },
    select: CHANGE_SELECT,
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'change-request.analysed',
    entityType: 'ChangeRequest',
    entityId: changeRequestId,
    newValue: {
      scheduleImpactDays: input.scheduleImpactDays,
      effortImpactHours: input.effortImpactHours,
      affectedTasks: affected.length,
    },
  });

  return toChangeRequest(db, row);
}

/**
 * Approves or rejects a change request.
 *
 * An approval alone changes nothing in the plan. `applyScheduleImpact` is what moves the
 * dates, and doing so is audited task by task, so the plan change is traceable to the
 * decision that caused it.
 */
export async function decideChangeRequest(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  changeRequestId: string,
  input: DecideChangeRequestInput,
): Promise<ChangeRequest> {
  assertProjectPermission(context, 'change-request:decide');
  assertProjectMutable(context);

  const existing = await db.changeRequest.findFirst({
    where: { id: changeRequestId, projectId: context.projectId },
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      analysedAt: true,
      scheduleImpactDays: true,
      affectedTaskIds: true,
      requesterId: true,
    },
  });
  if (existing == null) throw notFound('That change request');

  if (existing.status === 'APPROVED' || existing.status === 'REJECTED') {
    throw new AppError(
      ERROR_CODES.CHANGE_REQUEST_ALREADY_DECIDED,
      'This change request has already been decided.',
    );
  }
  if (existing.analysedAt == null) {
    throw new AppError(
      ERROR_CODES.CHANGE_REQUEST_ANALYSIS_REQUIRED,
      'Record the impact analysis before approving or rejecting this change.',
    );
  }

  const shouldShift =
    input.approved && input.applyScheduleImpact && existing.scheduleImpactDays !== 0;

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data: {
        status: input.approved ? 'APPROVED' : 'REJECTED',
        approverId: actor.id,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        scheduleImpactApplied: shouldShift,
      },
      select: CHANGE_SELECT,
    });

    if (shouldShift) {
      await applyScheduleImpact(
        tx,
        context.projectId,
        existing.affectedTaskIds,
        existing.scheduleImpactDays,
        actor,
        existing.reference,
      );
    }

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: input.approved ? 'change-request.approved' : 'change-request.rejected',
        entityType: 'ChangeRequest',
        entityId: changeRequestId,
        oldValue: { status: existing.status },
        newValue: {
          status: input.approved ? 'APPROVED' : 'REJECTED',
          note: input.note ?? null,
          scheduleImpactApplied: shouldShift,
        },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: input.approved ? 'approved' : 'rejected',
        summary: `${actor.fullName} ${input.approved ? 'approved' : 'rejected'} ${existing.reference}${
          shouldShift ? `, shifting the plan by ${existing.scheduleImpactDays} day(s)` : ''
        }`,
        entityType: 'ChangeRequest',
        entityId: changeRequestId,
      },
    );

    return updated;
  });

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { name: true },
  });

  await notify(db, {
    userId: existing.requesterId,
    type: 'CHANGE_REQUEST_DECIDED',
    title: `${existing.reference} was ${input.approved ? 'approved' : 'rejected'}`,
    body: `${actor.fullName} decided on ${existing.reference} ${existing.title} in ${project.name}.`,
    projectId: context.projectId,
    entityType: 'ChangeRequest',
    entityId: changeRequestId,
    link: `/projects/${context.projectId}/change-requests/${changeRequestId}`,
    email: {
      template: 'change-request-decided',
      payload: {
        projectId: context.projectId,
        projectName: project.name,
        changeRequestId,
        reference: existing.reference,
        decision: input.approved ? 'approved' : 'rejected',
        decidedBy: actor.fullName,
        note: input.note ?? '',
      },
    },
  });

  return toChangeRequest(db, row);
}

/** Shifts the affected tasks and the project's planned end date by the agreed days. */
async function applyScheduleImpact(
  db: Db,
  projectId: string,
  taskIds: readonly string[],
  days: number,
  actor: Actor,
  reference: string,
): Promise<void> {
  const tasks = await db.task.findMany({
    where: { id: { in: [...taskIds] }, projectId, deletedAt: null },
    select: { id: true, reference: true, startDate: true, dueDate: true },
  });

  for (const task of tasks) {
    const startDate = dateColumnToDateOnly(task.startDate);
    const dueDate = dateColumnToDateOnly(task.dueDate);
    await db.task.update({
      where: { id: task.id },
      data: {
        ...(startDate != null
          ? { startDate: dateOnlyToDateColumn(addDaysTo(startDate, days)) }
          : {}),
        ...(dueDate != null ? { dueDate: dateOnlyToDateColumn(addDaysTo(dueDate, days)) } : {}),
      },
    });
    await recordAudit(db, {
      actorId: actor.id,
      projectId,
      action: 'task.rescheduled-by-change-request',
      entityType: 'Task',
      entityId: task.id,
      oldValue: { startDate, dueDate },
      newValue: {
        startDate: startDate == null ? null : addDaysTo(startDate, days),
        dueDate: dueDate == null ? null : addDaysTo(dueDate, days),
        changeRequest: reference,
      },
    });
  }

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { plannedEndDate: true },
  });
  const plannedEnd = dateColumnToDateOnly(project.plannedEndDate) as DateOnly;

  await db.project.update({
    where: { id: projectId },
    data: { plannedEndDate: dateOnlyToDateColumn(addDaysTo(plannedEnd, days)) as Date },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId,
    action: 'project.rescheduled-by-change-request',
    entityType: 'Project',
    entityId: projectId,
    oldValue: { plannedEndDate: plannedEnd },
    newValue: { plannedEndDate: addDaysTo(plannedEnd, days), changeRequest: reference },
  });
}
