/**
 * Organisation administration: settings, holidays and role permissions.
 */
import {
  createHolidaySchema,
  listHolidaysQuerySchema,
  orgRoleParamSchema,
  replaceRolePermissionsSchema,
  updateOrganizationSchema,
  type CreateHolidayInput,
  type ListHolidaysQuery,
  type OrgRole,
  type ReplaceRolePermissionsInput,
  type UpdateOrganizationInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import * as organizationService from '../../services/organization.service.js';
import { body, query, requireActor } from '../context.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

export const organizationRouter: Router = Router();

organizationRouter.use(requireAuth);

/** Everyone may read the working-day rules and the leave policy that apply to them. */
organizationRouter.get(
  '/',
  handler(async (req, res) => {
    res.json(await organizationService.getSettings(prisma, requireActor(req)));
  }),
);

organizationRouter.patch(
  '/',
  requirePermission('org:settings'),
  validate({ body: updateOrganizationSchema }),
  handler(async (req, res) => {
    res.json(
      await organizationService.updateSettings(
        prisma,
        requireActor(req),
        body<UpdateOrganizationInput>(req),
      ),
    );
  }),
);

organizationRouter.get(
  '/holidays',
  validate({ query: listHolidaysQuerySchema }),
  handler(async (req, res) => {
    const { year } = query<ListHolidaysQuery>(req);
    const holidays = await organizationService.listHolidays(
      prisma,
      requireActor(req),
      year == null ? {} : { from: `${year}-01-01`, to: `${year}-12-31` },
    );
    res.json({ data: holidays });
  }),
);

organizationRouter.post(
  '/holidays',
  requirePermission('org:settings'),
  validate({ body: createHolidaySchema }),
  handler(async (req, res) => {
    res
      .status(201)
      .json(
        await organizationService.createHoliday(
          prisma,
          requireActor(req),
          body<CreateHolidayInput>(req),
        ),
      );
  }),
);

organizationRouter.delete(
  '/holidays/:holidayId',
  requirePermission('org:settings'),
  handler(async (req, res) => {
    await organizationService.deleteHoliday(
      prisma,
      requireActor(req),
      req.params.holidayId as string,
    );
    res.status(204).send();
  }),
);

organizationRouter.get(
  '/roles',
  requirePermission('role:manage'),
  handler(async (req, res) => {
    res.json({ data: await organizationService.listRolePermissions(prisma, requireActor(req)) });
  }),
);

organizationRouter.put(
  '/roles/:role',
  requirePermission('role:manage'),
  validate({ params: z.object({ role: orgRoleParamSchema }), body: replaceRolePermissionsSchema }),
  handler(async (req, res) => {
    const rows = await organizationService.replaceRolePermissions(
      prisma,
      requireActor(req),
      req.params.role as OrgRole,
      body<ReplaceRolePermissionsInput>(req).permissions,
    );
    res.json({ data: rows });
  }),
);
