import { z } from 'zod';
import { ORG_ROLES } from '../enums.js';
import { PERMISSIONS } from '../permissions.js';
import { dateOnlySchema, idSchema, shortText, timezoneSchema } from './common.js';

/** Organisation-level configuration: holidays, working day, leave policy and roles. */

export const createHolidaySchema = z.object({
  date: dateOnlySchema,
  name: shortText(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm.');

export const updateOrganizationSchema = z.object({
  name: shortText(200).optional(),
  timezone: timezoneSchema.optional(),
  workdayStart: timeOfDaySchema.optional(),
  lateAfter: timeOfDaySchema.optional(),
  halfDayMinutes: z.number().int().min(30).max(720).optional(),
  fullDayMinutes: z.number().int().min(60).max(1440).optional(),
  annualLeaveDays: z.number().int().min(0).max(365).optional(),
  sickLeaveDays: z.number().int().min(0).max(365).optional(),
  casualLeaveDays: z.number().int().min(0).max(365).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const replaceRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});
export type ReplaceRolePermissionsInput = z.infer<typeof replaceRolePermissionsSchema>;

export const orgRoleParamSchema = z.enum(ORG_ROLES);

// ------------------------------------------------------- planning reports

export const capacityQuerySchema = z.object({
  /** Any date; the report starts on the Monday of that week. Defaults to this week. */
  from: dateOnlySchema.optional(),
  weeks: z.coerce.number().int().min(1).max(26).default(8),
  departmentId: idSchema.optional(),
});
export type CapacityQuery = z.infer<typeof capacityQuerySchema>;

export const calendarQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    projectId: idSchema.optional(),
    /** Include only my own tasks and leave rather than everything I can see. */
    mine: z.coerce.boolean().default(false),
  })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'The end cannot be before the start.' });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
