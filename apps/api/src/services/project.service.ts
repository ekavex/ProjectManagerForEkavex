/**
 * Projects: the container everything else hangs from (spec section 95).
 */
import {
  DEFAULT_PHASE_TEMPLATE,
  ERROR_CODES,
  PROJECT_ROLE_PERMISSIONS,
  type AddProjectMemberInput,
  type ChangeProjectStatusInput,
  type CloseProjectInput,
  type ClosureChecklist,
  type CreateProjectInput,
  type HealthLevel,
  type ListProjectsQuery,
  type Paginated,
  type Permission,
  type ProjectDetail,
  type ProjectHealth,
  type ProjectMember,
  type ProjectStatus,
  type ProjectSummary,
  type TaskCounts,
  type UpdateProjectInput,
  type UpdateProjectMemberInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import { canPhaseStart } from '../domain/phase-gate.js';
import { isOpenIssue, isOpenRisk, riskLevelRank } from '../domain/risk.js';
import { projectHealth, scheduleMetrics, worstLevel } from '../domain/schedule.js';
import { countTasks, emptyTaskCounts } from '../domain/task-rules.js';
import {
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import {
  assertProjectMutable,
  assertProjectPermission,
  loadProjectContext,
  visibleProjectIds,
} from '../policy/project-access.js';
import { recordActivity, recordAudit, recordChange, diffValues } from './audit.service.js';
import { notify, notifyMany, projectAudience } from './notification.service.js';
import { pageMeta, paginate } from './pagination.js';
import {
  PROJECT_DETAIL_SELECT,
  PROJECT_SUMMARY_SELECT,
  toProjectDetail,
  toProjectSummary,
} from './project.mapper.js';
import { USER_SUMMARY_SELECT, toUserSummary } from './user.mapper.js';

/**
 * Status transitions.
 *
 * The map is explicit rather than "anything goes" so that a project cannot jump from
 * DRAFT straight to COMPLETED, which would leave the phase and closure records empty.
 */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['PLANNED', 'ACTIVE', 'CANCELLED'],
  PLANNED: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'AT_RISK', 'CANCELLED'],
  AT_RISK: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['ARCHIVED', 'ACTIVE'],
  CANCELLED: ['ARCHIVED', 'DRAFT'],
  ARCHIVED: ['ACTIVE', 'COMPLETED'],
};

// --------------------------------------------------------------------- list

