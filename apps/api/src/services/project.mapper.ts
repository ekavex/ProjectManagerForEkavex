/** Project selects and DTO mapping. */
import type { ProjectDetail, ProjectSummary, TaskCounts } from '@ekavist/shared';
import type { Prisma } from '@prisma/client';

import { dateColumnToDateOnly, type DateOnly } from '../domain/time.js';
import { USER_SUMMARY_SELECT, toUserSummaryOrNull } from './user.mapper.js';

export const PROJECT_SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  priority: true,
  progress: true,
  startDate: true,
  plannedEndDate: true,
  actualEndDate: true,
  updatedAt: true,
  lead: { select: USER_SUMMARY_SELECT },
  _count: { select: { members: true } },
  phases: {
    where: { status: { in: ['IN_PROGRESS', 'UNDER_REVIEW', 'REWORK_REQUIRED'] } },
    orderBy: { sequence: 'asc' },
    take: 1,
    select: { id: true, name: true, sequence: true },
  },
} satisfies Prisma.ProjectSelect;

export const PROJECT_DETAIL_SELECT = {
  ...PROJECT_SUMMARY_SELECT,
  description: true,
  category: true,
  client: true,
  budget: true,
  location: true,
  externalStakeholder: true,
  logoUrl: true,
  objectives: true,
  deliverables: true,
  archivedAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  createdBy: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.ProjectSelect;

type SummaryRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SUMMARY_SELECT }>;
type DetailRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_DETAIL_SELECT }>;

export interface ProjectExtras {
  taskCounts: TaskCounts;
  health: ProjectSummary['health'];
}

export function toProjectSummary(row: SummaryRow, extras: ProjectExtras): ProjectSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    startDate: dateColumnToDateOnly(row.startDate) as DateOnly,
    plannedEndDate: dateColumnToDateOnly(row.plannedEndDate) as DateOnly,
    actualEndDate: dateColumnToDateOnly(row.actualEndDate),
    lead: toUserSummaryOrNull(row.lead),
    currentPhase: row.phases[0] ?? null,
    memberCount: row._count.members,
    taskCounts: extras.taskCounts,
    health: extras.health,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectDetail(
  row: DetailRow,
  extras: ProjectExtras & { capabilities: ProjectDetail['capabilities'] },
): ProjectDetail {
  return {
    ...toProjectSummary(row, extras),
    description: row.description,
    category: row.category,
    client: row.client,
    department: row.department,
    budget: row.budget == null ? null : Number(row.budget),
    location: row.location,
    externalStakeholder: row.externalStakeholder,
    logoUrl: row.logoUrl,
    objectives: row.objectives,
    deliverables: row.deliverables,
    createdBy: toUserSummaryOrNull(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: extras.capabilities,
  };
}
