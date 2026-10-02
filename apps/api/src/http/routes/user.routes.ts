import {
  createDepartmentSchema,
  createUserSchema,
  listUsersQuerySchema,
  notificationPreferenceSchema,
  updateDepartmentSchema,
  updateOwnProfileSchema,
  updateUserSchema,
  type CreateDepartmentInput,
  type CreateUserInput,
  type ListUsersQuery,
  type NotificationPreferenceInput,
  type UpdateDepartmentInput,
  type UpdateOwnProfileInput,
  type UpdateUserInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../lib/errors.js';
import * as authService from '../../services/auth.service.js';
import * as userService from '../../services/user.service.js';
import { body, clientIp, query, requireActor, userAgent } from '../context.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

export const userRouter: Router = Router();

userRouter.use(requireAuth);

userRouter.get(
  '/',
  requirePermission('user:read'),
  validate({ query: listUsersQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await userService.listUsers(prisma, actor, query<ListUsersQuery>(req)));
  }),
);

userRouter.post(
  '/',
  requirePermission('user:create'),
  validate({ body: createUserSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const result = await userService.createUser(prisma, actor, body<CreateUserInput>(req));
    res.status(201).location(`/api/v1/users/${result.user.id}`).json(result);
  }),
);

/** Own profile. Placed before `/:userId` so "me" is not read as an id. */
userRouter.patch(
  '/me',
  validate({ body: updateOwnProfileSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await userService.updateOwnProfile(prisma, actor, body<UpdateOwnProfileInput>(req)));
  }),
);

userRouter.patch(
  '/me/notification-preferences',
  validate({ body: notificationPreferenceSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await userService.updateNotificationPreferences(
        prisma,
        actor,
        body<NotificationPreferenceInput>(req),
      ),
    );
  }),
);

userRouter.get(
  '/:userId',
  requirePermission('user:read'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await userService.getUser(prisma, actor, req.params.userId as string));
  }),
);

userRouter.patch(
  '/:userId',
  requirePermission('user:update'),
  validate({ body: updateUserSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await userService.updateUser(
        prisma,
        actor,
        req.params.userId as string,
        body<UpdateUserInput>(req),
      ),
    );
  }),
);

/** Deactivation rather than deletion: the person's work stays in the project record. */
userRouter.delete(
  '/:userId',
  requirePermission('user:deactivate'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await userService.deactivateUser(prisma, actor, req.params.userId as string));
  }),
);

userRouter.post(
  '/:userId/activate',
  requirePermission('user:update'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await userService.activateUser(prisma, actor, req.params.userId as string));
  }),
);

/** For someone who has lost both their phone and their recovery codes. */
userRouter.post(
  '/:userId/two-factor/reset',
  requirePermission('user:update'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const target = await prisma.user.findFirst({
      where: { id: req.params.userId as string, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (target == null) throw notFound('That person');
    await authService.clearTwoFactor(prisma, actor.id, target.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.status(204).send();
  }),
);

// ------------------------------------------------------------- departments

export const departmentRouter: Router = Router();

departmentRouter.use(requireAuth);

departmentRouter.get(
  '/',
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({ data: await userService.listDepartments(prisma, actor) });
  }),
);

departmentRouter.post(
  '/',
  requirePermission('department:manage'),
  validate({ body: createDepartmentSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const department = await userService.createDepartment(
      prisma,
      actor,
      body<CreateDepartmentInput>(req),
    );
    res.status(201).json(department);
  }),
);

departmentRouter.patch(
  '/:departmentId',
  requirePermission('department:manage'),
  validate({ body: updateDepartmentSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await userService.updateDepartment(
        prisma,
        actor,
        req.params.departmentId as string,
        body<UpdateDepartmentInput>(req),
      ),
    );
  }),
);

departmentRouter.delete(
  '/:departmentId',
  requirePermission('department:manage'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    await userService.deleteDepartment(prisma, actor, req.params.departmentId as string);
    res.status(204).send();
  }),
);