export async function listProjects(
  db: Db,
  actor: Actor,
  query: ListProjectsQuery,
): Promise<Paginated<ProjectSummary>> {
  const visible = await visibleProjectIds(db, actor);
  const todayDate = today(actor.timezone);

  const where: Prisma.ProjectWhereInput = {
    organizationId: actor.organizationId,
    deletedAt: null,
    ...(visible == null ? {} : { id: { in: visible } }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.memberId ? { members: { some: { userId: query.memberId } } } : {}),
    ...(query.status == null && !query.includeArchived ? { status: { not: 'ARCHIVED' } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { client: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({
      where,
      select: PROJECT_SUMMARY_SELECT,
      orderBy: { [query.sort]: query.direction },
      ...paginate(query),
    }),
  ]);

  const extras = await summaryExtras(
    db,
    rows.map((row) => row.id),
    todayDate,
  );

  return {
    data: rows.map((row) =>
      toProjectSummary(row, extras.get(row.id) ?? { taskCounts: emptyTaskCounts(), health: 'OK' }),
    ),
    meta: pageMeta(query, total),
  };
}

/**
 * Task counts and a coarse health level for a page of projects, in two queries rather
 * than two per project.
 *
 * The health here is the cheap version: schedule variance, overdue and blocked counts.
 * `GET /projects/:id/health` runs the full assessment; the list only needs the colour.
 */
async function summaryExtras(
  db: Db,
  projectIds: readonly string[],
  todayDate: DateOnly,
): Promise<Map<string, { taskCounts: TaskCounts; health: HealthLevel }>> {
  const result = new Map<string, { taskCounts: TaskCounts; health: HealthLevel }>();
  if (projectIds.length === 0) return result;

  const [tasks, projects] = await Promise.all([
    db.task.findMany({
      where: { projectId: { in: [...projectIds] }, deletedAt: null },
      select: { projectId: true, status: true, dueDate: true },
    }),
    db.project.findMany({
      where: { id: { in: [...projectIds] } },
      select: { id: true, startDate: true, plannedEndDate: true, progress: true },
    }),
  ]);

  const byProject = new Map<
    string,
    { status: (typeof tasks)[number]['status']; dueDate: DateOnly | null }[]
  >();
  for (const id of projectIds) byProject.set(id, []);
  for (const task of tasks) {
    byProject.get(task.projectId)?.push({
      status: task.status,
      dueDate: dateColumnToDateOnly(task.dueDate),
    });
  }

  for (const project of projects) {
    const items = byProject.get(project.id) ?? [];
    const taskCounts = countTasks(items, todayDate);
    const schedule = scheduleMetrics({
      startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
      plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
      actualProgress: project.progress,
      todayDate,
    });

    const levels: HealthLevel[] = [
      schedule.variance <= -25 ? 'CRITICAL' : schedule.variance <= -10 ? 'ATTENTION' : 'OK',
      taskCounts.total > 0 && taskCounts.overdue / taskCounts.total >= 0.15
        ? 'CRITICAL'
        : taskCounts.overdue > 0
          ? 'ATTENTION'
          : 'OK',
      taskCounts.blocked >= 5 ? 'CRITICAL' : taskCounts.blocked > 0 ? 'ATTENTION' : 'OK',
    ];

    result.set(project.id, { taskCounts, health: worstLevel(levels) });
  }

  return result;
}

// ---------------------------------------------------------------------- read

export async function getProject(
  db: Db,
  actor: Actor,
  projectId: string,
  context?: ProjectContext,
): Promise<ProjectDetail> {
  const resolved = context ?? (await loadProjectContext(db, actor, projectId));
  const row = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: PROJECT_DETAIL_SELECT,
  });
  if (row == null) throw notFound('That project');

  const todayDate = today(actor.timezone);
  const extras = await summaryExtras(db, [projectId], todayDate);

  return toProjectDetail(row, {
    ...(extras.get(projectId) ?? { taskCounts: emptyTaskCounts(), health: 'OK' }),
    capabilities: [...resolved.permissions].filter((permission) =>
      PROJECT_CAPABILITIES.has(permission),
    ),
  });
}

/** The permissions worth telling the client about, so the UI can hide what it must. */
const PROJECT_CAPABILITIES = new Set<Permission>([
  ...PROJECT_ROLE_PERMISSIONS.LEAD,
  ...PROJECT_ROLE_PERMISSIONS.MEMBER,
  ...PROJECT_ROLE_PERMISSIONS.VIEWER,
]);

// -------------------------------------------------------------------- create

