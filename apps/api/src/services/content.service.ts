/**
 * Documents, notes and the decision log (spec sections 37 to 39).
 *
 * The rule that matters most here is the one about personal notes: they are keyed only by
 * user, the table has no project relation at all, and every function that touches them
 * filters on the caller's own id. A project query cannot reach them even by mistake
 * (business rule 12).
 */
import {
  type CreateDecisionInput,
  type CreateDocumentInput,
  type CreatePersonalNoteInput,
  type CreateProjectNoteInput,
  type DecisionLogEntry,
  type ListDocumentsQuery,
  type ListNotesQuery,
  type Paginated,
  type PersonalNote,
  type ProjectDocument,
  type ProjectNote,
  type UpdateDecisionInput,
  type UpdateDocumentInput,
  type UpdatePersonalNoteInput,
  type UpdateProjectNoteInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { dateColumnToDateOnly, dateOnlyToDateColumn, type DateOnly } from '../domain/time.js';
import { notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordActivity, recordAudit } from './audit.service.js';
import { pageMeta, paginate } from './pagination.js';
import { isGoogleDriveUrl } from './task.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

// ----------------------------------------------------------------- documents

const DOCUMENT_SELECT = {
  id: true,
  name: true,
  category: true,
  url: true,
  fileType: true,
  version: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  phase: { select: { id: true, name: true } },
  task: { select: { id: true, reference: true } },
  addedBy: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.DocumentSelect;

type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

function toDocument(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    url: row.url,
    fileType: row.fileType,
    version: row.version,
    description: row.description,
    phase: row.phase,
    task: row.task,
    addedBy: toUserSummaryOrNull(row.addedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDocuments(
  db: Db,
  context: ProjectContext,
  query: ListDocumentsQuery,
): Promise<Paginated<ProjectDocument>> {
  assertProjectPermission(context, 'document:read');

  const where: Prisma.DocumentWhereInput = {
    projectId: context.projectId,
    deletedAt: null,
    ...(query.category != null ? { category: query.category } : {}),
    ...(query.phaseId != null ? { phaseId: query.phaseId } : {}),
    ...(query.taskId != null ? { taskId: query.taskId } : {}),
    ...(query.search != null
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      select: DOCUMENT_SELECT,
      orderBy: { [query.sort]: query.direction },
      ...paginate(query),
    }),
  ]);

  return { data: rows.map(toDocument), meta: pageMeta(query, total) };
}

export async function createDocument(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  input: CreateDocumentInput,
): Promise<ProjectDocument> {
  assertProjectPermission(context, 'document:create');
  assertProjectMutable(context);
  await assertPlacement(db, context.projectId, input.phaseId, input.taskId);

  const row = await db.document.create({
    data: {
      projectId: context.projectId,
      phaseId: input.phaseId ?? null,
      taskId: input.taskId ?? null,
      name: input.name,
      category: input.category,
      // Drive links are recognised by host, not claimed by the client (decision D-007).
      kind: isGoogleDriveUrl(input.url) ? 'GOOGLE_DRIVE' : 'LINK',
      url: input.url,
      fileType: input.fileType ?? null,
      version: input.version ?? null,
      description: input.description ?? null,
      addedById: actor.id,
    },
    select: DOCUMENT_SELECT,
  });

  await recordActivity(db, {
    projectId: context.projectId,
    actorId: actor.id,
    verb: 'added',
    summary: `${actor.fullName} added the document ${row.name}`,
    entityType: 'Document',
    entityId: row.id,
  });

  return toDocument(row);
}

export async function updateDocument(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<ProjectDocument> {
  assertProjectPermission(context, 'document:update');
  assertProjectMutable(context);

  const existing = await db.document.findFirst({
    where: { id: documentId, projectId: context.projectId, deletedAt: null },
    select: { id: true, name: true, addedById: true },
  });
  if (existing == null) throw notFound('That document');

  await assertPlacement(db, context.projectId, input.phaseId, input.taskId);

  const row = await db.document.update({
    where: { id: documentId },
    data: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.category != null ? { category: input.category } : {}),
      ...(input.url != null
        ? { url: input.url, kind: isGoogleDriveUrl(input.url) ? 'GOOGLE_DRIVE' : 'LINK' }
        : {}),
      ...(input.fileType !== undefined ? { fileType: input.fileType ?? null } : {}),
      ...(input.version !== undefined ? { version: input.version ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId ?? null } : {}),
    },
    select: DOCUMENT_SELECT,
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'document.updated',
    entityType: 'Document',
    entityId: documentId,
    oldValue: { name: existing.name },
    newValue: { name: row.name },
  });

  return toDocument(row);
}

export async function deleteDocument(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  documentId: string,
): Promise<void> {
  assertProjectPermission(context, 'document:delete');
  assertProjectMutable(context);

  const existing = await db.document.findFirst({
    where: { id: documentId, projectId: context.projectId, deletedAt: null },
    select: { id: true, name: true, url: true },
  });
  if (existing == null) throw notFound('That document');

  await db.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'document.deleted',
    entityType: 'Document',
    entityId: documentId,
    oldValue: { name: existing.name, url: existing.url },
  });
}

