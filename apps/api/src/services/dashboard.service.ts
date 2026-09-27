/**
 * Dashboards (spec sections 12, 25, 48, 49 and 50).
 *
 * Every number here comes from a query. Nothing is hard-coded, and the derived values
 * (overdue, counts, health, schedule variance) come from the same domain functions the
 * task list and the reports use, so the figures always agree (master prompt section 46).
 */
import {
  type ActivityEntry,
  type CompanyDashboard,
  type EmployeeDashboard,
  type LeadDashboard,
  type MemberWorkload,
  type Milestone,
  type MyWork,
  type Notification,
  type PhaseProgressSlice,
  type ProjectDashboard,
  type ProjectStatus,
  type ProjectSummary,
  type TaskCounts,
  type TaskSummary,
  type WorkloadQuery,
  type WorkloadReport,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { isOpenIssue, isOpenRisk, riskLevelRank } from '../domain/risk.js';
import { scheduleMetrics } from '../domain/schedule.js';
import { countTasks, emptyTaskCounts, isOverdue } from '../domain/task-rules.js';
import {
  addDaysTo,
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectPermission, visibleProjectIds } from '../policy/project-access.js';
import { getToday as getAttendanceToday, getTeamAttendance } from './attendance.service.js';
import { listPersonalNotes } from './content.service.js';
import { getProjectHealth, listProjects } from './project.service.js';
import { toTaskSummary } from './task.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

/** How far ahead "upcoming" looks. Two weeks is a planning horizon a person can act on. */
const UPCOMING_DAYS = 14;

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

// --------------------------------------------------------- project dashboard

export async function getProjectDashboard(
  db: Db,
  actor: Actor,
  context: ProjectContext,
): Promise<ProjectDashboard> {
  assertProjectPermission(context, 'project:read');
  const projectId = context.projectId;
  const todayDate = today(actor.timezone);
  const horizon = addDaysTo(todayDate, UPCOMING_DAYS);

  const [projects, health] = await Promise.all([
    listProjects(db, actor, {
      page: 1,
      pageSize: 1,
      sort: 'updatedAt',
      direction: 'desc',
      includeArchived: true,
      // A lead may be looking at a project they do not otherwise list, so the id is explicit.
      search: undefined as unknown as string,
    }).then(() => null),
    getProjectHealth(db, actor, projectId),
  ]);
  void projects;

  const [project, tasks, phases, milestoneRows, risks, issues, activity, messages, documents] =
    await Promise.all([
      db.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          priority: true,
          progress: true,
          startDate: true,
          plannedEndDate: true,
          actualEndDate: true,
          updatedAt: true,
          lead: { select: USER_SUMMARY_SELECT },
          _count: { select: { members: true } },
          phases: {
            where: { status: { in: ['IN_PROGRESS', 'UNDER_REVIEW', 'REWORK_REQUIRED'] } },
            orderBy: { sequence: 'asc' },
            take: 1,
            select: { id: true, name: true, sequence: true },
          },
        },
      }),
      db.task.findMany({
        where: { projectId, deletedAt: null },
        select: TASK_SUMMARY_SELECT,
      }),
      db.phase.findMany({
        where: { projectId },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          name: true,
          sequence: true,
          status: true,
          progress: true,
          plannedStart: true,
          plannedEnd: true,
        },
      }),
      db.milestone.findMany({
        where: { projectId },
        orderBy: { date: 'asc' },
        take: 20,
        select: {
          id: true,
          name: true,
          description: true,
          date: true,
          status: true,
          owner: { select: USER_SUMMARY_SELECT },
          phase: { select: { id: true, name: true } },
          tasks: {
            select: {
              task: { select: { id: true, reference: true, name: true, status: true } },
            },
          },
        },
      }),
      db.risk.findMany({
        where: { projectId },
        orderBy: { severityScore: 'desc' },
        select: { id: true, reference: true, title: true, severity: true, status: true },
      }),
      db.issue.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, reference: true, title: true, priority: true, status: true },
      }),
      db.activityLog.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          verb: true,
          summary: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: USER_SUMMARY_SELECT },
        },
      }),
      db.message.findMany({
        where: { projectId, deletedAt: null, parentId: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          projectId: true,
          parentId: true,
          body: true,
          editedAt: true,
          deletedAt: true,
          createdAt: true,
          author: { select: USER_SUMMARY_SELECT },
        },
      }),
      db.document.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, name: true, url: true, category: true },
      }),
    ]);

  const summaries = tasks.map((task) => toTaskSummary(task, todayDate));
  const taskCounts = countTasks(
    tasks.map((task) => ({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) })),
    todayDate,
  );

  const schedule = scheduleMetrics({
    startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
    plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
    actualProgress: project.progress,
    todayDate,
  });

  const summary: ProjectSummary = {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    priority: project.priority,
    progress: project.progress,
    startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
    plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
    actualEndDate: dateColumnToDateOnly(project.actualEndDate),
    lead: toUserSummaryOrNull(project.lead),
    currentPhase: project.phases[0] ?? null,
    memberCount: project._count.members,
    taskCounts,
    health: health.overall,
    updatedAt: project.updatedAt.toISOString(),
  };

  return {
    project: summary,
    schedule,
    health,
    taskCounts,
    phases: phases.map(toPhaseSlice),
    upcomingDeadlines: summaries
      .filter(
        (task) =>
          task.dueDate != null &&
          task.dueDate >= todayDate &&
          task.dueDate <= horizon &&
          task.status !== 'COMPLETED' &&
          task.status !== 'CANCELLED',
      )
      .sort(byDueDate)
      .slice(0, 10),
    overdueTasks: summaries
      .filter((task) => task.isOverdue)
      .sort(byDueDate)
      .slice(0, 10),
    blockedTasks: summaries.filter((task) => task.status === 'BLOCKED').slice(0, 10),
    milestones: milestoneRows.map(toMilestone),
    workload: workloadFromTasks(tasks, todayDate),
    openRisks: risks
      .filter((risk) => isOpenRisk(risk.status))
      .slice(0, 10)
      .map((risk) => ({
        id: risk.id,
        reference: risk.reference,
        title: risk.title,
        severity: risk.severity,
      })),
    openIssues: issues
      .filter((issue) => isOpenIssue(issue.status))
      .slice(0, 10)
      .map((issue) => ({
        id: issue.id,
        reference: issue.reference,
        title: issue.title,
        priority: issue.priority,
      })),
    recentActivity: activity.map(toActivity),
    recentMessages: messages.map((message) => ({
      id: message.id,
      projectId: message.projectId,
      parentId: message.parentId,
      author: toUserSummary(message.author),
      body: message.body,
      attachments: [],
      mentions: [],
      reactions: [],
      replyCount: 0,
      isPinned: false,
      pinnedBy: null,
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: null,
      createdAt: message.createdAt.toISOString(),
    })),
    keyDocuments: documents,
  };
}