export async function createProject(
  db: RootDb,
  actor: Actor,
  input: CreateProjectInput,
): Promise<ProjectDetail> {
  const lead = await db.user.findFirst({
    where: { id: input.leadId, organizationId: actor.organizationId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });
  if (lead == null) {
    throw new AppError(
      ERROR_CODES.PROJECT_LEAD_REQUIRED,
      'Choose an active person as the project lead.',
    );
  }

  if (input.departmentId != null) {
    const found = await db.department.count({
      where: { id: input.departmentId, organizationId: actor.organizationId },
    });
    if (found === 0) throw notFound('That department');
  }

  const projectId = await db
    .$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          organizationId: actor.organizationId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          leadId: lead.id,
          createdById: actor.id,
          startDate: dateOnlyToDateColumn(input.startDate) as Date,
          plannedEndDate: dateOnlyToDateColumn(input.plannedEndDate) as Date,
          priority: input.priority,
          category: input.category ?? null,
          client: input.client ?? null,
          departmentId: input.departmentId ?? null,
          budget: input.budget ?? null,
          location: input.location ?? null,
          externalStakeholder: input.externalStakeholder ?? null,
          logoUrl: input.logoUrl ?? null,
          objectives: input.objectives,
          deliverables: input.deliverables,
          // Business rule 1: every project has a lead, and the lead is a member.
          members: {
            create: { userId: lead.id, projectRole: 'LEAD', canReadChat: true },
          },
          ...(input.useDefaultPhases
            ? {
                phases: {
                  create: DEFAULT_PHASE_TEMPLATE.map((phase, index) => ({
                    sequence: index + 1,
                    name: phase.name,
                    description: phase.description,
                  })),
                },
              }
            : {}),
        },
        select: { id: true, code: true, name: true, plannedEndDate: true },
      });

      await recordChange(
        tx,
        {
          actorId: actor.id,
          projectId: project.id,
          action: 'project.created',
          entityType: 'Project',
          entityId: project.id,
          newValue: { code: project.code, name: project.name, leadId: lead.id },
        },
        {
          projectId: project.id,
          actorId: actor.id,
          verb: 'created',
          summary: `${actor.fullName} created the project`,
          entityType: 'Project',
          entityId: project.id,
        },
      );

      return project;
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error, 'code')) {
        throw new AppError(
          ERROR_CODES.PROJECT_CODE_TAKEN,
          `Project code ${input.code} is already in use.`,
        );
      }
      throw error;
    });

  if (lead.id !== actor.id) {
    await notify(db, {
      userId: lead.id,
      type: 'PROJECT_ASSIGNED',
      title: `You are leading ${projectId.name}`,
      body: `${actor.fullName} made you the lead of ${projectId.code} ${projectId.name}.`,
      projectId: projectId.id,
      entityType: 'Project',
      entityId: projectId.id,
      link: `/projects/${projectId.id}`,
      email: {
        template: 'project-assigned',
        payload: {
          projectId: projectId.id,
          projectCode: projectId.code,
          projectName: projectId.name,
          plannedEndDate: dateColumnToDateOnly(projectId.plannedEndDate) ?? '',
          assignedBy: actor.fullName,
        },
      },
    });
  }

  return getProject(db, actor, projectId.id);
}

// -------------------------------------------------------------------- update

