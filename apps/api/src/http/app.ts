/**
 * The Express application.
 *
 * Kept separate from `server.ts` so tests can mount it with Supertest without opening a
 * port or starting the scheduler.
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { attendanceRouter } from './routes/attendance.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { messageRouter, resourceRouter } from './routes/chat.routes.js';
import {
  decisionRouter,
  documentRouter,
  personalNoteRouter,
  projectNoteRouter,
} from './routes/content.routes.js';
import { changeRequestRouter, issueRouter, riskRouter } from './routes/governance.routes.js';
import { importRouter } from './routes/import.routes.js';
import {
  activityRouter,
  auditRouter,
  dashboardRouter,
  meRouter,
  milestoneRouter,
  notificationRouter,
  projectDashboardRouter,
  raciRouter,
  reportRouter,
  searchRouter,
  timelineRouter,
  workloadRouter,
} from './routes/ops.routes.js';
import { mountProjectFeature, projectRouter } from './routes/project.routes.js';
import { departmentRouter, userRouter } from './routes/user.routes.js';
import {
  dependencyRouter,
  ganttRouter,
  phaseRouter,
  taskRouter,
  wbsRouter,
} from './routes/work.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { generalLimiter, httpLogger, requestId } from './middleware/common.js';
import { handler } from './middleware/validate.js';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy the client address arrives in X-Forwarded-For; without this
  // the rate limiter would bucket every request under the proxy's address.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    helmet({
      // The API serves JSON and uploaded files, never HTML, so the default CSP would only
      // get in the way of the separately-hosted SPA.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(httpLogger);

  const api = Router();
  api.use(generalLimiter);

  api.get(
    '/health',
    handler(async (_req, res) => {
      // A health check that does not touch the database is not a health check.
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'ekavist-api', time: new Date().toISOString() });
    }),
  );

  api.use('/auth', authRouter);
  api.use('/users', userRouter);
  api.use('/departments', departmentRouter);

  mountProjectFeature('phases', phaseRouter);
  mountProjectFeature('wbs', wbsRouter);
  mountProjectFeature('tasks', taskRouter);
  mountProjectFeature('dependencies', dependencyRouter);
  mountProjectFeature('gantt', ganttRouter);
  mountProjectFeature('messages', messageRouter);
  mountProjectFeature('resources', resourceRouter);
  mountProjectFeature('documents', documentRouter);
  mountProjectFeature('notes', projectNoteRouter);
  mountProjectFeature('decisions', decisionRouter);
  mountProjectFeature('risks', riskRouter);
  mountProjectFeature('issues', issueRouter);
  mountProjectFeature('change-requests', changeRequestRouter);
  mountProjectFeature('dashboard', projectDashboardRouter);
  mountProjectFeature('activity', activityRouter);
  mountProjectFeature('timeline', timelineRouter);
  mountProjectFeature('milestones', milestoneRouter);
  mountProjectFeature('raci', raciRouter);
  mountProjectFeature('reports', reportRouter);
  mountProjectFeature('import', importRouter);
  api.use('/projects', projectRouter);

  api.use('/attendance', attendanceRouter);
  api.use('/me/notes', personalNoteRouter);
  api.use('/me', meRouter);
  api.use('/notifications', notificationRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/search', searchRouter);
  api.use('/audit', auditRouter);
  api.use('/reports', workloadRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
