/**
 * Dashboards, notifications, reports, search and history.
 */
import {
  createMilestoneSchema,
  dailyReportQuerySchema,
  globalSearchQuerySchema,
  listActivityQuerySchema,
  listAuditQuerySchema,
  listNotificationsQuerySchema,
  replaceRaciSchema,
  updateMilestoneSchema,
  updateNotificationRulesSchema,
  weeklyReportQuerySchema,
  workloadQuerySchema,
  type CreateMilestoneInput,
  type DailyReportQuery,
  type GlobalSearchQuery,
  type ListActivityQuery,
  type ListAuditQuery,
  type ListNotificationsQuery,
  type ReplaceRaciInput,
  type UpdateMilestoneInput,
  type UpdateNotificationRulesInput,
  type WeeklyReportQuery,
  type WorkloadQuery,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import * as dashboardService from '../../services/dashboard.service.js';
import * as historyService from '../../services/history.service.js';
import * as milestoneService from '../../services/milestone.service.js';
import * as notificationService from '../../services/notification.service.js';
import * as reportService from '../../services/report.service.js';
import * as searchService from '../../services/search.service.js';
import { assertProjectPermission } from '../../policy/project-access.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

// ---------------------------------------------------------------- dashboards

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/company',
  requirePermission('project:create', 'audit:read'),
  handler(async (req, res) => {
    res.json(await dashboardService.getCompanyDashboard(prisma, requireActor(req)));
  }),
);

dashboardRouter.get(
  '/lead',
  handler(async (req, res) => {
    res.json(await dashboardService.getLeadDashboard(prisma, requireActor(req)));
  }),
);

// --------------------------------------------------------------------- "me"

export const meRouter: Router = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/dashboard',
  handler(async (req, res) => {
    res.json(await dashboardService.getEmployeeDashboard(prisma, requireActor(req)));
  }),
);

meRouter.get(
  '/work',
  handler(async (req, res) => {
    res.json(await dashboardService.getMyWork(prisma, requireActor(req)));
  }),
);

// ------------------------------------------------------------- notifications

export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

notificationRouter.get(
  '/',
  validate({ query: listNotificationsQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await notificationService.listNotifications(
        prisma,
        requireActor(req),
        query<ListNotificationsQuery>(req),
      ),
    );
  }),
);

notificationRouter.post(
  '/read-all',
  handler(async (req, res) => {
    res.json(await notificationService.markAllRead(prisma, requireActor(req)));
  }),
);

notificationRouter.post(
  '/:notificationId/read',
  handler(async (req, res) => {
    res.json(
      await notificationService.markRead(
        prisma,
        requireActor(req),
        req.params.notificationId as string,
      ),
    );
  }),
);

notificationRouter.get(
  '/rules',
  requirePermission('org:notification-rules'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({ data: await notificationService.listRules(prisma, actor.organizationId) });
  }),
);

notificationRouter.patch(
  '/rules',
  requirePermission('org:notification-rules'),
  validate({ body: updateNotificationRulesSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await notificationService.updateRules(
        prisma,
        actor.organizationId,
        body<UpdateNotificationRulesInput>(req).rules,
      ),
    });
  }),
);

// -------------------------------------------------------------------- search

export const searchRouter: Router = Router();

searchRouter.use(requireAuth);

searchRouter.get(
  '/',
  validate({ query: globalSearchQuerySchema }),
  handler(async (req, res) => {
    res.json({
      data: await searchService.globalSearch(
        prisma,
        requireActor(req),
        query<GlobalSearchQuery>(req),
      ),
    });
  }),
);

// --------------------------------------------------------------------- audit

export const auditRouter: Router = Router();

auditRouter.use(requireAuth);

auditRouter.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: listAuditQuerySchema }),
  handler(async (req, res) => {
    res.json(await historyService.listAudit(prisma, requireActor(req), query<ListAuditQuery>(req)));
  }),
);

// ------------------------------------------------------------ project-scoped

export const projectDashboardRouter: Router = Router({ mergeParams: true });

projectDashboardRouter.get(
  '/',
  handler(async (req, res) => {
    res.json(
      await dashboardService.getProjectDashboard(
        prisma,
        requireActor(req),
        requireProjectContext(req),
      ),
    );
  }),
);

export const activityRouter: Router = Router({ mergeParams: true });

activityRouter.get(
  '/',
  validate({ query: listActivityQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await historyService.listActivity(
        prisma,
        requireProjectContext(req),
        query<ListActivityQuery>(req),
      ),
    );
  }),
);

export const timelineRouter: Router = Router({ mergeParams: true });

timelineRouter.get(
  '/',
  handler(async (req, res) => {
    res.json({ data: await historyService.getTimeline(prisma, requireProjectContext(req)) });
  }),
);

export const milestoneRouter: Router = Router({ mergeParams: true });

milestoneRouter.get(
  '/',
  handler(async (req, res) => {
    res.json({ data: await milestoneService.listMilestones(prisma, requireProjectContext(req)) });
  }),
);

milestoneRouter.post(
  '/',
  validate({ body: createMilestoneSchema }),
  handler(async (req, res) => {
    const milestone = await milestoneService.createMilestone(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateMilestoneInput>(req),
    );
    res.status(201).json(milestone);
  }),
);

milestoneRouter.patch(
  '/:milestoneId',
  validate({ body: updateMilestoneSchema }),
  handler(async (req, res) => {
    res.json(
      await milestoneService.updateMilestone(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.milestoneId as string,
        body<UpdateMilestoneInput>(req),
      ),
    );
  }),
);

milestoneRouter.delete(
  '/:milestoneId',
  handler(async (req, res) => {
    await milestoneService.deleteMilestone(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.milestoneId as string,
    );
    res.status(204).send();
  }),
);

export const raciRouter: Router = Router({ mergeParams: true });

raciRouter.get(
  '/',
  handler(async (req, res) => {
    res.json(await milestoneService.getRaci(prisma, requireProjectContext(req)));
  }),
);

raciRouter.put(
  '/',
  validate({ body: replaceRaciSchema }),
  handler(async (req, res) => {
    res.json(
      await milestoneService.replaceRaci(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        body<ReplaceRaciInput>(req),
      ),
    );
  }),
);

// ------------------------------------------------------------------- reports

export const reportRouter: Router = Router({ mergeParams: true });

reportRouter.get(
  '/daily',
  validate({ query: dailyReportQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'report:read');
    res.json(
      await reportService.buildDailyReport(
        prisma,
        context.projectId,
        actor.timezone,
        query<DailyReportQuery>(req).date,
      ),
    );
  }),
);

reportRouter.get(
  '/weekly',
  validate({ query: weeklyReportQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'report:read');
    res.json(
      await reportService.buildWeeklyReport(
        prisma,
        context.projectId,
        actor.timezone,
        query<WeeklyReportQuery>(req).weekOf,
      ),
    );
  }),
);

reportRouter.get(
  '/final',
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'report:read');
    res.json(await reportService.buildFinalReport(prisma, context.projectId, actor.timezone));
  }),
);

// --------------------------------------------------------- workload report

export const workloadRouter: Router = Router();

workloadRouter.use(requireAuth);

workloadRouter.get(
  '/workload',
  validate({ query: workloadQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await dashboardService.getWorkloadReport(
        prisma,
        requireActor(req),
        query<WorkloadQuery>(req),
      ),
    );
  }),
);