export async function updateProject(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: UpdateProjectInput,
): Promise<ProjectDetail> {
  assertProjectPermission(context, 'project:update');
  assertProjectMutable(context);

  const existing = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: {
      name: true,
      description: true,
      leadId: true,
      startDate: true,
      plannedEndDate: true,
      priority: true,
      category: true,
      client: true,
      departmentId: true,
      budget: true,
      location: true,
      externalStakeholder: true,
      logoUrl: true,
      objectives: true,
      deliverables: true,
    },
  });

  // Changing the lead is a real event, not a field edit: the new lead joins the project
  // and is told about it.
  let newLead: { id: string; fullName: string } | null = null;
  if (input.leadId != null && input.leadId !== existing.leadId) {
    newLead = await db.user.findFirst({
      where: { id: input.leadId, organizationId: actor.organizationId, status: 'ACTIVE' },
      select: { id: true, fullName: true },
    });
    if (newLead == null) {
      throw new AppError(
        ERROR_CODES.PROJECT_LEAD_REQUIRED,
        'Choose an active person as the project lead.',
      );
    }
  }

  const startDate = input.startDate ?? dateColumnToDateOnly(existing.startDate);
  const plannedEndDate = input.plannedEndDate ?? dateColumnToDateOnly(existing.plannedEndDate);
  if (startDate != null && plannedEndDate != null && plannedEndDate < startDate) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'The planned completion date cannot be before the start date.',
      { details: [{ path: 'plannedEndDate', message: 'Must not be before the start date.' }] },
    );
  }

  const data: Prisma.ProjectUncheckedUpdateInput = {
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(newLead != null ? { leadId: newLead.id } : {}),
    ...(input.startDate != null
      ? { startDate: dateOnlyToDateColumn(input.startDate) as Date }
      : {}),
    ...(input.plannedEndDate != null
      ? { plannedEndDate: dateOnlyToDateColumn(input.plannedEndDate) as Date }
      : {}),
    ...(input.actualEndDate !== undefined
      ? { actualEndDate: dateOnlyToDateColumn(input.actualEndDate ?? null) }
      : {}),
    ...(input.priority != null ? { priority: input.priority } : {}),
    ...(input.category !== undefined ? { category: input.category ?? null } : {}),
    ...(input.client !== undefined ? { client: input.client ?? null } : {}),
    ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
    ...(input.budget !== undefined ? { budget: input.budget ?? null } : {}),
    ...(input.location !== undefined ? { location: input.location ?? null } : {}),
    ...(input.externalStakeholder !== undefined
      ? { externalStakeholder: input.externalStakeholder ?? null }
      : {}),
    ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl ?? null } : {}),
    ...(input.objectives != null ? { objectives: input.objectives } : {}),
    ...(input.deliverables != null ? { deliverables: input.deliverables } : {}),
  };

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: context.projectId }, data });

    if (newLead != null) {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: context.projectId, userId: newLead.id } },
        create: {
          projectId: context.projectId,
          userId: newLead.id,
          projectRole: 'LEAD',
          canReadChat: true,
        },
        update: { projectRole: 'LEAD', canReadChat: true },
      });
      await recordActivity(tx, {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'assigned',
        summary: `${actor.fullName} made ${newLead.fullName} the project lead`,
        entityType: 'Project',
        entityId: context.projectId,
      });
    }

    const diff = diffValues(
      existing as Record<string, unknown>,
      {
        ...input,
        ...(newLead != null ? { leadId: newLead.id } : {}),
      } as Record<string, unknown>,
    );

    if (diff != null) {
      await recordAudit(tx, {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'project.updated',
        entityType: 'Project',
        entityId: context.projectId,
        oldValue: diff.old,
        newValue: diff.new,
      });
    }
  });

  if (newLead != null && newLead.id !== actor.id) {
    const project = await db.project.findUniqueOrThrow({
      where: { id: context.projectId },
      select: { code: true, name: true, plannedEndDate: true },
    });
    await notify(db, {
      userId: newLead.id,
      type: 'PROJECT_ASSIGNED',
      title: `You are leading ${project.name}`,
      body: `${actor.fullName} made you the lead of ${project.code} ${project.name}.`,
      projectId: context.projectId,
      entityType: 'Project',
      entityId: context.projectId,
      link: `/projects/${context.projectId}`,
      email: {
        template: 'project-assigned',
        payload: {
          projectId: context.projectId,
          projectCode: project.code,
          projectName: project.name,
          plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) ?? '',
          assignedBy: actor.fullName,
        },
      },
    });
  }

  return getProject(db, actor, context.projectId, context);
}

// -------------------------------------------------------------------- status

export async function changeProjectStatus(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: ChangeProjectStatusInput,
): Promise<ProjectDetail> {
  assertProjectPermission(context, 'project:update');

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { status: true, leadId: true, actualStartDate: true },
  });

  if (project.status === input.status) {
    return getProject(db, actor, context.projectId, context);
  }

  const allowed = ALLOWED_TRANSITIONS[project.status];
  if (!allowed.includes(input.status)) {
    throw new AppError(
      ERROR_CODES.PROJECT_STATUS_TRANSITION_INVALID,
      `A ${label(project.status)} project cannot become ${label(input.status)}. Allowed: ${allowed
        .map(label)
        .join(', ')}.`,
    );
  }

  // Business rule 2: a project cannot become active without a lead.
  if (input.status === 'ACTIVE' && project.leadId == null) {
    throw new AppError(
      ERROR_CODES.PROJECT_LEAD_REQUIRED,
      'Assign a project lead before making this project active.',
    );
  }

  const nowDate = today(actor.timezone);

  await db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: context.projectId },
      data: {
        status: input.status,
        ...(input.status === 'ACTIVE' && project.actualStartDate == null
          ? { actualStartDate: dateOnlyToDateColumn(nowDate) }
          : {}),
        ...(input.status === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
        ...(project.status === 'ARCHIVED' && input.status !== 'ARCHIVED'
          ? { archivedAt: null }
          : {}),
      },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'project.status-changed',
        entityType: 'Project',
        entityId: context.projectId,
        oldValue: { status: project.status },
        newValue: { status: input.status, reason: input.reason ?? null },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'changed status',
        summary: `${actor.fullName} moved the project to ${label(input.status)}${
          input.reason ? `: ${input.reason}` : ''
        }`,
        entityType: 'Project',
        entityId: context.projectId,
      },
    );
  });

  return getProject(db, actor, context.projectId, context);
}