// ------------------------------------------------------------ personal notes

/**
 * Personal notes. Every query is keyed on the caller's own id; there is no parameter that
 * would let one user name another.
 */
export async function listPersonalNotes(
  db: Db,
  actor: Actor,
  query: ListNotesQuery,
): Promise<Paginated<PersonalNote>> {
  const where: Prisma.PersonalNoteWhereInput = {
    userId: actor.id,
    ...(query.pinnedOnly ? { pinned: true } : {}),
    ...(query.search != null
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { body: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.personalNote.count({ where }),
    db.personalNote.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      ...paginate(query),
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      reminderAt: row.reminderAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    meta: pageMeta(query, total),
  };
}

export async function createPersonalNote(
  db: Db,
  actor: Actor,
  input: CreatePersonalNoteInput,
): Promise<PersonalNote> {
  const row = await db.personalNote.create({
    data: {
      userId: actor.id,
      title: input.title,
      body: input.body,
      pinned: input.pinned,
      reminderAt: input.reminderAt == null ? null : new Date(input.reminderAt),
    },
  });

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    reminderAt: row.reminderAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updatePersonalNote(
  db: Db,
  actor: Actor,
  noteId: string,
  input: UpdatePersonalNoteInput,
): Promise<PersonalNote> {
  // The ownership check is part of the query, not a separate branch that could be skipped.
  const existing = await db.personalNote.findFirst({
    where: { id: noteId, userId: actor.id },
    select: { id: true },
  });
  if (existing == null) throw notFound('That note');

  const row = await db.personalNote.update({
    where: { id: noteId },
    data: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.body != null ? { body: input.body } : {}),
      ...(input.pinned != null ? { pinned: input.pinned } : {}),
      ...(input.reminderAt !== undefined
        ? { reminderAt: input.reminderAt == null ? null : new Date(input.reminderAt) }
        : {}),
    },
  });

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    reminderAt: row.reminderAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deletePersonalNote(db: Db, actor: Actor, noteId: string): Promise<void> {
  const deleted = await db.personalNote.deleteMany({ where: { id: noteId, userId: actor.id } });
  if (deleted.count === 0) throw notFound('That note');
}

// ------------------------------------------------------------- project notes

const PROJECT_NOTE_SELECT = {
  id: true,
  title: true,
  body: true,
  visibility: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  phase: { select: { id: true, name: true } },
  author: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.ProjectNoteSelect;

type ProjectNoteRow = Prisma.ProjectNoteGetPayload<{ select: typeof PROJECT_NOTE_SELECT }>;

function toProjectNote(row: ProjectNoteRow): ProjectNote {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    pinned: row.pinned,
    phase: row.phase,
    author: toUserSummary(row.author),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjectNotes(
  db: Db,
  context: ProjectContext,
  query: ListNotesQuery,
): Promise<Paginated<ProjectNote>> {
  assertProjectPermission(context, 'note:project-read');

  // A leads-only note is hidden from members and viewers.
  const seesLeadNotes =
    context.permissions.has('note:project-write') && context.projectRole === 'LEAD';

  const where: Prisma.ProjectNoteWhereInput = {
    projectId: context.projectId,
    ...(seesLeadNotes || context.permissions.has('project:archive')
      ? {}
      : { visibility: 'PROJECT' }),
    ...(query.pinnedOnly ? { pinned: true } : {}),
    ...(query.search != null
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { body: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.projectNote.count({ where }),
    db.projectNote.findMany({
      where,
      select: PROJECT_NOTE_SELECT,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      ...paginate(query),
    }),
  ]);

  return { data: rows.map(toProjectNote), meta: pageMeta(query, total) };
}

export async function createProjectNote(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  input: CreateProjectNoteInput,
): Promise<ProjectNote> {
  assertProjectPermission(context, 'note:project-write');
  assertProjectMutable(context);
  await assertPlacement(db, context.projectId, input.phaseId, undefined);

  const row = await db.projectNote.create({
    data: {
      projectId: context.projectId,
      phaseId: input.phaseId ?? null,
      authorId: actor.id,
      title: input.title,
      body: input.body,
      visibility: input.visibility,
      pinned: input.pinned,
    },
    select: PROJECT_NOTE_SELECT,
  });

  return toProjectNote(row);
}

export async function updateProjectNote(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  noteId: string,
  input: UpdateProjectNoteInput,
): Promise<ProjectNote> {
  assertProjectPermission(context, 'note:project-write');
  assertProjectMutable(context);

  const existing = await db.projectNote.findFirst({
    where: { id: noteId, projectId: context.projectId },
    select: { id: true, authorId: true },
  });
  if (existing == null) throw notFound('That note');

  // Members edit their own notes; a lead may edit any note in the project.
  if (existing.authorId !== actor.id && context.projectRole !== 'LEAD') {
    assertProjectPermission(context, 'project:update', 'You can only edit notes you wrote.');
  }

  const row = await db.projectNote.update({
    where: { id: noteId },
    data: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.body != null ? { body: input.body } : {}),
      ...(input.visibility != null ? { visibility: input.visibility } : {}),
      ...(input.pinned != null ? { pinned: input.pinned } : {}),
      ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
    },
    select: PROJECT_NOTE_SELECT,
  });

  return toProjectNote(row);
}

export async function deleteProjectNote(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  noteId: string,
): Promise<void> {
  assertProjectPermission(context, 'note:project-write');
  assertProjectMutable(context);

  const existing = await db.projectNote.findFirst({
    where: { id: noteId, projectId: context.projectId },
    select: { id: true, authorId: true },
  });
  if (existing == null) throw notFound('That note');

  if (existing.authorId !== actor.id && context.projectRole !== 'LEAD') {
    assertProjectPermission(context, 'project:update', 'You can only delete notes you wrote.');
  }

  await db.projectNote.delete({ where: { id: noteId } });
}

// ------------------------------------------------------------- decision log

const DECISION_SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  reason: true,
  decidedOn: true,
  createdAt: true,
  phase: { select: { id: true, name: true } },
  task: { select: { id: true, reference: true } },
  document: { select: { id: true, name: true, url: true } },
  decisionMaker: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.DecisionLogSelect;

type DecisionRow = Prisma.DecisionLogGetPayload<{ select: typeof DECISION_SELECT }>;

function toDecision(row: DecisionRow): DecisionLogEntry {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    reason: row.reason,
    decidedOn: dateColumnToDateOnly(row.decidedOn) as DateOnly,
    decisionMaker: toUserSummaryOrNull(row.decisionMaker),
    phase: row.phase,
    task: row.task,
    document: row.document,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listDecisions(db: Db, context: ProjectContext): Promise<DecisionLogEntry[]> {
  assertProjectPermission(context, 'project:read');
  const rows = await db.decisionLog.findMany({
    where: { projectId: context.projectId },
    select: DECISION_SELECT,
    orderBy: { decidedOn: 'desc' },
    take: 500,
  });
  return rows.map(toDecision);
}

export async function createDecision(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateDecisionInput,
): Promise<DecisionLogEntry> {
  assertProjectPermission(context, 'decision:manage');
  assertProjectMutable(context);
  await assertPlacement(db, context.projectId, input.phaseId, input.taskId);

  const row = await db.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: context.projectId },
      data: { decisionCounter: { increment: 1 } },
      select: { decisionCounter: true },
    });

    const created = await tx.decisionLog.create({
      data: {
        projectId: context.projectId,
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        documentId: input.documentId ?? null,
        reference: `D-${project.decisionCounter}`,
        title: input.title,
        description: input.description ?? null,
        reason: input.reason ?? null,
        decidedOn: dateOnlyToDateColumn(input.decidedOn) as Date,
        decisionMakerId: input.decisionMakerId,
      },
      select: DECISION_SELECT,
    });

    await recordActivity(tx, {
      projectId: context.projectId,
      actorId: actor.id,
      verb: 'recorded',
      summary: `${actor.fullName} recorded the decision ${created.reference}: ${created.title}`,
      entityType: 'DecisionLog',
      entityId: created.id,
    });

    return created;
  });

  return toDecision(row);
}

