import { z } from 'zod';
import { ORG_ROLES, USER_STATUSES } from '../enums.js';
import {
  dateOnlySchema,
  emailSchema,
  idSchema,
  longText,
  passwordSchema,
  shortText,
  sortableQuery,
  timezoneSchema,
  urlSchema,
} from './common.js';

const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9 ()-]*$/, 'Phone may contain digits, spaces and + ( ) - only.')
  .optional();

export const createUserSchema = z.object({
  fullName: shortText(150),
  email: emailSchema,
  /** Omitted means the account is created without a password and must use the reset flow. */
  password: passwordSchema.optional(),
  phone: phoneSchema,
  avatarUrl: urlSchema.optional(),
  departmentId: idSchema.optional(),
  designation: shortText(120).optional(),
  role: z.enum(ORG_ROLES).default('TEAM_MEMBER'),
  managerId: idSchema.optional(),
  joiningDate: dateOnlySchema.optional(),
  timezone: timezoneSchema.optional(),
  skills: z.array(shortText(60)).max(50).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({
    status: z.enum(USER_STATUSES).optional(),
    /** Null clears the department or manager. */
    departmentId: idSchema.nullable().optional(),
    managerId: idSchema.nullable().optional(),
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateOwnProfileSchema = z.object({
  fullName: shortText(150).optional(),
  phone: phoneSchema,
  avatarUrl: urlSchema.optional(),
  timezone: timezoneSchema.optional(),
  skills: z.array(shortText(60)).max(50).optional(),
});
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const notificationPreferenceSchema = z.object({
  emailOnTaskAssigned: z.boolean().optional(),
  emailOnTaskDueSoon: z.boolean().optional(),
  emailOnTaskOverdue: z.boolean().optional(),
  emailOnMention: z.boolean().optional(),
  emailOnProjectAssigned: z.boolean().optional(),
  emailOnPhaseDecision: z.boolean().optional(),
  emailDailySummary: z.boolean().optional(),
  emailWeeklySummary: z.boolean().optional(),
});
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceSchema>;

export const listUsersQuerySchema = sortableQuery(
  ['fullName', 'email', 'createdAt', 'role'],
  'fullName',
).extend({
  search: z.string().trim().max(120).optional(),
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  departmentId: idSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createDepartmentSchema = z.object({
  name: shortText(120),
  description: longText(2000),
  headId: idSchema.optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