function label(status: ProjectStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

// ------------------------------------------------------------------- members

export async function listMembers(db: Db, projectId: string): Promise<ProjectMember[]> {
  const [members, taskRows] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId },
      orderBy: [{ projectRole: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        projectRole: true,
        responsibility: true,
        canReadChat: true,
        allocationPercent: true,
        createdAt: true,
        user: { select: USER_SUMMARY_SELECT },
      },
    }),
    db.taskAssignment.findMany({
      where: { task: { projectId, deletedAt: null } },
      select: { userId: true, task: { select: { status: true, progress: true } } },
    }),
  ]);

  const stats = new Map<string, { total: number; completed: number; progressSum: number }>();
  for (const row of taskRows) {
    const entry = stats.get(row.userId) ?? { total: 0, completed: 0, progressSum: 0 };
    if (row.task.status !== 'CANCELLED') {
      entry.total += 1;
      entry.progressSum += row.task.status === 'COMPLETED' ? 100 : row.task.progress;
      if (row.task.status === 'COMPLETED') entry.completed += 1;
    }
    stats.set(row.userId, entry);
  }

  return members.map((member) => {
    const entry = stats.get(member.user.id);
    return {
      id: member.id,
      user: toUserSummary(member.user),
      projectRole: member.projectRole,
      responsibility: member.responsibility,
      canReadChat: member.canReadChat,
      allocationPercent: member.allocationPercent,
      assignedTasks: entry?.total ?? 0,
      completedTasks: entry?.completed ?? 0,
      progress:
        entry == null || entry.total === 0 ? 0 : Math.round(entry.progressSum / entry.total),
      joinedAt: member.createdAt.toISOString(),
    };
  });
}

export async function addMember(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: AddProjectMemberInput,
): Promise<ProjectMember[]> {
  assertProjectPermission(context, 'member:add');
  assertProjectMutable(context);

  const user = await db.user.findFirst({
    where: { id: input.userId, organizationId: actor.organizationId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });
  if (user == null) throw notFound('That person');

  const existing = await db.projectMember.count({
    where: { projectId: context.projectId, userId: input.userId },
  });
  if (existing > 0) {
    throw new AppError(
      ERROR_CODES.MEMBER_ALREADY_ADDED,
      `${user.fullName} is already on this project.`,
    );
  }

  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { code: true, name: true },
  });

  await db.$transaction(async (tx) => {
    await tx.projectMember.create({
      data: {
        projectId: context.projectId,
        userId: input.userId,
        projectRole: input.projectRole,
        responsibility: input.responsibility ?? null,
        canReadChat: input.projectRole === 'VIEWER' ? input.canReadChat : true,
        allocationPercent: input.allocationPercent,
      },
    });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'project.member-added',
        entityType: 'ProjectMember',
        entityId: input.userId,
        newValue: { userId: input.userId, projectRole: input.projectRole },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'added',
        summary: `${actor.fullName} added ${user.fullName} to the project`,
        entityType: 'ProjectMember',
        entityId: input.userId,
      },
    );
  });

  if (user.id !== actor.id) {
    await notify(db, {
      userId: user.id,
      type: 'PROJECT_MEMBER_ADDED',
      title: `You were added to ${project.name}`,
      body: `${actor.fullName} added you to ${project.code} ${project.name}.`,
      projectId: context.projectId,
      entityType: 'Project',
      entityId: context.projectId,
      link: `/projects/${context.projectId}`,
      email: {
        template: 'project-member-added',
        payload: {
          projectId: context.projectId,
          projectName: project.name,
          addedBy: actor.fullName,
          projectRole: input.projectRole.toLowerCase(),
        },
      },
    });
  }

  return listMembers(db, context.projectId);
}

