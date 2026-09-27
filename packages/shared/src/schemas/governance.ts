/** Risks, issues and change requests. */
import { z } from 'zod';
import {
  CHANGE_REQUEST_STATUSES,
  ISSUE_STATUSES,
  PRIORITIES,
  RISK_LEVELS,
  RISK_STATUSES,
} from '../enums.js';
import { dateOnlySchema, idSchema, longText, shortText, sortableQuery } from './common.js';

// ---------------------------------------------------------------------------- risks

/**
 * Severity is **not** accepted from the client: it is derived from probability and impact
 * by `domain/risk.ts` so two risks with the same inputs can never disagree.
 */
export const createRiskSchema = z.object({
  title: shortText(250),
  description: longText(20000),
  probability: z.enum(RISK_LEVELS),
  impact: z.enum(RISK_LEVELS),
  ownerId: idSchema.optional(),
  mitigation: longText(20000),
  contingency: longText(20000),
  status: z.enum(RISK_STATUSES).default('OPEN'),
  dueDate: dateOnlySchema.optional(),
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
});
export type CreateRiskInput = z.infer<typeof createRiskSchema>;

export const updateRiskSchema = createRiskSchema.partial();
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;

export const listRisksQuerySchema = sortableQuery(
  ['reference', 'title', 'severity', 'status', 'dueDate', 'createdAt'],
  'severity',
).extend({
  status: z.enum(RISK_STATUSES).optional(),
  severity: z.enum(RISK_LEVELS).optional(),
  ownerId: idSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListRisksQuery = z.infer<typeof listRisksQuerySchema>;

// --------------------------------------------------------------------------- issues

export const createIssueSchema = z.object({
  title: shortText(250),
  description: longText(20000),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  ownerId: idSchema.optional(),
  identifiedOn: dateOnlySchema.optional(),
  targetResolution: dateOnlySchema.optional(),
  status: z.enum(ISSUE_STATUSES).default('OPEN'),
  resolution: longText(20000),
  phaseId: idSchema.optional(),
  taskId: idSchema.optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = createIssueSchema.partial();
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const listIssuesQuerySchema = sortableQuery(
  ['reference', 'title', 'priority', 'status', 'targetResolution', 'createdAt'],
  'createdAt',
).extend({
  status: z.enum(ISSUE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerId: idSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;

// ------------------------------------------------------------------- change requests

export const createChangeRequestSchema = z.object({
  title: shortText(250),
  description: longText(20000),
  reason: longText(20000),
  requestedOn: dateOnlySchema.optional(),
  phaseId: idSchema.optional(),
});
export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;

/**
 * The impact analysis step. Every impact is recorded explicitly so an approval can never
 * silently change project scope (master prompt section 31).
 */
export const analyseChangeRequestSchema = z.object({
  scopeImpact: longText(20000),
  scheduleImpactDays: z.number().int().min(-3650).max(3650).default(0),
  effortImpactHours: z.number().min(-100000).max(100000).default(0),
  resourceImpact: longText(20000),
  costImpact: z.number().min(-1_000_000_000).max(1_000_000_000).nullable().optional(),
  riskImpact: longText(20000),
  affectedTaskIds: z.array(idSchema).max(500).default([]),
});
export type AnalyseChangeRequestInput = z.infer<typeof analyseChangeRequestSchema>;

export const decideChangeRequestSchema = z.object({
  approved: z.boolean(),
  note: longText(20000),
  /**
   * When approved, shift the planned end date of the project and of the affected tasks by
   * `scheduleImpactDays`. Off by default: a plan change is a deliberate act.
   */
  applyScheduleImpact: z.boolean().default(false),
});
export type DecideChangeRequestInput = z.infer<typeof decideChangeRequestSchema>;

export const listChangeRequestsQuerySchema = sortableQuery(
  ['reference', 'title', 'status', 'createdAt'],
  'createdAt',
).extend({
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
  requesterId: idSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListChangeRequestsQuery = z.infer<typeof listChangeRequestsQuerySchema>;