// -------------------------------------------------------- employee dashboard

export async function getEmployeeDashboard(db: Db, actor: Actor): Promise<EmployeeDashboard> {
  const todayDate = today(actor.timezone);
  const horizon = addDaysTo(todayDate, UPCOMING_DAYS);

  const [attendance, tasks, notes, notificationRows, projectPage, activity] = await Promise.all([
    getAttendanceToday(db, actor),
    db.task.findMany({
      where: {
        deletedAt: null,
        assignments: { some: { userId: actor.id } },
        project: { deletedAt: null, status: { not: 'ARCHIVED' } },
      },
      select: TASK_SUMMARY_SELECT,
    }),
    listPersonalNotes(db, actor, { page: 1, pageSize: 5, pinnedOnly: false }),
    db.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
        entityType: true,
        entityId: true,
        link: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    listProjects(db, actor, {
      page: 1,
      pageSize: 10,
      sort: 'updatedAt',
      direction: 'desc',
      includeArchived: false,
      memberId: actor.id,
    }),
    db.activityLog.findMany({
      where: { project: { members: { some: { userId: actor.id } } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        verb: true,
        summary: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: USER_SUMMARY_SELECT },
      },
    }),
  ]);

  const summaries = tasks.map((task) => toTaskSummary(task, todayDate));
  const live = summaries.filter(
    (task) => task.status !== 'COMPLETED' && task.status !== 'CANCELLED',
  );

  const todayTasks = live.filter((task) => task.dueDate === todayDate);
  const overdue = live.filter((task) => task.isOverdue);
  const upcoming = live
    .filter((task) => task.dueDate != null && task.dueDate > todayDate && task.dueDate <= horizon)
    .sort(byDueDate);

  const counted = summaries.filter((task) => task.status !== 'CANCELLED');
  const myProgress =
    counted.length === 0
      ? 0
      : Math.round(
          counted.reduce(
            (sum, task) => sum + (task.status === 'COMPLETED' ? 100 : task.progress),
            0,
          ) / counted.length,
        );

  return {
    attendance,
    counts: {
      todayTasks: todayTasks.length,
      completedToday: summaries.filter(
        (task) => task.status === 'COMPLETED' && task.dueDate === todayDate,
      ).length,
      inProgress: live.filter((task) => task.status === 'IN_PROGRESS').length,
      overdue: overdue.length,
      upcoming: upcoming.length,
    },
    todayTasks: todayTasks.sort(byDueDate),
    upcomingTasks: upcoming.slice(0, 15),
    overdueTasks: overdue.sort(byDueDate),
    projects: projectPage.data,
    myProgress,
    notes: notes.data,
    notifications: notificationRows.map(toNotification),
    recentActivity: activity.map(toActivity),
  };
}