export async function updateMember(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  userId: string,
  input: UpdateProjectMemberInput,
): Promise<ProjectMember[]> {
  assertProjectPermission(context, 'member:update');
  assertProjectMutable(context);

  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: context.projectId, userId } },
    select: { id: true, projectRole: true },
  });
  if (member == null) throw notFound('That project member');

  // Demoting the project lead would leave the project without one (business rule 1).
  if (context.leadId === userId && input.projectRole != null && input.projectRole !== 'LEAD') {
    throw new AppError(
      ERROR_CODES.MEMBER_IS_LEAD,
      'This person is the project lead. Assign a different lead before changing their role.',
    );
  }

  await db.projectMember.update({
    where: { id: member.id },
    data: {
      ...(input.projectRole != null ? { projectRole: input.projectRole } : {}),
      ...(input.responsibility !== undefined
        ? { responsibility: input.responsibility ?? null }
        : {}),
      ...(input.canReadChat != null ? { canReadChat: input.canReadChat } : {}),
      ...(input.allocationPercent != null ? { allocationPercent: input.allocationPercent } : {}),
    },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'project.member-updated',
    entityType: 'ProjectMember',
    entityId: userId,
    oldValue: { projectRole: member.projectRole },
    newValue: { projectRole: input.projectRole ?? member.projectRole },
  });

  return listMembers(db, context.projectId);
}

export async function removeMember(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  userId: string,
): Promise<ProjectMember[]> {
  assertProjectPermission(context, 'member:remove');
  assertProjectMutable(context);

  if (context.leadId === userId) {
    throw new AppError(
      ERROR_CODES.MEMBER_IS_LEAD,
      'This person is the project lead. Assign a different lead before removing them.',
    );
  }

  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: context.projectId, userId } },
    select: { id: true, user: { select: { fullName: true } } },
  });
  if (member == null) throw notFound('That project member');

  const openTasks = await db.taskAssignment.count({
    where: {
      userId,
      task: {
        projectId: context.projectId,
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    },
  });

  await db.$transaction(async (tx) => {
    // Their assignments go with them; the tasks themselves stay, unassigned, so the work
    // is visible rather than vanishing with the person.
    await tx.taskAssignment.deleteMany({
      where: { userId, task: { projectId: context.projectId } },
    });
    await tx.projectMember.delete({ where: { id: member.id } });

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'project.member-removed',
        entityType: 'ProjectMember',
        entityId: userId,
        oldValue: { userId, openTasksUnassigned: openTasks },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'removed',
        summary:
          openTasks > 0
            ? `${actor.fullName} removed ${member.user.fullName}, leaving ${openTasks} task(s) unassigned`
            : `${actor.fullName} removed ${member.user.fullName} from the project`,
        entityType: 'ProjectMember',
        entityId: userId,
      },
    );
  });

  return listMembers(db, context.projectId);
}

// -------------------------------------------------------------------- health

