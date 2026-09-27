/**
 * Routes mounted beneath `/projects/:projectId`: phases, WBS, tasks, dependencies and
 * the Gantt feed. They run after `loadProject`, so `req.projectContext` is already set
 * and each handler asserts the permission it needs through the service layer.
 */
import {
  createDependencySchema,
  createPhaseSchema,
  createTaskCommentSchema,
  createTaskLinkAttachmentSchema,
  createTaskSchema,
  createWbsItemSchema,
  decidePhaseSchema,
  ganttQuerySchema,
  listTasksQuerySchema,
  moveWbsItemSchema,
  reorderPhasesSchema,
  submitPhaseSchema,
  updatePhaseSchema,
  updateTaskProgressSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  updateWbsItemSchema,
  type CreateDependencyInput,
  type CreatePhaseInput,
  type CreateTaskCommentInput,
  type CreateTaskInput,
  type CreateTaskLinkAttachmentInput,
  type CreateWbsItemInput,
  type DecidePhaseInput,
  type GanttQuery,
  type ListTasksQuery,
  type MoveWbsItemInput,
  type ReorderPhasesInput,
  type SubmitPhaseInput,
  type UpdatePhaseInput,
  type UpdateTaskInput,
  type UpdateTaskProgressInput,
  type UpdateTaskStatusInput,
  type UpdateWbsItemInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { assertProjectPermission } from '../../policy/project-access.js';
import * as dependencyService from '../../services/dependency.service.js';
import * as ganttService from '../../services/gantt.service.js';
import * as phaseService from '../../services/phase.service.js';
import * as taskService from '../../services/task.service.js';
import * as wbsService from '../../services/wbs.service.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import { handler, validate } from '../middleware/validate.js';

// -------------------------------------------------------------------- phases

export const phaseRouter: Router = Router({ mergeParams: true });

phaseRouter.get(
  '/',
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json({ data: await phaseService.listPhases(prisma, actor, context.projectId) });
  }),
);

phaseRouter.post(
  '/',
  validate({ body: createPhaseSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const phase = await phaseService.createPhase(
      prisma,
      actor,
      requireProjectContext(req),
      body<CreatePhaseInput>(req),
    );
    res.status(201).json(phase);
  }),
);

phaseRouter.post(
  '/reorder',
  validate({ body: reorderPhasesSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await phaseService.reorderPhases(
        prisma,
        actor,
        requireProjectContext(req),
        body<ReorderPhasesInput>(req),
      ),
    });
  }),
);

phaseRouter.get(
  '/:phaseId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json(
      await phaseService.getPhase(prisma, actor, context.projectId, req.params.phaseId as string),
    );
  }),
);

phaseRouter.patch(
  '/:phaseId',
  validate({ body: updatePhaseSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await phaseService.updatePhase(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.phaseId as string,
        body<UpdatePhaseInput>(req),
      ),
    );
  }),
);

phaseRouter.delete(
  '/:phaseId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    await phaseService.deletePhase(
      prisma,
      actor,
      requireProjectContext(req),
      req.params.phaseId as string,
    );
    res.status(204).send();
  }),
);

/** Convenience for "start this phase", which is a gate check rather than a field edit. */
phaseRouter.post(
  '/:phaseId/start',
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await phaseService.updatePhase(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.phaseId as string,
        { status: 'IN_PROGRESS' },
      ),
    );
  }),
);

phaseRouter.post(
  '/:phaseId/submit',
  validate({ body: submitPhaseSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await phaseService.submitPhase(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.phaseId as string,
        body<SubmitPhaseInput>(req),
      ),
    );
  }),
);

phaseRouter.post(
  '/:phaseId/approve',
  validate({ body: decidePhaseSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await phaseService.decidePhase(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.phaseId as string,
        true,
        body<DecidePhaseInput>(req),
      ),
    );
  }),
);

phaseRouter.post(
  '/:phaseId/reject',
  validate({ body: decidePhaseSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await phaseService.decidePhase(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.phaseId as string,
        false,
        body<DecidePhaseInput>(req),
      ),
    );
  }),
);

// ----------------------------------------------------------------------- WBS

export const wbsRouter: Router = Router({ mergeParams: true });

wbsRouter.get(
  '/',
  handler(async (req, res) => {
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    const phaseId = typeof req.query['phaseId'] === 'string' ? req.query['phaseId'] : undefined;
    res.json({ data: await wbsService.getWbsTree(prisma, context.projectId, phaseId) });
  }),
);

