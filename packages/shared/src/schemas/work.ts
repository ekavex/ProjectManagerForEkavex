/** Schemas for the work-management core: phases, WBS, tasks, dependencies, milestones, RACI. */
import { z } from 'zod';
import {
  DEPENDENCY_TYPES,
  MILESTONE_STATUSES,
  PHASE_STATUSES,
  PRIORITIES,
  RACI_ROLES,
  TASK_STATUSES,
} from '../enums.js';
import {
  dateOnlySchema,
  hoursSchema,
  idSchema,
  longText,
  percentSchema,
  shortText,
  sortableQuery,
  urlSchema,
} from './common.js';

// --------------------------------------------------------------------------- phases

export const createPhaseSchema = z
  .object({
    name: shortText(150),
    description: longText(5000),
    ownerId: idSchema.optional(),
    plannedStart: dateOnlySchema.optional(),
    plannedEnd: dateOnlySchema.optional(),
    /** Position in the sequence; appended when omitted. */
    sequence: z.number().int().min(1).max(200).optional(),
    approvalRequired: z.boolean().default(false),
    approverId: idSchema.optional(),
    deliverables: z.array(shortText(300)).max(50).default([]),
  })
  .refine((v) => v.plannedStart == null || v.plannedEnd == null || v.plannedEnd >= v.plannedStart, {
    path: ['plannedEnd'],
    message: 'Phase end cannot be before phase start.',
  });
export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;

export const updatePhaseSchema = z
  .object({
    name: shortText(150).optional(),
    description: longText(5000),
    ownerId: idSchema.nullable().optional(),
    plannedStart: dateOnlySchema.nullable().optional(),
    plannedEnd: dateOnlySchema.nullable().optional(),
    status: z.enum(PHASE_STATUSES).optional(),
    approvalRequired: z.boolean().optional(),
    approverId: idSchema.nullable().optional(),
    deliverables: z.array(shortText(300)).max(50).optional(),
  })
  .refine((v) => v.plannedStart == null || v.plannedEnd == null || v.plannedEnd >= v.plannedStart, {
    path: ['plannedEnd'],
    message: 'Phase end cannot be before phase start.',
  });
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;

export const reorderPhasesSchema = z.object({
  /** Complete ordered list of phase ids; a partial list is rejected. */
  phaseIds: z.array(idSchema).min(1).max(200),
});
export type ReorderPhasesInput = z.infer<typeof reorderPhasesSchema>;

export const submitPhaseSchema = z.object({
  note: longText(5000),
});
export type SubmitPhaseInput = z.infer<typeof submitPhaseSchema>;

export const decidePhaseSchema = z.object({
  note: longText(5000),
  /** On rejection, whether the phase returns to REWORK_REQUIRED rather than IN_PROGRESS. */
  requiresRework: z.boolean().default(true),
});
export type DecidePhaseInput = z.infer<typeof decidePhaseSchema>;

// ------------------------------------------------------------------------------ WBS

export const createWbsItemSchema = z
  .object({
    name: shortText(250),
    description: longText(5000),
    phaseId: idSchema.optional(),
    parentId: idSchema.optional(),
    ownerId: idSchema.optional(),
    plannedStart: dateOnlySchema.optional(),
    plannedEnd: dateOnlySchema.optional(),
    deliverable: shortText(300).optional(),
    /** Zero-based position among its siblings; appended when omitted. */
    position: z.number().int().min(0).max(10000).optional(),
  })
  .refine((v) => v.plannedStart == null || v.plannedEnd == null || v.plannedEnd >= v.plannedStart, {
    path: ['plannedEnd'],
    message: 'End cannot be before start.',
  });
export type CreateWbsItemInput = z.infer<typeof createWbsItemSchema>;

export const updateWbsItemSchema = z
  .object({
    name: shortText(250).optional(),
    description: longText(5000),
    ownerId: idSchema.nullable().optional(),
    plannedStart: dateOnlySchema.nullable().optional(),
    plannedEnd: dateOnlySchema.nullable().optional(),
    deliverable: shortText(300).nullable().optional(),
  })
  .refine((v) => v.plannedStart == null || v.plannedEnd == null || v.plannedEnd >= v.plannedStart, {
    path: ['plannedEnd'],
    message: 'End cannot be before start.',
  });
export type UpdateWbsItemInput = z.infer<typeof updateWbsItemSchema>;

export const moveWbsItemSchema = z.object({
  /** Null moves the item to the root of its phase. */
  parentId: idSchema.nullable(),
  phaseId: idSchema.nullable().optional(),
  position: z.number().int().min(0).max(10000),
});
export type MoveWbsItemInput = z.infer<typeof moveWbsItemSchema>;

