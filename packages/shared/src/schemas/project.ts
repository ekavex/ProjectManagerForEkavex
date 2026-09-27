import { z } from 'zod';
import { PRIORITIES, PROJECT_ROLES, PROJECT_STATUSES } from '../enums.js';
import {
  dateOnlySchema,
  idSchema,
  longText,
  shortText,
  sortableQuery,
  urlSchema,
} from './common.js';

/**
 * A project code is the short human handle used in references such as `EKV-01/T-102`.
 * Uppercase letters, digits and dashes keep it readable in exports and file names.
 */
export const projectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(20)
  .regex(
    /^[A-Z0-9][A-Z0-9-]*$/,
    'Use letters, digits and dashes, starting with a letter or digit.',
  );

export const createProjectSchema = z
  .object({
    name: shortText(200),
    code: projectCodeSchema,
    description: longText(20000),
    leadId: idSchema,
    startDate: dateOnlySchema,
    plannedEndDate: dateOnlySchema,
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    category: shortText(120).optional(),
    client: shortText(200).optional(),
    departmentId: idSchema.optional(),
    budget: z.number().min(0).max(1_000_000_000_000).optional(),
    location: shortText(200).optional(),
    externalStakeholder: shortText(200).optional(),
    logoUrl: urlSchema.optional(),
    objectives: z.array(shortText(500)).max(50).default([]),
    deliverables: z.array(shortText(500)).max(100).default([]),
    /** Create the eight default Waterfall phases along with the project. */
    useDefaultPhases: z.boolean().default(true),
  })
  .refine((value) => value.plannedEndDate >= value.startDate, {
    path: ['plannedEndDate'],
    message: 'Planned completion date cannot be before the start date.',
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: shortText(200).optional(),
    description: longText(20000),
    leadId: idSchema.optional(),
    startDate: dateOnlySchema.optional(),
    plannedEndDate: dateOnlySchema.optional(),
    actualEndDate: dateOnlySchema.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: shortText(120).nullable().optional(),
    client: shortText(200).nullable().optional(),
    departmentId: idSchema.nullable().optional(),
    budget: z.number().min(0).nullable().optional(),
    location: shortText(200).nullable().optional(),
    externalStakeholder: shortText(200).nullable().optional(),
    logoUrl: urlSchema.nullable().optional(),
    objectives: z.array(shortText(500)).max(50).optional(),
    deliverables: z.array(shortText(500)).max(100).optional(),
  })
  .refine(
    (value) =>
      value.startDate == null ||
      value.plannedEndDate == null ||
      value.plannedEndDate >= value.startDate,
    {
      path: ['plannedEndDate'],
      message: 'Planned completion date cannot be before the start date.',
    },
  );
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const changeProjectStatusSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  reason: longText(2000),
});
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;

export const listProjectsQuerySchema = sortableQuery(
  ['name', 'code', 'startDate', 'plannedEndDate', 'progress', 'updatedAt'],
  'updatedAt',
).extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  leadId: idSchema.optional(),
  memberId: idSchema.optional(),
  /** Administrators only; everyone else is always scoped to their memberships. */
  includeArchived: z.coerce.boolean().default(false),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const addProjectMemberSchema = z.object({
  userId: idSchema,
  projectRole: z.enum(PROJECT_ROLES).default('MEMBER'),
  responsibility: shortText(300).optional(),
  /** Only meaningful for a VIEWER (spec section 6.4). */
  canReadChat: z.boolean().default(false),
  allocationPercent: z.number().int().min(0).max(100).default(100),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = addProjectMemberSchema.omit({ userId: true }).partial();
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;

export const closeProjectSchema = z.object({
  handoverNote: longText(20000),
  lessons: z
    .array(
      z.object({
        category: z.enum([
          'WHAT_WENT_WELL',
          'WHAT_WENT_WRONG',
          'CHANGE',
          'REPEAT',
          'TECHNICAL',
          'PROCESS',
          'TEAM',
        ]),
        note: shortText(2000),
      }),
    )
    .max(100)
    .default([]),
  /** Acknowledges any remaining open items listed by GET /projects/:id/closure. */
  acknowledgeOpenItems: z.boolean().default(false),
});
export type CloseProjectInput = z.infer<typeof closeProjectSchema>;
