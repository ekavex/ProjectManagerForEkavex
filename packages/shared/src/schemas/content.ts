/** Documents, notes and the decision log. */
import { z } from 'zod';
import { DOCUMENT_CATEGORIES, NOTE_VISIBILITIES } from '../enums.js';
import {
  dateOnlySchema,
  idSchema,
  longText,
  paginationSchema,
  shortText,
  sortableQuery,
  urlSchema,
} from './common.js';

// ------------------------------------------------------------------------ documents

export const createDocumentSchema = z.object({
  name: shortText(250),
  category: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
  url: urlSchema,
  fileType: shortText(40).optional(),
  version: shortText(40).optional(),
  description: longText(5000),
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentSchema.partial();
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const listDocumentsQuerySchema = sortableQuery(
  ['name', 'category', 'createdAt', 'version'],
  'createdAt',
).extend({
  search: z.string().trim().max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// ---------------------------------------------------------------------------- notes

export const createPersonalNoteSchema = z.object({
  title: shortText(200),
  body: z.string().trim().max(50000).default(''),
  pinned: z.boolean().default(false),
  /** Free reference only; a personal note is never joined to a project query. */
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreatePersonalNoteInput = z.infer<typeof createPersonalNoteSchema>;

export const updatePersonalNoteSchema = createPersonalNoteSchema.partial();
export type UpdatePersonalNoteInput = z.infer<typeof updatePersonalNoteSchema>;

export const createProjectNoteSchema = z.object({
  title: shortText(200),
  body: z.string().trim().max(50000).default(''),
  visibility: z.enum(NOTE_VISIBILITIES).default('PROJECT'),
  phaseId: idSchema.optional(),
  pinned: z.boolean().default(false),
});
export type CreateProjectNoteInput = z.infer<typeof createProjectNoteSchema>;

export const updateProjectNoteSchema = createProjectNoteSchema.partial();
export type UpdateProjectNoteInput = z.infer<typeof updateProjectNoteSchema>;

export const listNotesQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  pinnedOnly: z.coerce.boolean().default(false),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

// --------------------------------------------------------------------- decision log

export const createDecisionSchema = z.object({
  title: shortText(250),
  description: longText(20000),
  reason: longText(20000),
  decidedOn: dateOnlySchema,
  decisionMakerId: idSchema,
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
  documentId: idSchema.optional(),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const updateDecisionSchema = createDecisionSchema.partial();
export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;
