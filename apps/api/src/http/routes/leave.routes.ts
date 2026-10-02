/** Leave requests, decisions and balances (spec section 86). */
import {
  createLeaveSchema,
  decideLeaveSchema,
  idSchema,
  listLeaveQuerySchema,
  type CreateLeaveInput,
  type DecideLeaveInput,
  type ListLeaveQuery,
} from '@ekavist/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { today } from '../../domain/time.js';
import * as leaveService from '../../services/leave.service.js';
import { body, query, requireActor } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

export const leaveRouter: Router = Router();

leaveRouter.use(requireAuth);

leaveRouter.get(
  '/',
  validate({ query: listLeaveQuerySchema }),
  handler(async (req, res) => {
    res.json(await leaveService.listLeave(prisma, requireActor(req), query<ListLeaveQuery>(req)));
  }),
);

const balanceQuerySchema = z.object({
  userId: idSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

leaveRouter.get(
  '/balance',
  validate({ query: balanceQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const input = query<z.infer<typeof balanceQuerySchema>>(req);
    res.json(
      await leaveService.getBalance(
        prisma,
        actor,
        input.userId ?? actor.id,
        input.year ?? Number(today(actor.timezone).slice(0, 4)),
      ),
    );
  }),
);

leaveRouter.post(
  '/',
  validate({ body: createLeaveSchema }),
  handler(async (req, res) => {
    res
      .status(201)
      .json(
        await leaveService.requestLeave(prisma, requireActor(req), body<CreateLeaveInput>(req)),
      );
  }),
);

leaveRouter.post(
  '/:leaveId/decide',
  validate({ body: decideLeaveSchema }),
  handler(async (req, res) => {
    res.json(
      await leaveService.decideLeave(
        prisma,
        requireActor(req),
        req.params.leaveId as string,
        body<DecideLeaveInput>(req),
      ),
    );
  }),
);

leaveRouter.post(
  '/:leaveId/cancel',
  handler(async (req, res) => {
    res.json(
      await leaveService.cancelLeave(prisma, requireActor(req), req.params.leaveId as string),
    );
  }),
);
