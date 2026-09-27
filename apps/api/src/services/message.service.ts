/**
 * Project chat (spec sections 31 to 35).
 *
 * Search runs in the database. `message_body_fts_idx` is a GIN index over
 * `to_tsvector('english', body)`, and the search path below uses it through a tagged
 * template with bound parameters. The browser never receives the whole history to filter
 * (master prompt section 24).
 */
import {
  ERROR_CODES,
  type CreateMessageInput,
  type ListMessagesQuery,
  type ListResourcesQuery,
  type Message,
  type Paginated,
  type ReactionInput,
  type SharedResource,
  type UpdateMessageInput,
} from '@ekavist/shared';
import { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { emitToProject } from '../realtime/emitter.js';
import { recordAudit } from './audit.service.js';
import { notifyMany } from './notification.service.js';
import { pageMeta, paginate } from './pagination.js';
import { isGoogleDriveUrl } from './task.service.js';
import { USER_SUMMARY_SELECT, toUserSummary, toUserSummaryOrNull } from './user.mapper.js';

const MESSAGE_SELECT = {
  id: true,
  projectId: true,
  parentId: true,
  body: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  author: { select: USER_SUMMARY_SELECT },
  attachments: {
    select: {
      id: true,
      kind: true,
      name: true,
      url: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
  mentions: { select: { user: { select: USER_SUMMARY_SELECT } } },
  reactions: { select: { emoji: true, userId: true } },
  pin: { select: { pinnedAt: true, pinnedBy: { select: USER_SUMMARY_SELECT } } },
  _count: { select: { replies: true } },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

function toMessage(row: MessageRow): Message {
  const reactions = new Map<string, string[]>();
  for (const reaction of row.reactions) {
    const users = reactions.get(reaction.emoji);
    if (users) users.push(reaction.userId);
    else reactions.set(reaction.emoji, [reaction.userId]);
  }

  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    author: toUserSummary(row.author),
    // A deleted message keeps its place in the thread so replies still make sense.
    body: row.deletedAt != null ? '' : row.body,
    attachments:
      row.deletedAt != null
        ? []
        : row.attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            name: attachment.name,
            url: attachment.url,
            sizeBytes: attachment.sizeBytes,
            mimeType: attachment.mimeType,
            addedBy: null,
            createdAt: attachment.createdAt.toISOString(),
          })),
    mentions: row.mentions.map((mention) => toUserSummary(mention.user)),
    reactions: [...reactions.entries()].map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
    })),
    replyCount: row._count.replies,
    isPinned: row.pin != null,
    pinnedBy: toUserSummaryOrNull(row.pin?.pinnedBy),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------- list

