import { z } from 'zod';
import { RESOURCE_KINDS } from '../enums.js';
import { dateOnlySchema, idSchema, paginationSchema, shortText, urlSchema } from './common.js';

/**
 * A link carried by a message. Google Drive links are detected server-side from the host
 * and stored with `kind = GOOGLE_DRIVE`, so the client cannot mislabel a resource.
 */
export const messageLinkSchema = z.object({
  url: urlSchema,
  name: shortText(250).optional(),
});

export const createMessageSchema = z
  .object({
    body: z.string().trim().max(10000).default(''),
    parentId: idSchema.optional(),
    links: z.array(messageLinkSchema).max(10).default([]),
    /** Ids of files already uploaded through POST /uploads. */
    attachmentIds: z.array(idSchema).max(10).default([]),
    mentionUserIds: z.array(idSchema).max(50).default([]),
  })
  .refine((v) => v.body.length > 0 || v.links.length > 0 || v.attachmentIds.length > 0, {
    path: ['body'],
    message: 'A message needs text, a link or an attachment.',
  });
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const updateMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;

export const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});
export type ReactionInput = z.infer<typeof reactionSchema>;

export const MESSAGE_FILTERS = [
  'ALL',
  'MESSAGES',
  'FILES',
  'LINKS',
  'GOOGLE_DRIVE',
  'PINNED',
  'MINE',
] as const;
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

export const listMessagesQuerySchema = paginationSchema.extend({
  /** Full-text search over message bodies and attachment names. */
  search: z.string().trim().max(200).optional(),
  filter: z.enum(MESSAGE_FILTERS).default('ALL'),
  userId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Fetch a thread instead of the channel root. */
  parentId: idSchema.optional(),
  /** Cursor for infinite scroll; when present, page is ignored. */
  before: z.string().datetime({ offset: true }).optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const listResourcesQuerySchema = paginationSchema.extend({
  kind: z.enum(RESOURCE_KINDS).optional(),
  search: z.string().trim().max(200).optional(),
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
  pinnedOnly: z.coerce.boolean().default(false),
});
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;
