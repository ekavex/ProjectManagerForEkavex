import { z } from 'zod';
import { ATTENDANCE_STATUSES, LEAVE_STATUSES, LEAVE_TYPES } from '../enums.js';
import { dateOnlySchema, idSchema, longText, paginationSchema } from './common.js';

export const startWorkSchema = z.object({
  /** Optional association so time can be attributed to a project or a task (spec section 29). */
  projectId: idSchema.optional(),
  taskId: idSchema.optional(),
  note: longText(500),
});
export type StartWorkInput = z.infer<typeof startWorkSchema>;

export const endWorkSchema = z.object({
  note: longText(500),
});
export type EndWorkInput = z.infer<typeof endWorkSchema>;

/**
 * Moving to a different task without closing the day: the open session is closed and a
 * new one opened in a single transaction, so the totals never double-count.
 */
export const switchWorkContextSchema = z.object({
  projectId: idSchema.nullable().optional(),
  taskId: idSchema.nullable().optional(),
});
export type SwitchWorkContextInput = z.infer<typeof switchWorkContextSchema>;

export const breakSchema = z.object({
  reason: longText(300),
});
export type BreakInput = z.infer<typeof breakSchema>;

export const attendanceHistoryQuerySchema = paginationSchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Requires attendance:read-team or attendance:read-all. */
  userId: idSchema.optional(),
  projectId: idSchema.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
});
export type AttendanceHistoryQuery = z.infer<typeof attendanceHistoryQuerySchema>;

export const teamAttendanceQuerySchema = z.object({
  date: dateOnlySchema.optional(),
  projectId: idSchema.optional(),
});
export type TeamAttendanceQuery = z.infer<typeof teamAttendanceQuerySchema>;

/** Administrative correction of a day, always recorded in the audit log. */
export const adjustAttendanceSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  reason: z.string().trim().min(1).max(1000),
});
export type AdjustAttendanceInput = z.infer<typeof adjustAttendanceSchema>;

// -------------------------------------------------------------------- leave

export const createLeaveSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    /** Only for a single day: counts as half a day. */
    halfDay: z.boolean().default(false),
    reason: longText(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'The last day cannot be before the first.',
  })
  .refine((v) => !v.halfDay || v.startDate === v.endDate, {
    path: ['halfDay'],
    message: 'A half day must start and end on the same date.',
  });
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;

export const decideLeaveSchema = z.object({
  approve: z.boolean(),
  note: longText(2000),
});
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;

export const listLeaveQuerySchema = paginationSchema.extend({
  /** mine: my own requests; review: requests I may decide; all: everyone (leave:manage). */
  scope: z.enum(['mine', 'review', 'all']).default('mine'),
  status: z.enum(LEAVE_STATUSES).optional(),
  userId: idSchema.optional(),
});
export type ListLeaveQuery = z.infer<typeof listLeaveQuerySchema>;
