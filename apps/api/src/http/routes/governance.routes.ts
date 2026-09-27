import {
  analyseChangeRequestSchema,
  createChangeRequestSchema,
  createIssueSchema,
  createRiskSchema,
  decideChangeRequestSchema,
  listChangeRequestsQuerySchema,
  listIssuesQuerySchema,
  listRisksQuerySchema,
  updateIssueSchema,
  updateRiskSchema,
  type AnalyseChangeRequestInput,
  type CreateChangeRequestInput,
  type CreateIssueInput,
  type CreateRiskInput,
  type DecideChangeRequestInput,
  type ListChangeRequestsQuery,
  type ListIssuesQuery,
  type ListRisksQuery,
  type UpdateIssueInput,
  type UpdateRiskInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import * as governanceService from '../../services/governance.service.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import { handler, validate } from '../middleware/validate.js';

// ---------------------------------------------------------------------- risks

export const riskRouter: Router = Router({ mergeParams: true });

riskRouter.get(
  '/',
  validate({ query: listRisksQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.listRisks(
        prisma,
        requireProjectContext(req),
        query<ListRisksQuery>(req),
      ),
    );
  }),
);

riskRouter.post(
  '/',
  validate({ body: createRiskSchema }),
  handler(async (req, res) => {
    const risk = await governanceService.createRisk(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateRiskInput>(req),
    );
    res.status(201).json(risk);
  }),
);

riskRouter.patch(
  '/:riskId',
  validate({ body: updateRiskSchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.updateRisk(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.riskId as string,
        body<UpdateRiskInput>(req),
      ),
    );
  }),
);

riskRouter.delete(
  '/:riskId',
  handler(async (req, res) => {
    await governanceService.deleteRisk(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.riskId as string,
    );
    res.status(204).send();
  }),
);

// --------------------------------------------------------------------- issues

export const issueRouter: Router = Router({ mergeParams: true });

issueRouter.get(
  '/',
  validate({ query: listIssuesQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.listIssues(
        prisma,
        requireProjectContext(req),
        query<ListIssuesQuery>(req),
      ),
    );
  }),
);

issueRouter.post(
  '/',
  validate({ body: createIssueSchema }),
  handler(async (req, res) => {
    const issue = await governanceService.createIssue(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateIssueInput>(req),
    );
    res.status(201).json(issue);
  }),
);

issueRouter.patch(
  '/:issueId',
  validate({ body: updateIssueSchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.updateIssue(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.issueId as string,
        body<UpdateIssueInput>(req),
      ),
    );
  }),
);

issueRouter.delete(
  '/:issueId',
  handler(async (req, res) => {
    await governanceService.deleteIssue(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.issueId as string,
    );
    res.status(204).send();
  }),
);

// ------------------------------------------------------------ change requests

export const changeRequestRouter: Router = Router({ mergeParams: true });

changeRequestRouter.get(
  '/',
  validate({ query: listChangeRequestsQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.listChangeRequests(
        prisma,
        requireProjectContext(req),
        query<ListChangeRequestsQuery>(req),
      ),
    );
  }),
);

changeRequestRouter.post(
  '/',
  validate({ body: createChangeRequestSchema }),
  handler(async (req, res) => {
    const changeRequest = await governanceService.createChangeRequest(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateChangeRequestInput>(req),
    );
    res.status(201).json(changeRequest);
  }),
);

changeRequestRouter.get(
  '/:changeRequestId',
  handler(async (req, res) => {
    res.json(
      await governanceService.getChangeRequest(
        prisma,
        requireProjectContext(req),
        req.params.changeRequestId as string,
      ),
    );
  }),
);

changeRequestRouter.post(
  '/:changeRequestId/analyse',
  validate({ body: analyseChangeRequestSchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.analyseChangeRequest(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.changeRequestId as string,
        body<AnalyseChangeRequestInput>(req),
      ),
    );
  }),
);

changeRequestRouter.post(
  '/:changeRequestId/decide',
  validate({ body: decideChangeRequestSchema }),
  handler(async (req, res) => {
    res.json(
      await governanceService.decideChangeRequest(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.changeRequestId as string,
        body<DecideChangeRequestInput>(req),
      ),
    );
  }),
);