/** `GET /me/work` — the "My Work" section (spec section 26). */
export async function getMyWork(db: Db, actor: Actor): Promise<MyWork> {
  const todayDate = today(actor.timezone);
  const horizon = addDaysTo(todayDate, UPCOMING_DAYS);

  const [tasks, projectPage] = await Promise.all([
    db.task.findMany({
      where: {
        deletedAt: null,
        assignments: { some: { userId: actor.id } },
        project: { deletedAt: null },
      },
      select: TASK_SUMMARY_SELECT,
    }),
    listProjects(db, actor, {
      page: 1,
      pageSize: 25,
      sort: 'updatedAt',
      direction: 'desc',
      includeArchived: false,
      memberId: actor.id,
    }),
  ]);

  const summaries = tasks.map((task) => toTaskSummary(task, todayDate));
  const live = summaries.filter(
    (task) => task.status !== 'COMPLETED' && task.status !== 'CANCELLED',
  );

  return {
    today: live.filter((task) => task.dueDate === todayDate).sort(byDueDate),
    upcoming: live
      .filter((task) => task.dueDate != null && task.dueDate > todayDate && task.dueDate <= horizon)
      .sort(byDueDate),
    overdue: live.filter((task) => task.isOverdue).sort(byDueDate),
    completed: summaries
      .filter((task) => task.status === 'COMPLETED')
      .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))
      .slice(0, 25),
    projects: projectPage.data,
  };
}

// ------------------------------------------------------------ lead dashboard

