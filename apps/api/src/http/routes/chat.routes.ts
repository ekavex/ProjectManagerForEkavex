import {
  createMessageSchema,
  listMessagesQuerySchema,
  listResourcesQuerySchema,
  reactionSchema,
  updateMessageSchema,
  type CreateMessageInput,
  type ListMessagesQuery,
  type ListResourcesQuery,
  type ReactionInput,
  type UpdateMessageInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import * as messageService from '../../services/message.service.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import { writeLimiter } from '../middleware/common.js';
import { handler, validate } from '../middleware/validate.js';

export const messageRouter: Router = Router({ mergeParams: true });

messageRouter.get(
  '/',
  validate({ query: listMessagesQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await messageService.listMessages(
        prisma,
        requireProjectContext(req),
        query<ListMessagesQuery>(req),
      ),
    );
  }),
);

messageRouter.get(
  '/pinned',
  handler(async (req, res) => {
    res.json({ data: await messageService.listPinned(prisma, requireProjectContext(req)) });
  }),
);

messageRouter.post(
  '/',
  writeLimiter,
  validate({ body: createMessageSchema }),
  handler(async (req, res) => {
    const message = await messageService.createMessage(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateMessageInput>(req),
    );
    res.status(201).json(message);
  }),
);

messageRouter.patch(
  '/:messageId',
  validate({ body: updateMessageSchema }),
  handler(async (req, res) => {
    res.json(
      await messageService.updateMessage(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.messageId as string,
        body<UpdateMessageInput>(req),
      ),
    );
  }),
);

messageRouter.delete(
  '/:messageId',
  handler(async (req, res) => {
    await messageService.deleteMessage(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.messageId as string,
    );
    res.status(204).send();
  }),
);

messageRouter.post(
  '/:messageId/reactions',
  validate({ body: reactionSchema }),
  handler(async (req, res) => {
    res.json(
      await messageService.addReaction(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.messageId as string,
        body<ReactionInput>(req),
      ),
    );
  }),
);

messageRouter.delete(
  '/:messageId/reactions',
  validate({ body: reactionSchema }),
  handler(async (req, res) => {
    res.json(
      await messageService.removeReaction(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.messageId as string,
        body<ReactionInput>(req),
      ),
    );
  }),
);

messageRouter.post(
  '/:messageId/pin',
  handler(async (req, res) => {
    res.json(
      await messageService.pinMessage(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.messageId as string,
      ),
    );
  }),
);

messageRouter.delete(
  '/:messageId/pin',
  handler(async (req, res) => {
    res.json(
      await messageService.unpinMessage(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.messageId as string,
      ),
    );
  }),
);

// ---------------------------------------------------------------- resources

export const resourceRouter: Router = Router({ mergeParams: true });

resourceRouter.get(
  '/',
  validate({ query: listResourcesQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await messageService.listResources(
        prisma,
        requireProjectContext(req),
        query<ListResourcesQuery>(req),
      ),
    );
  }),
);