export async function getProjectHealth(
  db: Db,
  actor: Actor,
  projectId: string,
): Promise<ProjectHealth> {
  const todayDate = today(actor.timezone);

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { startDate: true, plannedEndDate: true, progress: true },
  });

  const [tasks, phases, risks, issues, dependencies] = await Promise.all([
    db.task.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, status: true, dueDate: true },
    }),
    db.phase.findMany({
      where: { projectId },
      select: {
        id: true,
        sequence: true,
        name: true,
        status: true,
        approvalRequired: true,
        gateStatus: true,
        plannedEnd: true,
      },
    }),
    db.risk.findMany({ where: { projectId }, select: { status: true, severity: true } }),
    db.issue.findMany({ where: { projectId }, select: { status: true } }),
    db.taskDependency.findMany({
      where: { projectId, type: 'FINISH_TO_START' },
      select: {
        predecessor: { select: { status: true } },
        successor: { select: { status: true } },
      },
    }),
  ]);

  const counts = countTasks(
    tasks.map((task) => ({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) })),
    todayDate,
  );

  const violated = dependencies.filter(
    (dependency) =>
      dependency.predecessor.status !== 'COMPLETED' &&
      dependency.predecessor.status !== 'CANCELLED' &&
      dependency.successor.status !== 'NOT_STARTED' &&
      dependency.successor.status !== 'CANCELLED',
  ).length;

  const overdueGates = phases.filter((phase) => {
    if (!phase.approvalRequired) return false;
    if (phase.gateStatus === 'APPROVED') return false;
    const plannedEnd = dateColumnToDateOnly(phase.plannedEnd);
    return plannedEnd != null && plannedEnd < todayDate;
  }).length;

  return projectHealth({
    schedule: scheduleMetrics({
      startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
      plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
      actualProgress: project.progress,
      todayDate,
    }),
    taskTotal: counts.total,
    overdueTasks: counts.overdue,
    blockedTasks: counts.blocked,
    violatedDependencies: violated,
    overdueGates,
    openHighRisks: risks.filter(
      (risk) => isOpenRisk(risk.status) && riskLevelRank(risk.severity) >= 3,
    ).length,
    openIssues: issues.filter((issue) => isOpenIssue(issue.status)).length,
  });
}

// ------------------------------------------------------------------- closure

/**
 * The closure checklist (spec section 82).
 *
 * Every item is derived from real project data, so "deliverables completed" means the
 * deliverables really are recorded, not that somebody ticked a box.
 */