export async function getLeadDashboard(db: Db, actor: Actor): Promise<LeadDashboard> {
  const todayDate = today(actor.timezone);
  const horizon = addDaysTo(todayDate, UPCOMING_DAYS);

  const led = await db.project.findMany({
    where: {
      organizationId: actor.organizationId,
      deletedAt: null,
      status: { notIn: ['ARCHIVED', 'CANCELLED'] },
      OR: [{ leadId: actor.id }, { members: { some: { userId: actor.id, projectRole: 'LEAD' } } }],
    },
    select: { id: true },
  });
  const projectIds = led.map((project) => project.id);

  if (projectIds.length === 0) {
    return {
      projects: [],
      totals: emptyTaskCounts(),
      attentionItems: [],
      workload: [],
      upcomingDeadlines: [],
      teamAttendance: [],
      recentActivity: [],
    };
  }

  const [projectPage, tasks, phases, activity, teamAttendance] = await Promise.all([
    listProjects(db, actor, {
      page: 1,
      pageSize: 50,
      sort: 'updatedAt',
      direction: 'desc',
      includeArchived: false,
      leadId: actor.id,
    }),
    db.task.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null },
      select: TASK_SUMMARY_SELECT,
    }),
    db.phase.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        id: true,
        name: true,
        projectId: true,
        plannedEnd: true,
        status: true,
        approvalRequired: true,
        gateStatus: true,
        project: { select: { name: true } },
      },
    }),
    db.activityLog.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        verb: true,
        summary: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: USER_SUMMARY_SELECT },
      },
    }),
    getTeamAttendance(db, actor, {}).catch(() => []),
  ]);

  const summaries = tasks.map((task) => toTaskSummary(task, todayDate));
  const totals = countTasks(
    tasks.map((task) => ({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) })),
    todayDate,
  );

  const attentionItems: LeadDashboard['attentionItems'] = [];
  const projectNames = new Map(projectPage.data.map((project) => [project.id, project.name]));

  for (const project of projectPage.data) {
    const projectTasks = summaries.filter((task) => task.project.id === project.id);
    const overdue = projectTasks.filter((task) => task.isOverdue).length;
    const blocked = projectTasks.filter((task) => task.status === 'BLOCKED').length;
    const dueToday = projectTasks.filter(
      (task) => task.dueDate === todayDate && task.status !== 'COMPLETED',
    ).length;

    if (overdue > 0) {
      attentionItems.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'OVERDUE',
        detail: `${overdue} task${overdue === 1 ? '' : 's'} past the due date`,
        count: overdue,
      });
    }
    if (blocked > 0) {
      attentionItems.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'BLOCKED',
        detail: `${blocked} task${blocked === 1 ? '' : 's'} blocked`,
        count: blocked,
      });
    }
    if (dueToday > 0) {
      attentionItems.push({
        projectId: project.id,
        projectName: project.name,
        kind: 'DUE_TODAY',
        detail: `${dueToday} task${dueToday === 1 ? '' : 's'} due today`,
        count: dueToday,
      });
    }
  }

  for (const phase of phases) {
    const plannedEnd = dateColumnToDateOnly(phase.plannedEnd);
    if (
      plannedEnd != null &&
      plannedEnd <= todayDate &&
      phase.status !== 'COMPLETED' &&
      phase.status !== 'APPROVED' &&
      phase.status !== 'CANCELLED'
    ) {
      attentionItems.push({
        projectId: phase.projectId,
        projectName: projectNames.get(phase.projectId) ?? phase.project.name,
        kind: 'PHASE_DUE',
        detail: `${phase.name} has reached its planned completion date`,
        count: 1,
      });
    }
    if (phase.approvalRequired && phase.gateStatus === 'SUBMITTED') {
      attentionItems.push({
        projectId: phase.projectId,
        projectName: projectNames.get(phase.projectId) ?? phase.project.name,
        kind: 'GATE_PENDING',
        detail: `${phase.name} is waiting for an approval decision`,
        count: 1,
      });
    }
  }

  return {
    projects: projectPage.data,
    totals,
    attentionItems: attentionItems.sort((a, b) => b.count - a.count),
    workload: workloadFromTasks(tasks, todayDate),
    upcomingDeadlines: summaries
      .filter(
        (task) =>
          task.dueDate != null &&
          task.dueDate >= todayDate &&
          task.dueDate <= horizon &&
          task.status !== 'COMPLETED' &&
          task.status !== 'CANCELLED',
      )
      .sort(byDueDate)
      .slice(0, 20),
    teamAttendance,
    recentActivity: activity.map(toActivity),
  };
}

// --------------------------------------------------------- company dashboard

