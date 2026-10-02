import {
  addProjectMemberSchema,
  changeProjectStatusSchema,
  closeProjectSchema,
  createLessonSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  type AddProjectMemberInput,
  type ChangeProjectStatusInput,
  type CloseProjectInput,
  type CreateLessonInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateProjectInput,
  type UpdateProjectMemberInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import * as projectService from '../../services/project.service.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import {
  loadProject,
  requireAuth,
  requirePermission,
  requireProjectPermission,
} from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

export const projectRouter: Router = Router();

projectRouter.use(requireAuth);

projectRouter.get(
  '/',
  validate({ query: listProjectsQuerySchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await projectService.listProjects(prisma, actor, query<ListProjectsQuery>(req)));
  }),
);

projectRouter.post(
  '/',
  requirePermission('project:create'),
  validate({ body: createProjectSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const project = await projectService.createProject(
      prisma,
      actor,
      body<CreateProjectInput>(req),
    );
    res.status(201).location(`/api/v1/projects/${project.id}`).json(project);
  }),
);

projectRouter.get(
  '/:projectId',
  requireProjectPermission('project:read'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const context = requireProjectContext(req);
    res.json(await projectService.getProject(prisma, actor, context.projectId, context));
  }),
);

projectRouter.patch(
  '/:projectId',
  requireProjectPermission('project:update'),
  validate({ body: updateProjectSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await projectService.updateProject(
        prisma,
        actor,
        requireProjectContext(req),
        body<UpdateProjectInput>(req),
      ),
    );
  }),
);

projectRouter.patch(
  '/:projectId/status',
  requireProjectPermission('project:update'),
  validate({ body: changeProjectStatusSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await projectService.changeProjectStatus(
        prisma,
        actor,
        requireProjectContext(req),
        body<ChangeProjectStatusInput>(req),
      ),
    );
  }),
);

projectRouter.post(
  '/:projectId/archive',
  requireProjectPermission('project:archive'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await projectService.changeProjectStatus(prisma, actor, requireProjectContext(req), {
        status: 'ARCHIVED',
        reason: undefined,
      }),
    );
  }),
);

projectRouter.delete(
  '/:projectId',
  requirePermission('project:delete'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    await projectService.deleteProject(prisma, actor, req.params.projectId as string);
    res.status(204).send();
  }),
);

projectRouter.get(
  '/:projectId/health',
  requireProjectPermission('project:read'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await projectService.getProjectHealth(prisma, actor, requireProjectContext(req).projectId),
    );
  }),
);

// ------------------------------------------------------------------ members

projectRouter.get(
  '/:projectId/members',
  requireProjectPermission('project:read'),
  handler(async (req, res) => {
    res.json({
      data: await projectService.listMembers(prisma, requireProjectContext(req).projectId),
    });
  }),
);

projectRouter.post(
  '/:projectId/members',
  requireProjectPermission('member:add'),
  validate({ body: addProjectMemberSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const members = await projectService.addMember(
      prisma,
      actor,
      requireProjectContext(req),
      body<AddProjectMemberInput>(req),
    );
    res.status(201).json({ data: members });
  }),
);

projectRouter.patch(
  '/:projectId/members/:userId',
  requireProjectPermission('member:update'),
  validate({ body: updateProjectMemberSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await projectService.updateMember(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.userId as string,
        body<UpdateProjectMemberInput>(req),
      ),
    });
  }),
);

projectRouter.delete(
  '/:projectId/members/:userId',
  requireProjectPermission('member:remove'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json({
      data: await projectService.removeMember(
        prisma,
        actor,
        requireProjectContext(req),
        req.params.userId as string,
      ),
    });
  }),
);

// ------------------------------------------------------------------ closure

projectRouter.get(
  '/:projectId/closure',
  requireProjectPermission('project:read'),
  handler(async (req, res) => {
    res.json(
      await projectService.getClosureChecklist(prisma, requireProjectContext(req).projectId),
    );
  }),
);

projectRouter.post(
  '/:projectId/closure',
  requireProjectPermission('project:close'),
  validate({ body: closeProjectSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(
      await projectService.closeProject(
        prisma,
        actor,
        requireProjectContext(req),
        body<CloseProjectInput>(req),
      ),
    );
  }),
);

// ------------------------------------------------------------------ lessons

projectRouter.get(
  '/:projectId/lessons',
  requireProjectPermission('project:read'),
  handler(async (req, res) => {
    const lessons = await projectService.listLessons(prisma, requireProjectContext(req).projectId);
    res.json({ data: lessons });
  }),
);

projectRouter.post(
  '/:projectId/lessons',
  requireProjectPermission('project:close'),
  validate({ body: createLessonSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    res
      .status(201)
      .json(
        await projectService.addLesson(
          prisma,
          actor,
          requireProjectContext(req),
          body<CreateLessonInput>(req),
        ),
      );
  }),
);

projectRouter.delete(
  '/:projectId/lessons/:lessonId',
  requireProjectPermission('project:close'),
  handler(async (req, res) => {
    const actor = requireActor(req);
    await projectService.deleteLesson(
      prisma,
      actor,
      requireProjectContext(req),
      req.params.lessonId as string,
    );
    res.status(204).send();
  }),
);

/**
 * Mounts a feature router beneath `/projects/:projectId`.
 *
 * `mergeParams` is what lets the child read `req.params.projectId`, and `loadProject`
 * puts the caller's project context in place before the child's own permission check.
 */
export function mountProjectFeature(path: string, child: Router): void {
  projectRouter.use(`/:projectId/${path}`, loadProject(), child);
}
