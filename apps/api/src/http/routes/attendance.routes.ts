import {
  adjustAttendanceSchema,
  attendanceHistoryQuerySchema,
  breakSchema,
  dateOnlySchema,
  endWorkSchema,
  idSchema,
  startWorkSchema,
  switchWorkContextSchema,
  teamAttendanceQuerySchema,
  type AdjustAttendanceInput,
  type AttendanceHistoryQuery,
  type BreakInput,
  type EndWorkInput,
  type StartWorkInput,
  type SwitchWorkContextInput,
  type TeamAttendanceQuery,
} from '@ekavist/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import * as attendanceService from '../../services/attendance.service.js';
import { body, query, requireActor } from '../context.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

export const attendanceRouter: Router = Router();

attendanceRouter.use(requireAuth);

/** Guards the route parameters so a malformed date never reaches the service. */
const adjustParamsSchema = z.object({
  userId: idSchema,
  workDate: dateOnlySchema,
});

attendanceRouter.get(
  '/today',
  handler(async (req, res) => {
    res.json(await attendanceService.getToday(prisma, requireActor(req)));
  }),
);

attendanceRouter.post(
  '/start-work',
  validate({ body: startWorkSchema }),
  handler(async (req, res) => {
    res.json(
      await attendanceService.startWork(prisma, requireActor(req), body<StartWorkInput>(req)),
    );
  }),
);

attendanceRouter.post(
  '/end-work',
  validate({ body: endWorkSchema }),
  handler(async (req, res) => {
    res.json(await attendanceService.endWork(prisma, requireActor(req), body<EndWorkInput>(req)));
  }),
);

attendanceRouter.post(
  '/switch',
  validate({ body: switchWorkContextSchema }),
  handler(async (req, res) => {
    res.json(
      await attendanceService.switchWorkContext(
        prisma,
        requireActor(req),
        body<SwitchWorkContextInput>(req),
      ),
    );
  }),
);

attendanceRouter.post(
  '/break/start',
  validate({ body: breakSchema }),
  handler(async (req, res) => {
    res.json(await attendanceService.startBreak(prisma, requireActor(req), body<BreakInput>(req)));
  }),
);

attendanceRouter.post(
  '/break/end',
  handler(async (req, res) => {
    res.json(await attendanceService.endBreak(prisma, requireActor(req)));
  }),
);

attendanceRouter.get(
  '/history',
  validate({ query: attendanceHistoryQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await attendanceService.getHistory(
        prisma,
        requireActor(req),
        query<AttendanceHistoryQuery>(req),
      ),
    );
  }),
);

attendanceRouter.get(
  '/team',
  validate({ query: teamAttendanceQuerySchema }),
  handler(async (req, res) => {
    const parsed = query<TeamAttendanceQuery>(req);
    res.json({
      data: await attendanceService.getTeamAttendance(prisma, requireActor(req), {
        ...(parsed.date != null ? { date: parsed.date } : {}),
        ...(parsed.projectId != null ? { projectId: parsed.projectId } : {}),
      }),
    });
  }),
);

/** Administrative correction of a day (spec section 28). */
attendanceRouter.patch(
  '/:userId/:workDate',
  requirePermission('attendance:read-all'),
  validate({ body: adjustAttendanceSchema, params: adjustParamsSchema }),
  handler(async (req, res) => {
    res.json(
      await attendanceService.adjustDay(
        prisma,
        requireActor(req),
        req.params.userId as string,
        req.params.workDate as string,
        body<AdjustAttendanceInput>(req),
      ),
    );
  }),
);