export async function updateDecision(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  decisionId: string,
  input: UpdateDecisionInput,
): Promise<DecisionLogEntry> {
  assertProjectPermission(context, 'decision:manage');
  assertProjectMutable(context);

  const existing = await db.decisionLog.findFirst({
    where: { id: decisionId, projectId: context.projectId },
    select: { id: true, title: true },
  });
  if (existing == null) throw notFound('That decision');

  const row = await db.decisionLog.update({
    where: { id: decisionId },
    data: {
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.reason !== undefined ? { reason: input.reason ?? null } : {}),
      ...(input.decidedOn != null
        ? { decidedOn: dateOnlyToDateColumn(input.decidedOn) as Date }
        : {}),
      ...(input.decisionMakerId != null ? { decisionMakerId: input.decisionMakerId } : {}),
      ...(input.phaseId !== undefined ? { phaseId: input.phaseId ?? null } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId ?? null } : {}),
      ...(input.documentId !== undefined ? { documentId: input.documentId ?? null } : {}),
    },
    select: DECISION_SELECT,
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'decision.updated',
    entityType: 'DecisionLog',
    entityId: decisionId,
    oldValue: { title: existing.title },
    newValue: { title: row.title },
  });

  return toDecision(row);
}

export async function deleteDecision(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  decisionId: string,
): Promise<void> {
  assertProjectPermission(context, 'decision:manage');
  assertProjectMutable(context);

  const existing = await db.decisionLog.findFirst({
    where: { id: decisionId, projectId: context.projectId },
    select: { id: true, reference: true, title: true },
  });
  if (existing == null) throw notFound('That decision');

  await db.decisionLog.delete({ where: { id: decisionId } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'decision.deleted',
    entityType: 'DecisionLog',
    entityId: decisionId,
    oldValue: { reference: existing.reference, title: existing.title },
  });
}

// ------------------------------------------------------------------ helpers

/** A phase or task referenced by content must belong to the same project. */
async function assertPlacement(
  db: Db,
  projectId: string,
  phaseId: string | null | undefined,
  taskId: string | null | undefined,
): Promise<void> {
  if (phaseId != null) {
    const found = await db.phase.count({ where: { id: phaseId, projectId } });
    if (found === 0) throw notFound('That phase');
  }
  if (taskId != null) {
    const found = await db.task.count({ where: { id: taskId, projectId, deletedAt: null } });
    if (found === 0) throw notFound('That task');
  }
}