wbsRouter.post(
  '/',
  validate({ body: createWbsItemSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const tree = await wbsService.createWbsItem(
      prisma,
      actor,
      requireProjectContext(req),
      body<CreateWbsItemInput>(req),
    );
    res.status(201).json({ data: tree });
  }),
);

wbsRouter.patch(
  '/:wbsId',
  validate({ body: updateWbsItemSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await wbsService.updateWbsItem(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.wbsId as string,
        body<UpdateWbsItemInput>(req),
      ),
    );
  }),
);

wbsRouter.post(
  '/:wbsId/move',
  validate({ body: moveWbsItemSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await wbsService.moveWbsItem(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.wbsId as string,
        body<MoveWbsItemInput>(req),
      ),
    });
  }),
);

wbsRouter.delete(
  '/:wbsId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await wbsService.deleteWbsItem(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.wbsId as string,
      ),
    });
  }),
);

// --------------------------------------------------------------------- tasks

export const taskRouter: Router = Router({ mergeParams: true });

taskRouter.get(
  '/',
  validate({ query: listTasksQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json(
      await taskService.listTasks(prisma, actor, context.projectId, query<ListTasksQuery>(req)),
    );
  }),
);

taskRouter.post(
  '/',
  validate({ body: createTaskSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const task = await taskService.createTask(
      prisma,
      actor,
      requireProjectContext(req),
      body<CreateTaskInput>(req),
    );
    res.status(201).json(task);
  }),
);

taskRouter.get(
  '/:taskId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json(
      await taskService.getTask(prisma, actor, context.projectId, req.params.taskId as string),
    );
  }),
);

taskRouter.patch(
  '/:taskId',
  validate({ body: updateTaskSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await taskService.updateTask(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.taskId as string,
        body<UpdateTaskInput>(req),
      ),
    );
  }),
);

taskRouter.patch(
  '/:taskId/status',
  validate({ body: updateTaskStatusSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await taskService.updateTaskStatus(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.taskId as string,
        body<UpdateTaskStatusInput>(req),
      ),
    );
  }),
);

taskRouter.patch(
  '/:taskId/progress',
  validate({ body: updateTaskProgressSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await taskService.updateTaskProgress(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.taskId as string,
        body<UpdateTaskProgressInput>(req),
      ),
    );
  }),
);

taskRouter.delete(
  '/:taskId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    await taskService.deleteTask(
      prisma,
      actor,
      requireProjectContext(req),
      req.params.taskId as string,
    );
    res.status(204).send();
  }),
);

taskRouter.get(
  '/:taskId/comments',
  handler(async (req, res) => {
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json({
      data: await taskService.listComments(prisma, context.projectId, req.params.taskId as string),
    });
  }),
);

taskRouter.post(
  '/:taskId/comments',
  validate({ body: createTaskCommentSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const comments = await taskService.addComment(
      prisma,
      actor,
      requireProjectContext(req),
      req.params.taskId as string,
      body<CreateTaskCommentInput>(req),
    );
    res.status(201).json({ data: comments });
  }),
);

taskRouter.post(
  '/:taskId/attachments',
  validate({ body: createTaskLinkAttachmentSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const task = await taskService.addLinkAttachment(
      prisma,
      actor,
      requireProjectContext(req),
      req.params.taskId as string,
      body<CreateTaskLinkAttachmentInput>(req),
    );
    res.status(201).json(task);
  }),
);

// -------------------------------------------------------------- dependencies

export const dependencyRouter: Router = Router({ mergeParams: true });

dependencyRouter.get(
  '/',
  handler(async (req, res) => {
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json({ data: await dependencyService.listDependencies(prisma, context.projectId) });
  }),
);

dependencyRouter.post(
  '/',
  validate({ body: createDependencySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const dependencies = await dependencyService.createDependency(
      prisma,
      actor,
      requireProjectContext(req),
      body<CreateDependencyInput>(req),
    );
    res.status(201).json({ data: dependencies });
  }),
);

dependencyRouter.delete(
  '/:dependencyId',
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await dependencyService.deleteDependency(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.dependencyId as string,
      ),
    });
  }),
);

// --------------------------------------------------------------------- Gantt

export const ganttRouter: Router = Router({ mergeParams: true });

ganttRouter.get(
  '/',
  validate({ query: ganttQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    assertProjectPermission(context, 'project:read');
    res.json(await ganttService.getGantt(prisma, actor, context.projectId, query<GanttQuery>(req)));
  }),
);