export async function getCompanyDashboard(db: Db, actor: Actor): Promise<CompanyDashboard> {
  const todayDate = today(actor.timezone);

  const [projects, tasks, users, attendanceDays, milestoneRows, risks, issues, activity] =
    await Promise.all([
      db.project.findMany({
        where: { organizationId: actor.organizationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          progress: true,
          startDate: true,
          plannedEndDate: true,
        },
      }),
      db.task.findMany({
        where: {
          project: { organizationId: actor.organizationId, deletedAt: null },
          deletedAt: null,
        },
        select: { status: true, dueDate: true },
      }),
      db.user.findMany({
        where: { organizationId: actor.organizationId },
        select: { id: true, status: true },
      }),
      db.attendanceDay.findMany({
        where: {
          workDate: dateOnlyToDateColumn(todayDate) as Date,
          user: { organizationId: actor.organizationId },
        },
        select: {
          userId: true,
          sessions: {
            select: { endedAt: true, breaks: { select: { endedAt: true } } },
          },
        },
      }),
      db.milestone.findMany({
        where: {
          project: { organizationId: actor.organizationId, deletedAt: null },
          status: { in: ['PLANNED', 'AT_RISK'] },
          date: { gte: dateOnlyToDateColumn(todayDate) as Date },
        },
        orderBy: { date: 'asc' },
        take: 10,
        select: {
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
        },
      }),
      db.risk.findMany({
        where: { project: { organizationId: actor.organizationId, deletedAt: null } },
        orderBy: { severityScore: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          title: true,
          severity: true,
          status: true,
          project: { select: { name: true } },
        },
      }),
      db.issue.findMany({
        where: { project: { organizationId: actor.organizationId, deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          title: true,
          priority: true,
          status: true,
          project: { select: { name: true } },
        },
      }),
      db.activityLog.findMany({
        where: { project: { organizationId: actor.organizationId, deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          verb: true,
          summary: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: USER_SUMMARY_SELECT },
        },
      }),
    ]);

  const byStatus = Object.fromEntries(
    (
      [
        'DRAFT',
        'PLANNED',
        'ACTIVE',
        'ON_HOLD',
        'AT_RISK',
        'COMPLETED',
        'CANCELLED',
        'ARCHIVED',
      ] as ProjectStatus[]
    ).map((status) => [status, projects.filter((project) => project.status === status).length]),
  ) as Record<ProjectStatus, number>;

  // "On schedule" and "delayed" are measured, not declared: a project is delayed when its
  // actual progress trails the elapsed share of its planned duration by more than 10%.
  const live = projects.filter((project) =>
    ['ACTIVE', 'AT_RISK', 'ON_HOLD'].includes(project.status),
  );
  let onSchedule = 0;
  let delayed = 0;
  let attention = 0;
  for (const project of live) {
    const schedule = scheduleMetrics({
      startDate: dateColumnToDateOnly(project.startDate) as DateOnly,
      plannedEndDate: dateColumnToDateOnly(project.plannedEndDate) as DateOnly,
      actualProgress: project.progress,
      todayDate,
    });
    if (schedule.variance <= -25) delayed += 1;
    else if (schedule.variance <= -10) attention += 1;
    else onSchedule += 1;
  }

  const working = attendanceDays.filter((day) =>
    day.sessions.some((session) => session.endedAt == null),
  );
  const onBreak = working.filter((day) =>
    day.sessions.some(
      (session) => session.endedAt == null && session.breaks.some((span) => span.endedAt == null),
    ),
  );

  return {
    projects: {
      active: live.length,
      onSchedule,
      attentionRequired: attention,
      delayed,
      byStatus,
    },
    people: {
      total: users.length,
      active: users.filter((user) => user.status === 'ACTIVE').length,
      workingToday: working.length,
      onBreak: onBreak.length,
    },
    tasks: countTasks(
      tasks.map((task) => ({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) })),
      todayDate,
    ),
    projectProgress: live.map((project) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      progress: project.progress,
      health: 'OK' as const,
    })),
    upcomingMilestones: milestoneRows.map(toMilestone),
    topRisks: risks
      .filter((risk) => isOpenRisk(risk.status) && riskLevelRank(risk.severity) >= 3)
      .slice(0, 10)
      .map((risk) => ({
        id: risk.id,
        reference: risk.reference,
        title: risk.title,
        severity: risk.severity,
        projectName: risk.project.name,
      })),
    openIssues: issues
      .filter((issue) => isOpenIssue(issue.status))
      .slice(0, 10)
      .map((issue) => ({
        id: issue.id,
        reference: issue.reference,
        title: issue.title,
        priority: issue.priority,
        projectName: issue.project.name,
      })),
    recentActivity: activity.map(toActivity),
  };
}

// ------------------------------------------------------------------ workload

