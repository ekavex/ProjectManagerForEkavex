/** Capacity, calendar and CSV exports. */
import {
  calendarQuerySchema,
  capacityQuerySchema,
  dateOnlySchema,
  workloadQuerySchema,
  type CalendarQuery,
  type CapacityQuery,
  type WorkloadQuery,
} from '@ekavist/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { today } from '../../domain/time.js';
import { assertProjectPermission } from '../../policy/project-access.js';
import * as exportService from '../../services/export.service.js';
import * as planningService from '../../services/planning.service.js';
import { query, requireActor, requireProjectContext } from '../context.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

function sendCsv(res: Response, fileName: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

// --------------------------------------------------------- organisation-wide

/**
 * Mounted at the API root, so each route carries `requireAuth` itself: a router-wide
 * guard would also catch every unmatched path that passes through.
 */
export const planningRouter: Router = Router();

planningRouter.get(
  '/reports/capacity',
  requireAuth,
  requirePermission('report:read', 'attendance:read-team', 'attendance:read-all'),
  validate({ query: capacityQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await planningService.getCapacity(prisma, requireActor(req), query<CapacityQuery>(req)),
    );
  }),
);

planningRouter.get(
  '/reports/workload.csv',
  requireAuth,
  validate({ query: workloadQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const csv = await exportService.exportWorkload(prisma, actor, query<WorkloadQuery>(req));
    sendCsv(res, `workload-${today(actor.timezone)}.csv`, csv);
  }),
);

const attendanceExportQuerySchema = z
  .object({ from: dateOnlySchema, to: dateOnlySchema })
  .refine((v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, {
    path: ['to'],
    message: 'Choose a range of at most a year, ending after it starts.',
  });

planningRouter.get(
  '/attendance/export.csv',
  requireAuth,
  validate({ query: attendanceExportQuerySchema }),
  handler(async (req, res) => {
    const range = query<z.infer<typeof attendanceExportQuerySchema>>(req);
    const csv = await exportService.exportAttendance(prisma, requireActor(req), range);
    sendCsv(res, `attendance-${range.from}-to-${range.to}.csv`, csv);
  }),
);

planningRouter.get(
  '/calendar',
  requireAuth,
  validate({ query: calendarQuerySchema }),
  handler(async (req, res) => {
    const events = await planningService.getCalendar(
      prisma,
      requireActor(req),
      query<CalendarQuery>(req),
    );
    res.json({ data: events });
  }),
);

// ------------------------------------------------------------ project exports

export const projectExportRouter: Router = Router({ mergeParams: true });

projectExportRouter.get(
  '/:dataset',
  validate({ params: z.object({ dataset: z.enum(exportService.PROJECT_EXPORTS) }).passthrough() }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'report:export');
    const dataset = req.params.dataset as exportService.ProjectExport;
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: context.projectId },
      select: { code: true },
    });
    const csv = await exportService.exportProject(prisma, actor, context.projectId, dataset);
    sendCsv(res, `${project.code}-${dataset}-${today(actor.timezone)}.csv`, csv);
  }),
);
