import {
  createDecisionSchema,
  createDocumentSchema,
  createPersonalNoteSchema,
  createProjectNoteSchema,
  listDocumentsQuerySchema,
  listNotesQuerySchema,
  updateDecisionSchema,
  updateDocumentSchema,
  updatePersonalNoteSchema,
  updateProjectNoteSchema,
  type CreateDecisionInput,
  type CreateDocumentInput,
  type CreatePersonalNoteInput,
  type CreateProjectNoteInput,
  type ListDocumentsQuery,
  type ListNotesQuery,
  type UpdateDecisionInput,
  type UpdateDocumentInput,
  type UpdatePersonalNoteInput,
  type UpdateProjectNoteInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import * as contentService from '../../services/content.service.js';
import { body, query, requireActor, requireProjectContext } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { handler, validate } from '../middleware/validate.js';

// ----------------------------------------------------------------- documents

export const documentRouter: Router = Router({ mergeParams: true });

documentRouter.get(
  '/',
  validate({ query: listDocumentsQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.listDocuments(
        prisma,
        requireProjectContext(req),
        query<ListDocumentsQuery>(req),
      ),
    );
  }),
);

documentRouter.post(
  '/',
  validate({ body: createDocumentSchema }),
  handler(async (req, res) => {
    const document = await contentService.createDocument(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateDocumentInput>(req),
    );
    res.status(201).json(document);
  }),
);

documentRouter.patch(
  '/:documentId',
  validate({ body: updateDocumentSchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.updateDocument(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.documentId as string,
        body<UpdateDocumentInput>(req),
      ),
    );
  }),
);

documentRouter.delete(
  '/:documentId',
  handler(async (req, res) => {
    await contentService.deleteDocument(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.documentId as string,
    );
    res.status(204).send();
  }),
);

// ------------------------------------------------------------- project notes

export const projectNoteRouter: Router = Router({ mergeParams: true });

projectNoteRouter.get(
  '/',
  validate({ query: listNotesQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.listProjectNotes(
        prisma,
        requireProjectContext(req),
        query<ListNotesQuery>(req),
      ),
    );
  }),
);

projectNoteRouter.post(
  '/',
  validate({ body: createProjectNoteSchema }),
  handler(async (req, res) => {
    const note = await contentService.createProjectNote(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateProjectNoteInput>(req),
    );
    res.status(201).json(note);
  }),
);

projectNoteRouter.patch(
  '/:noteId',
  validate({ body: updateProjectNoteSchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.updateProjectNote(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.noteId as string,
        body<UpdateProjectNoteInput>(req),
      ),
    );
  }),
);

projectNoteRouter.delete(
  '/:noteId',
  handler(async (req, res) => {
    await contentService.deleteProjectNote(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.noteId as string,
    );
    res.status(204).send();
  }),
);

// -------------------------------------------------------------- decision log

export const decisionRouter: Router = Router({ mergeParams: true });

decisionRouter.get(
  '/',
  handler(async (req, res) => {
    res.json({ data: await contentService.listDecisions(prisma, requireProjectContext(req)) });
  }),
);

decisionRouter.post(
  '/',
  validate({ body: createDecisionSchema }),
  handler(async (req, res) => {
    const decision = await contentService.createDecision(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      body<CreateDecisionInput>(req),
    );
    res.status(201).json(decision);
  }),
);

decisionRouter.patch(
  '/:decisionId',
  validate({ body: updateDecisionSchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.updateDecision(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.decisionId as string,
        body<UpdateDecisionInput>(req),
      ),
    );
  }),
);

decisionRouter.delete(
  '/:decisionId',
  handler(async (req, res) => {
    await contentService.deleteDecision(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      req.params.decisionId as string,
    );
    res.status(204).send();
  }),
);

// ------------------------------------------------------------ personal notes

/**
 * Mounted at `/me/notes`, never beneath a project. The route has no project parameter at
 * all, which is the structural half of the rule that personal notes stay private.
 */
export const personalNoteRouter: Router = Router();

personalNoteRouter.use(requireAuth);

personalNoteRouter.get(
  '/',
  validate({ query: listNotesQuerySchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.listPersonalNotes(prisma, requireActor(req), query<ListNotesQuery>(req)),
    );
  }),
);

personalNoteRouter.post(
  '/',
  validate({ body: createPersonalNoteSchema }),
  handler(async (req, res) => {
    const note = await contentService.createPersonalNote(
      prisma,
      requireActor(req),
      body<CreatePersonalNoteInput>(req),
    );
    res.status(201).json(note);
  }),
);

personalNoteRouter.patch(
  '/:noteId',
  validate({ body: updatePersonalNoteSchema }),
  handler(async (req, res) => {
    res.json(
      await contentService.updatePersonalNote(
        prisma,
        requireActor(req),
        req.params.noteId as string,
        body<UpdatePersonalNoteInput>(req),
      ),
    );
  }),
);

personalNoteRouter.delete(
  '/:noteId',
  handler(async (req, res) => {
    await contentService.deletePersonalNote(prisma, requireActor(req), req.params.noteId as string);
    res.status(204).send();
  }),
);