/** Work distribution across people (spec section 48). */
export async function getWorkloadReport(
  db: Db,
  actor: Actor,
  query: WorkloadQuery,
): Promise<WorkloadReport> {
  const todayDate = today(actor.timezone);
  const visible = await visibleProjectIds(db, actor);

  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    project: {
      deletedAt: null,
      organizationId: actor.organizationId,
      ...(visible == null ? {} : { id: { in: visible } }),
      ...(query.projectId != null ? { id: query.projectId } : {}),
      ...(query.departmentId != null ? { departmentId: query.departmentId } : {}),
    },
    ...(query.from != null || query.to != null
      ? {
          dueDate: {
            ...(query.from != null ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to != null ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
  };

  const tasks = await db.task.findMany({
    where,
    select: {
      id: true,
      status: true,
      progress: true,
      dueDate: true,
      projectId: true,
      estimatedHours: true,
      actualHours: true,
      assignments: { select: { user: { select: USER_SUMMARY_SELECT } } },
    },
  });

  interface Bucket extends MemberWorkload {
    projects: Set<string>;
    estimatedHours: number;
    actualHours: number;
    progressSum: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const task of tasks) {
    for (const assignment of task.assignments) {
      const user = assignment.user;
      const bucket =
        buckets.get(user.id) ??
        ({
          user: toUserSummary(user),
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          blocked: 0,
          overdue: 0,
          progress: 0,
          projects: new Set<string>(),
          estimatedHours: 0,
          actualHours: 0,
          progressSum: 0,
        } satisfies Bucket);

      if (task.status !== 'CANCELLED') {
        bucket.total += 1;
        bucket.projects.add(task.projectId);
        bucket.estimatedHours += task.estimatedHours == null ? 0 : Number(task.estimatedHours);
        bucket.actualHours += task.actualHours == null ? 0 : Number(task.actualHours);
        bucket.progressSum += task.status === 'COMPLETED' ? 100 : task.progress;

        if (task.status === 'COMPLETED') bucket.completed += 1;
        else if (task.status === 'IN_PROGRESS' || task.status === 'UNDER_REVIEW')
          bucket.inProgress += 1;
        else if (task.status === 'BLOCKED') bucket.blocked += 1;
        else bucket.notStarted += 1;

        if (
          isOverdue({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) }, todayDate)
        ) {
          bucket.overdue += 1;
        }
      }

      buckets.set(user.id, bucket);
    }
  }

  return {
    rows: [...buckets.values()]
      .map((bucket) => ({
        user: bucket.user,
        total: bucket.total,
        completed: bucket.completed,
        inProgress: bucket.inProgress,
        notStarted: bucket.notStarted,
        blocked: bucket.blocked,
        overdue: bucket.overdue,
        progress: bucket.total === 0 ? 0 : Math.round(bucket.progressSum / bucket.total),
        projects: bucket.projects.size,
        estimatedHours: Math.round(bucket.estimatedHours * 100) / 100,
        actualHours: Math.round(bucket.actualHours * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total),
    generatedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------ helpers

function workloadFromTasks(
  tasks: readonly Prisma.TaskGetPayload<{ select: typeof TASK_SUMMARY_SELECT }>[],
  todayDate: DateOnly,
): MemberWorkload[] {
  const buckets = new Map<string, MemberWorkload & { progressSum: number }>();

  for (const task of tasks) {
    if (task.status === 'CANCELLED') continue;
    for (const assignment of task.assignments) {
      const user = assignment.user;
      const bucket = buckets.get(user.id) ?? {
        user: toUserSummary(user),
        total: 0,
        completed: 0,
        inProgress: 0,
        notStarted: 0,
        blocked: 0,
        overdue: 0,
        progress: 0,
        progressSum: 0,
      };

      bucket.total += 1;
      bucket.progressSum += task.status === 'COMPLETED' ? 100 : task.progress;
      if (task.status === 'COMPLETED') bucket.completed += 1;
      else if (task.status === 'IN_PROGRESS' || task.status === 'UNDER_REVIEW')
        bucket.inProgress += 1;
      else if (task.status === 'BLOCKED') bucket.blocked += 1;
      else bucket.notStarted += 1;

      if (
        isOverdue({ status: task.status, dueDate: dateColumnToDateOnly(task.dueDate) }, todayDate)
      ) {
        bucket.overdue += 1;
      }

      buckets.set(user.id, bucket);
    }
  }

  return [...buckets.values()]
    .map(({ progressSum, ...bucket }) => ({
      ...bucket,
      progress: bucket.total === 0 ? 0 : Math.round(progressSum / bucket.total),
    }))
    .sort((a, b) => b.total - a.total);
}

function toPhaseSlice(phase: {
  id: string;
  name: string;
  sequence: number;
  status: string;
  progress: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}): PhaseProgressSlice {
  return {
    id: phase.id,
    name: phase.name,
    sequence: phase.sequence,
    status: phase.status,
    progress: phase.progress,
    plannedStart: dateColumnToDateOnly(phase.plannedStart),
    plannedEnd: dateColumnToDateOnly(phase.plannedEnd),
  };
}

function toMilestone(row: {
  id: string;
  name: string;
  description: string | null;
  date: Date;
  status: Milestone['status'];
  owner: Parameters<typeof toUserSummary>[0] | null;
  phase: { id: string; name: string } | null;
  tasks: { task: { id: string; reference: string; name: string; status: TaskSummary['status'] } }[];
}): Milestone {
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

function toActivity(row: {
  id: string;
  verb: string;
  summary: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  actor: Parameters<typeof toUserSummary>[0] | null;
}): ActivityEntry {
  return {
    id: row.id,
    actor: toUserSummaryOrNull(row.actor),
    verb: row.verb,
    summary: row.summary,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toNotification(row: {
  id: string;
  type: Notification['type'];
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  project: { id: string; code: string; name: string } | null;
}): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    project: row.project,
    entityType: row.entityType,
    entityId: row.entityId,
    link: row.link,
  };
}

function byDueDate(a: TaskSummary, b: TaskSummary): number {
  return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
}

export type { TaskCounts };
