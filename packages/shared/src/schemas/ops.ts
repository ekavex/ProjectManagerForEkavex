/** Notifications, reports, audit, search and the Excel import pipeline. */
import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../enums.js';
import { dateOnlySchema, idSchema, paginationSchema, shortText } from './common.js';

// -------------------------------------------------------------------- notifications

export const listNotificationsQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  projectId: idSchema.optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * Deadline rules (spec section 41). `offsetDays` is days before the due date; zero means
 * "due today" and a negative value means "days after the due date", used for the overdue
 * escalation ladder.
 */
export const notificationRuleSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  offsetDays: z.number().int().min(-90).max(90),
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  /** Also notify the project lead, not just the assignee. */
  notifyLead: z.boolean(),
});

export const updateNotificationRulesSchema = z.object({
  rules: z.array(notificationRuleSchema).max(100),
});
export type UpdateNotificationRulesInput = z.infer<typeof updateNotificationRulesSchema>;

// -------------------------------------------------------------------------- reports

export const dailyReportQuerySchema = z.object({
  date: dateOnlySchema.optional(),
});
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

export const weeklyReportQuerySchema = z.object({
  /** Any date inside the week; the report covers the Monday-to-Sunday week containing it. */
  weekOf: dateOnlySchema.optional(),
});
export type WeeklyReportQuery = z.infer<typeof weeklyReportQuerySchema>;

export const workloadQuerySchema = z.object({
  projectId: idSchema.optional(),
  departmentId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type WorkloadQuery = z.infer<typeof workloadQuerySchema>;

// ---------------------------------------------------------------------------- audit

export const listAuditQuerySchema = paginationSchema.extend({
  entityType: shortText(60).optional(),
  entityId: idSchema.optional(),
  actorId: idSchema.optional(),
  action: shortText(80).optional(),
  projectId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const listActivityQuerySchema = paginationSchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  actorId: idSchema.optional(),
});
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

// --------------------------------------------------------------------------- search

export const SEARCH_TYPES = [
  'PROJECT',
  'TASK',
  'USER',
  'DOCUMENT',
  'MESSAGE',
  'NOTE',
  'RISK',
  'ISSUE',
  'CHANGE_REQUEST',
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  types: z
    .union([z.enum(SEARCH_TYPES), z.array(z.enum(SEARCH_TYPES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

// --------------------------------------------------------------------- excel import

export const IMPORT_TARGET_FIELDS = [
  'IGNORE',
  'WBS_CODE',
  'PHASE_NAME',
  'TASK_NAME',
  'DESCRIPTION',
  'OWNER_EMAIL',
  'OWNER_NAME',
  'START_DATE',
  'DUE_DATE',
  'ESTIMATED_HOURS',
  'STATUS',
  'PROGRESS',
  'PRIORITY',
  'PREDECESSOR',
  'MILESTONE',
  'RACI_RESPONSIBLE',
  'RACI_ACCOUNTABLE',
  'RACI_CONSULTED',
  'RACI_INFORMED',
] as const;
export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

export const importMappingSchema = z.object({
  sheet: shortText(120),
  headerRow: z.number().int().min(1).max(100).default(1),
  /** Spreadsheet column header to Ekavist field. Unmapped columns are ignored. */
  columns: z.record(z.string().max(200), z.enum(IMPORT_TARGET_FIELDS)),
  /** Create users that the sheet references but the system does not know. */
  createMissingUsers: z.boolean().default(false),
});
export type ImportMappingInput = z.infer<typeof importMappingSchema>;

export const confirmImportSchema = z.object({
  /** Echo of the job's checksum, so a stale preview cannot be confirmed. */
  checksum: z.string().min(8).max(128),
});
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;