// ---------------------------------------------------------------------------- tasks

export const createTaskSchema = z
  .object({
    name: shortText(250),
    description: longText(20000),
    phaseId: idSchema.optional(),
    wbsItemId: idSchema.optional(),
    assigneeIds: z.array(idSchema).max(20).default([]),
    /** The single accountable person (the A of RACI); defaults to the project lead. */
    accountableId: idSchema.optional(),
    startDate: dateOnlySchema.optional(),
    dueDate: dateOnlySchema.optional(),
    estimatedHours: hoursSchema.optional(),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    status: z.enum(TASK_STATUSES).default('NOT_STARTED'),
  })
  .refine((v) => v.startDate == null || v.dueDate == null || v.dueDate >= v.startDate, {
    path: ['dueDate'],
    message: 'Due date cannot be before the start date.',
  });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    name: shortText(250).optional(),
    description: longText(20000),
    phaseId: idSchema.nullable().optional(),
    wbsItemId: idSchema.nullable().optional(),
    assigneeIds: z.array(idSchema).max(20).optional(),
    accountableId: idSchema.nullable().optional(),
    startDate: dateOnlySchema.nullable().optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    estimatedHours: hoursSchema.nullable().optional(),
    actualHours: hoursSchema.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
  })
  .refine((v) => v.startDate == null || v.dueDate == null || v.dueDate >= v.startDate, {
    path: ['dueDate'],
    message: 'Due date cannot be before the start date.',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Status and progress move together. Completing a task forces progress to 100 and any
 * progress of 100 on a non-terminal task is a no-op on status — the service decides,
 * never the client.
 */
export const updateTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  note: longText(2000),
  /** Set when a predecessor is incomplete and the user chose to proceed anyway. */
  overridePredecessorWarning: z.boolean().default(false),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;

export const updateTaskProgressSchema = z.object({
  progress: percentSchema,
  actualHours: hoursSchema.optional(),
  note: longText(2000),
});
export type UpdateTaskProgressInput = z.infer<typeof updateTaskProgressSchema>;

export const listTasksQuerySchema = sortableQuery(
  ['name', 'dueDate', 'startDate', 'priority', 'status', 'progress', 'createdAt', 'reference'],
  'dueDate',
).extend({
  search: z.string().trim().max(120).optional(),
  status: z
    .union([z.enum(TASK_STATUSES), z.array(z.enum(TASK_STATUSES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  priority: z.enum(PRIORITIES).optional(),
  phaseId: idSchema.optional(),
  wbsItemId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
  overdueOnly: z.coerce.boolean().default(false),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const createTaskCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentSchema>;

export const createTaskLinkAttachmentSchema = z.object({
  name: shortText(250),
  url: urlSchema,
});
export type CreateTaskLinkAttachmentInput = z.infer<typeof createTaskLinkAttachmentSchema>;

// --------------------------------------------------------------------- dependencies

export const createDependencySchema = z
  .object({
    predecessorId: idSchema,
    successorId: idSchema,
    type: z.enum(DEPENDENCY_TYPES).default('FINISH_TO_START'),
    lagDays: z.number().int().min(-365).max(365).default(0),
  })
  .refine((v) => v.predecessorId !== v.successorId, {
    path: ['successorId'],
    message: 'A task cannot depend on itself.',
  });
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;

// ----------------------------------------------------------------------- milestones

export const createMilestoneSchema = z.object({
  name: shortText(200),
  description: longText(5000),
  date: dateOnlySchema,
  ownerId: idSchema.optional(),
  phaseId: idSchema.optional(),
  taskIds: z.array(idSchema).max(50).default([]),
  status: z.enum(MILESTONE_STATUSES).default('PLANNED'),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = createMilestoneSchema.partial();
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

// ----------------------------------------------------------------------------- RACI

export const raciEntrySchema = z
  .object({
    userId: idSchema,
    role: z.enum(RACI_ROLES),
    taskId: idSchema.optional(),
    wbsItemId: idSchema.optional(),
  })
  .refine((v) => (v.taskId == null) !== (v.wbsItemId == null), {
    message: 'A RACI entry must reference exactly one of a task or a WBS item.',
  });

export const replaceRaciSchema = z.object({
  entries: z.array(raciEntrySchema).max(2000),
});
export type ReplaceRaciInput = z.infer<typeof replaceRaciSchema>;

// ---------------------------------------------------------------------------- Gantt

export const ganttQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  granularity: z.enum(['day', 'week', 'month']).default('week'),
  phaseId: idSchema.optional(),
});
export type GanttQuery = z.infer<typeof ganttQuerySchema>;