export async function getClosureChecklist(db: Db, projectId: string): Promise<ClosureChecklist> {
  const [project, openTasks, openIssues, openRisks, openChanges, finalDocs, phases, lessons] =
    await Promise.all([
      db.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { deliverables: true, handoverNote: true },
      }),
      db.task.count({
        where: { projectId, deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      }),
      db.issue.count({ where: { projectId, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      db.risk.count({ where: { projectId, status: { in: ['OPEN', 'MONITORING', 'OCCURRED'] } } }),
      db.changeRequest.count({
        where: {
          projectId,
          status: { in: ['REQUESTED', 'IMPACT_ANALYSIS', 'UNDER_REVIEW'] },
        },
      }),
      db.document.count({
        where: { projectId, deletedAt: null, category: 'FINAL_DELIVERABLES' },
      }),
      db.phase.findMany({
        where: { projectId, status: { notIn: ['COMPLETED', 'APPROVED', 'CANCELLED'] } },
        select: { name: true },
      }),
      db.projectLesson.count({ where: { projectId } }),
    ]);

  const items: ClosureChecklist['items'] = [
    {
      key: 'TASKS',
      label: 'All tasks completed or cancelled',
      satisfied: openTasks === 0,
      detail: openTasks === 0 ? 'No outstanding tasks.' : `${openTasks} task(s) still open.`,
    },
    {
      key: 'PHASES',
      label: 'All phases finished',
      satisfied: phases.length === 0,
      detail:
        phases.length === 0
          ? 'Every phase is completed, approved or cancelled.'
          : `Still open: ${phases.map((phase) => phase.name).join(', ')}.`,
    },
    {
      key: 'DELIVERABLES',
      label: 'Final deliverables recorded',
      satisfied: finalDocs > 0 || project.deliverables.length === 0,
      detail:
        finalDocs > 0
          ? `${finalDocs} document(s) filed under Final deliverables.`
          : 'No documents are filed under Final deliverables.',
    },
    {
      key: 'ISSUES',
      label: 'Open issues resolved',
      satisfied: openIssues === 0,
      detail: openIssues === 0 ? 'No open issues.' : `${openIssues} issue(s) still open.`,
    },
    {
      key: 'RISKS',
      label: 'Outstanding risks reviewed',
      satisfied: openRisks === 0,
      detail:
        openRisks === 0
          ? 'No risks left open.'
          : `${openRisks} risk(s) still open or being monitored.`,
    },
    {
      key: 'CHANGES',
      label: 'Change requests closed',
      satisfied: openChanges === 0,
      detail:
        openChanges === 0
          ? 'No change requests awaiting a decision.'
          : `${openChanges} change request(s) awaiting a decision.`,
    },
    {
      key: 'HANDOVER',
      label: 'Handover note written',
      satisfied: project.handoverNote != null && project.handoverNote.length > 0,
      detail:
        project.handoverNote != null && project.handoverNote.length > 0
          ? 'A handover note is recorded.'
          : 'No handover note yet.',
    },
    {
      key: 'LESSONS',
      label: 'Lessons learned recorded',
      satisfied: lessons > 0,
      detail: lessons > 0 ? `${lessons} lesson(s) recorded.` : 'No lessons recorded yet.',
    },
  ];

  return { items, canClose: items.every((item) => item.satisfied) };
}

export async function closeProject(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CloseProjectInput,
): Promise<ProjectDetail> {
  assertProjectPermission(context, 'project:close');
  assertProjectMutable(context);

  // The note is part of the checklist, so it is saved before the checklist is evaluated.
  if (input.handoverNote != null) {
    await db.project.update({
      where: { id: context.projectId },
      data: { handoverNote: input.handoverNote },
    });
  }
  if (input.lessons.length > 0) {
    await db.projectLesson.createMany({
      data: input.lessons.map((lesson) => ({
        projectId: context.projectId,
        category: lesson.category,
        note: lesson.note,
        authorId: actor.id,
      })),
    });
  }

  const checklist = await getClosureChecklist(db, context.projectId);
  const unmet = checklist.items.filter((item) => !item.satisfied);

  if (unmet.length > 0 && !input.acknowledgeOpenItems) {
    throw new AppError(
      ERROR_CODES.PROJECT_CLOSURE_INCOMPLETE,
      `This project is not ready to close: ${unmet.map((item) => item.label.toLowerCase()).join('; ')}.`,
      {
        details: unmet.map((item) => ({ path: item.key, message: item.detail })),
      },
    );
  }

  const nowDate = today(actor.timezone);

  await db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: context.projectId },
      data: {
        status: 'COMPLETED',
        closedAt: new Date(),
        actualEndDate: dateOnlyToDateColumn(nowDate),
      },
    });
    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'project.closed',
        entityType: 'Project',
        entityId: context.projectId,
        newValue: {
          acknowledgedOpenItems: unmet.map((item) => item.key),
          closedOn: nowDate,
        },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'closed',
        summary: `${actor.fullName} closed the project`,
        entityType: 'Project',
        entityId: context.projectId,
      },
    );
  });

  const audience = await projectAudience(db, context.projectId, { includeViewers: true });
  const project = await db.project.findUniqueOrThrow({
    where: { id: context.projectId },
    select: { name: true, code: true },
  });
  await notifyMany(
    db,
    audience,
    (userId) => ({
      userId,
      type: 'PROJECT_ASSIGNED',
      title: `${project.name} is complete`,
      body: `${actor.fullName} closed ${project.code} ${project.name}.`,
      projectId: context.projectId,
      entityType: 'Project',
      entityId: context.projectId,
      link: `/projects/${context.projectId}`,
    }),
    [actor.id],
  );

  return getProject(db, actor, context.projectId, context);
}

// -------------------------------------------------------------------- delete

/**
 * Soft-deletes a project. Administrators only, and the row is retained so the audit trail
 * keeps its references (decision D-010).
 */
export async function deleteProject(db: Db, actor: Actor, projectId: string): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: actor.organizationId, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (project == null) throw notFound('That project');

  await db.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId,
    action: 'project.deleted',
    entityType: 'Project',
    entityId: projectId,
    oldValue: { code: project.code, name: project.name },
  });
}

/** Whether a phase may start, for every phase in the project. */
export async function phaseStartability(
  db: Db,
  projectId: string,
): Promise<Map<string, { canStart: boolean; reason: string | null }>> {
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      status: true,
      approvalRequired: true,
      gateStatus: true,
    },
  });

  const result = new Map<string, { canStart: boolean; reason: string | null }>();
  for (const phase of phases) {
    result.set(phase.id, canPhaseStart(phase, phases));
  }
  return result;
}