export async function listMessages(
  db: Db,
  context: ProjectContext,
  query: ListMessagesQuery,
): Promise<Paginated<Message>> {
  assertProjectPermission(context, 'chat:read');

  // Full-text search needs the GIN index, so the matching ids come from raw SQL and the
  // rows themselves are then loaded through Prisma with the usual select.
  let searchIds: string[] | null = null;
  if (query.search != null && query.search.trim().length > 0) {
    searchIds = await searchMessageIds(db, context.projectId, query.search);
    if (searchIds.length === 0) {
      return { data: [], meta: pageMeta(query, 0) };
    }
  }

  const where: Prisma.MessageWhereInput = {
    projectId: context.projectId,
    deletedAt: null,
    // The channel shows roots; a thread is fetched explicitly.
    ...(query.parentId != null ? { parentId: query.parentId } : { parentId: null }),
    ...(searchIds != null ? { id: { in: searchIds } } : {}),
    ...(query.userId != null ? { authorId: query.userId } : {}),
    ...(query.before != null ? { createdAt: { lt: new Date(query.before) } } : {}),
    ...(query.from != null || query.to != null
      ? {
          createdAt: {
            ...(query.from != null ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to != null ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...filterClause(query.filter),
  };

  const [total, rows] = await Promise.all([
    db.message.count({ where }),
    db.message.findMany({
      where,
      select: MESSAGE_SELECT,
      orderBy: { createdAt: 'desc' },
      ...paginate(query),
    }),
  ]);

  return { data: rows.map(toMessage), meta: pageMeta(query, total) };
}

/** The chat filters from spec section 33, expressed as query fragments. */
function filterClause(filter: ListMessagesQuery['filter']): Prisma.MessageWhereInput {
  switch (filter) {
    case 'MESSAGES':
      return { attachments: { none: {} } };
    case 'FILES':
      return { attachments: { some: { kind: 'FILE' } } };
    case 'LINKS':
      return { attachments: { some: { kind: { in: ['LINK', 'GOOGLE_DRIVE'] } } } };
    case 'GOOGLE_DRIVE':
      return { attachments: { some: { kind: 'GOOGLE_DRIVE' } } };
    case 'PINNED':
      return { pin: { isNot: null } };
    default:
      return {};
  }
}

/**
 * Matches the search term against message bodies and attachment names.
 *
 * `plainto_tsquery` treats the input as plain words rather than query syntax, so a user
 * typing `architecture & design` gets a sensible search instead of a syntax error.
 */
async function searchMessageIds(db: Db, projectId: string, term: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT m."id"
    FROM "Message" m
    WHERE m."projectId" = ${projectId}
      AND m."deletedAt" IS NULL
      AND (
        to_tsvector('english', m."body") @@ plainto_tsquery('english', ${term})
        OR m."body" ILIKE ${'%' + term + '%'}
        OR EXISTS (
          SELECT 1 FROM "MessageAttachment" a
          WHERE a."messageId" = m."id" AND a."name" ILIKE ${'%' + term + '%'}
        )
      )
    LIMIT 500
  `;
  return rows.map((row) => row.id);
}

export async function listPinned(db: Db, context: ProjectContext): Promise<Message[]> {
  assertProjectPermission(context, 'chat:read');
  const rows = await db.message.findMany({
    where: { projectId: context.projectId, deletedAt: null, pin: { isNot: null } },
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(toMessage);
}

// -------------------------------------------------------------------- create

export async function createMessage(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateMessageInput,
): Promise<Message> {
  assertProjectPermission(context, 'chat:post');
  assertProjectMutable(context);

  if (input.parentId != null) {
    const parent = await db.message.count({
      where: { id: input.parentId, projectId: context.projectId, deletedAt: null },
    });
    if (parent === 0) throw notFound('That message');
  }

  // Mentions only reach people who are actually on the project.
  const mentionIds = await filterToMembers(db, context.projectId, input.mentionUserIds);

  const messageId = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        projectId: context.projectId,
        parentId: input.parentId ?? null,
        authorId: actor.id,
        body: input.body,
        attachments: {
          create: input.links.map((link) => ({
            // The kind is decided here, from the host, so a client cannot mislabel a
            // resource as a Drive link (decision D-007).
            kind: isGoogleDriveUrl(link.url) ? 'GOOGLE_DRIVE' : 'LINK',
            name: link.name ?? link.url,
            url: link.url,
          })),
        },
        mentions: { create: mentionIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return created.id;
  });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:created', {
    projectId: context.projectId,
    message,
  });

  await notifyMentions(db, actor, context.projectId, message, mentionIds);

  return message;
}

export async function updateMessage(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
  input: UpdateMessageInput,
): Promise<Message> {
  assertProjectMutable(context);

  const existing = await db.message.findFirst({
    where: { id: messageId, projectId: context.projectId, deletedAt: null },
    select: { id: true, authorId: true, body: true },
  });
  if (existing == null) throw notFound('That message');

  // Editing is the author's alone: a lead may remove a message but not rewrite it.
  if (existing.authorId !== actor.id) {
    throw new AppError(ERROR_CODES.MESSAGE_NOT_EDITABLE, 'You can only edit your own messages.');
  }

  await db.message.update({
    where: { id: messageId },
    data: { body: input.body, editedAt: new Date() },
  });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:updated', { projectId: context.projectId, message });
  return message;
}

export async function deleteMessage(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
): Promise<void> {
  assertProjectMutable(context);

  const existing = await db.message.findFirst({
    where: { id: messageId, projectId: context.projectId, deletedAt: null },
    select: { id: true, authorId: true, body: true },
  });
  if (existing == null) throw notFound('That message');

  const isOwn = existing.authorId === actor.id;
  if (!isOwn) assertProjectPermission(context, 'chat:delete-any');

  await db.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'chat.message-deleted',
    entityType: 'Message',
    entityId: messageId,
    oldValue: { authorId: existing.authorId, body: existing.body.slice(0, 500) },
  });

  emitToProject(context.projectId, 'message:deleted', { projectId: context.projectId, messageId });
}

// ----------------------------------------------------------------- reactions

export async function addReaction(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
  input: ReactionInput,
): Promise<Message> {
  assertProjectPermission(context, 'chat:post');
  assertProjectMutable(context);

  const exists = await db.message.count({
    where: { id: messageId, projectId: context.projectId, deletedAt: null },
  });
  if (exists === 0) throw notFound('That message');

  await db.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId: actor.id, emoji: input.emoji } },
    create: { messageId, userId: actor.id, emoji: input.emoji },
    update: {},
  });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:reaction', { projectId: context.projectId, message });
  return message;
}

export async function removeReaction(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
  input: ReactionInput,
): Promise<Message> {
  assertProjectMutable(context);

  await db.messageReaction.deleteMany({
    where: { messageId, userId: actor.id, emoji: input.emoji },
  });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:reaction', { projectId: context.projectId, message });
  return message;
}

// -------------------------------------------------------------------- pinning

export async function pinMessage(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
): Promise<Message> {
  assertProjectPermission(context, 'chat:pin');
  assertProjectMutable(context);

  const existing = await db.message.findFirst({
    where: { id: messageId, projectId: context.projectId, deletedAt: null },
    select: { id: true, body: true, pin: { select: { id: true } } },
  });
  if (existing == null) throw notFound('That message');
  if (existing.pin != null) {
    throw new AppError(ERROR_CODES.MESSAGE_ALREADY_PINNED, 'That message is already pinned.');
  }

  await db.pinnedMessage.create({ data: { messageId, pinnedById: actor.id } });
  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'chat.message-pinned',
    entityType: 'Message',
    entityId: messageId,
    newValue: { excerpt: existing.body.slice(0, 200) },
  });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:pinned', { projectId: context.projectId, message });

  const audience = await db.projectMember.findMany({
    where: { projectId: context.projectId, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  await notifyMany(
    db,
    audience.map((member) => member.userId),
    (userId) => ({
      userId,
      type: 'MESSAGE_PINNED',
      title: 'A message was pinned',
      body: `${actor.fullName} pinned: ${existing.body.slice(0, 140)}`,
      projectId: context.projectId,
      entityType: 'Message',
      entityId: messageId,
      link: `/projects/${context.projectId}/chat?message=${messageId}`,
    }),
    [actor.id],
  );

  return message;
}

export async function unpinMessage(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  messageId: string,
): Promise<Message> {
  assertProjectMutable(context);

  const pin = await db.pinnedMessage.findUnique({
    where: { messageId },
    select: { id: true, pinnedById: true, message: { select: { projectId: true } } },
  });
  if (pin == null || pin.message.projectId !== context.projectId) {
    throw new AppError(ERROR_CODES.MESSAGE_NOT_PINNED, 'That message is not pinned.');
  }

  // A member may unpin what they pinned; removing someone else's pin is a lead's call.
  if (pin.pinnedById !== actor.id) {
    assertProjectPermission(
      context,
      'chat:delete-any',
      'Only a project lead can unpin someone else’s message.',
    );
  }

  await db.pinnedMessage.delete({ where: { id: pin.id } });

  const message = await loadMessage(db, context.projectId, messageId);
  emitToProject(context.projectId, 'message:unpinned', {
    projectId: context.projectId,
    messageId,
  });
  return message;
}

// ---------------------------------------------------------- resource library

/**
 * The project resource library (spec section 35): everything shared anywhere in the
 * project, in one list — chat attachments, task attachments and documents.
 *
 * The three sources are three tables, so the ordering and the page boundary are decided
 * by a UNION in the database and only the requested page is hydrated. The first version
 * read up to 500 rows from each table, merged them in memory and sliced the result: that
 * reads the whole library to show twenty rows of it, and silently loses rows once a
 * project passes the cap.
 */
export async function listResources(
  db: Db,
  context: ProjectContext,
  query: ListResourcesQuery,
): Promise<Paginated<SharedResource>> {
  assertProjectPermission(context, 'document:read');

  const union = resourceUnion(context.projectId, query);

  const [counts, keys] = await Promise.all([
    db.$queryRaw<{ count: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS "count" FROM (${union}) AS r`,
    ),
    db.$queryRaw<ResourceKey[]>(
      Prisma.sql`
        SELECT r."id", r."source" FROM (${union}) AS r
        ORDER BY r."createdAt" DESC, r."id" DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      `,
    ),
  ]);

  const total = counts[0]?.count ?? 0;
  const idsFor = (source: ResourceKey['source']): string[] =>
    keys.filter((key) => key.source === source).map((key) => key.id);

  const [chat, taskFiles, documents] = await Promise.all([
    idsFor('MESSAGE').length === 0
      ? []
      : db.messageAttachment.findMany({
          where: { id: { in: idsFor('MESSAGE') } },
          select: {
            id: true,
            kind: true,
            name: true,
            url: true,
            createdAt: true,
            message: { select: { author: { select: USER_SUMMARY_SELECT } } },
          },
        }),
    idsFor('TASK').length === 0
      ? []
      : db.taskAttachment.findMany({
          where: { id: { in: idsFor('TASK') } },
          select: {
            id: true,
            kind: true,
            name: true,
            url: true,
            createdAt: true,
            addedBy: { select: USER_SUMMARY_SELECT },
            task: {
              select: { id: true, reference: true, phase: { select: { id: true, name: true } } },
            },
          },
        }),
    idsFor('DOCUMENT').length === 0
      ? []
      : db.document.findMany({
          where: { id: { in: idsFor('DOCUMENT') } },
          select: {
            id: true,
            kind: true,
            name: true,
            url: true,
            createdAt: true,
            addedBy: { select: USER_SUMMARY_SELECT },
            phase: { select: { id: true, name: true } },
            task: { select: { id: true, reference: true } },
          },
        }),
  ]);

  // Keyed by source as well as id so the three tables cannot collide, and reassembled in
  // the order the union decided rather than the order the hydration happened to return.
  const byKey = new Map<string, SharedResource>();

  for (const row of chat) {
    byKey.set(`MESSAGE:${row.id}`, {
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url,
      addedBy: toUserSummaryOrNull(row.message.author),
      source: 'MESSAGE',
      phase: null,
      task: null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  for (const row of taskFiles) {
    byKey.set(`TASK:${row.id}`, {
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url,
      addedBy: toUserSummaryOrNull(row.addedBy),
      source: 'TASK',
      phase: row.task.phase,
      task: { id: row.task.id, reference: row.task.reference },
      createdAt: row.createdAt.toISOString(),
    });
  }
  for (const row of documents) {
    byKey.set(`DOCUMENT:${row.id}`, {
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url,
      addedBy: toUserSummaryOrNull(row.addedBy),
      source: 'DOCUMENT',
      phase: row.phase,
      task: row.task,
      createdAt: row.createdAt.toISOString(),
    });
  }

  const data = keys
    .map((key) => byKey.get(`${key.source}:${key.id}`))
    .filter((row): row is SharedResource => row != null);

  return { data, meta: pageMeta(query, total) };
}

interface ResourceKey {
  id: string;
  source: 'MESSAGE' | 'TASK' | 'DOCUMENT';
}

/**
 * The three halves of the resource library as one orderable set of (id, source, createdAt).
 *
 * Only the columns the page boundary needs are selected: the rows themselves are read back
 * through Prisma afterwards, so the shape of a resource stays defined in one place.
 */
function resourceUnion(projectId: string, query: ListResourcesQuery): Prisma.Sql {
  const like = query.search == null ? null : `%${query.search}%`;
  const kind = (column: Prisma.Sql): Prisma.Sql =>
    query.kind == null ? Prisma.empty : Prisma.sql`AND ${column} = ${query.kind}::"ResourceKind"`;
  const named = (column: Prisma.Sql): Prisma.Sql =>
    like == null ? Prisma.empty : Prisma.sql`AND ${column} ILIKE ${like}`;

  const parts: Prisma.Sql[] = [
    Prisma.sql`
      SELECT ma."id" AS "id", 'MESSAGE' AS "source", ma."createdAt" AS "createdAt"
      FROM "MessageAttachment" ma
      JOIN "Message" m ON m."id" = ma."messageId"
      WHERE m."projectId" = ${projectId}
        AND m."deletedAt" IS NULL
        ${kind(Prisma.sql`ma."kind"`)}
        ${named(Prisma.sql`ma."name"`)}
        ${
          query.pinnedOnly
            ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PinnedMessage" pm WHERE pm."messageId" = m."id")`
            : Prisma.empty
        }
    `,
  ];

  // A request for pinned material is a request about the conversation; task files and
  // documents cannot be pinned, so they are not searched at all.
  if (!query.pinnedOnly) {
    parts.push(Prisma.sql`
      SELECT ta."id" AS "id", 'TASK' AS "source", ta."createdAt" AS "createdAt"
      FROM "TaskAttachment" ta
      JOIN "Task" t ON t."id" = ta."taskId"
      WHERE t."projectId" = ${projectId}
        AND t."deletedAt" IS NULL
        ${query.taskId == null ? Prisma.empty : Prisma.sql`AND t."id" = ${query.taskId}`}
        ${query.phaseId == null ? Prisma.empty : Prisma.sql`AND t."phaseId" = ${query.phaseId}`}
        ${kind(Prisma.sql`ta."kind"`)}
        ${named(Prisma.sql`ta."name"`)}
    `);

    parts.push(Prisma.sql`
      SELECT d."id" AS "id", 'DOCUMENT' AS "source", d."createdAt" AS "createdAt"
      FROM "Document" d
      WHERE d."projectId" = ${projectId}
        AND d."deletedAt" IS NULL
        ${query.taskId == null ? Prisma.empty : Prisma.sql`AND d."taskId" = ${query.taskId}`}
        ${query.phaseId == null ? Prisma.empty : Prisma.sql`AND d."phaseId" = ${query.phaseId}`}
        ${kind(Prisma.sql`d."kind"`)}
        ${named(Prisma.sql`d."name"`)}
    `);
  }

  return Prisma.join(parts, ' UNION ALL ');
}

// ------------------------------------------------------------------ helpers

async function loadMessage(db: Db, projectId: string, messageId: string): Promise<Message> {
  const row = await db.message.findFirst({
    where: { id: messageId, projectId },
    select: MESSAGE_SELECT,
  });
  if (row == null) throw notFound('That message');
  return toMessage(row);
}

async function filterToMembers(
  db: Db,
  projectId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const members = await db.projectMember.findMany({
    where: { projectId, userId: { in: [...new Set(userIds)] } },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

async function notifyMentions(
  db: Db,
  actor: Actor,
  projectId: string,
  message: Message,
  mentionIds: readonly string[],
): Promise<void> {
  if (mentionIds.length === 0) return;

  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true },
  });

  await notifyMany(
    db,
    mentionIds,
    (userId) => ({
      userId,
      type: 'MENTION',
      title: `${actor.fullName} mentioned you`,
      body: message.body.slice(0, 200),
      projectId,
      entityType: 'Message',
      entityId: message.id,
      link: `/projects/${projectId}/chat?message=${message.id}`,
      email: {
        template: 'mention',
        payload: {
          projectId,
          projectName: project.name,
          messageId: message.id,
          authorName: actor.fullName,
          excerpt: message.body.slice(0, 200),
        },
      },
    }),
    [actor.id],
  );
}
