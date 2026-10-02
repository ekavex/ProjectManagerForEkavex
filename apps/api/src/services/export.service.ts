/**
 * CSV exports of project registers, the workload report and attendance (spec section 57).
 * Each export reads the same rows the screens show; nothing is computed differently.
 */
import type { WorkloadQuery } from '@ekavist/shared';
import type { Db } from '../db/prisma.js';
import { isOverdue } from '../domain/task-rules.js';
import {
  dateColumnToDateOnly,
  dateOnlyToDateColumn,
  today,
  type DateOnly,
} from '../domain/time.js';
import { toCsv } from '../lib/csv.js';
import type { Actor } from '../policy/actor.js';
import { canReadAttendanceOf } from '../policy/project-access.js';
import { getWorkloadReport } from './dashboard.service.js';

export const PROJECT_EXPORTS = [
  'tasks',
  'risks',
  'issues',
  'change-requests',
  'decisions',
  'milestones',
] as const;
export type ProjectExport = (typeof PROJECT_EXPORTS)[number];

const date = (value: Date | null | undefined): string => dateColumnToDateOnly(value) ?? '';
const instant = (value: Date | null | undefined): string => value?.toISOString() ?? '';
const decimal = (value: { toString(): string } | null | undefined): string =>
  value == null ? '' : value.toString();

export async function exportProject(
  db: Db,
  actor: Actor,
  projectId: string,
  dataset: ProjectExport,
): Promise<string> {
  switch (dataset) {
    case 'tasks': {
      const todayDate = today(actor.timezone);
      const rows = await db.task.findMany({
        where: { projectId, deletedAt: null },
        orderBy: [{ dueDate: 'asc' }, { reference: 'asc' }],
        select: {
          reference: true,
          name: true,
          status: true,
          priority: true,
          progress: true,
          startDate: true,
          dueDate: true,
          estimatedHours: true,
          actualHours: true,
          completedAt: true,
          phase: { select: { name: true } },
          wbsItem: { select: { code: true } },
          accountable: { select: { fullName: true } },
          assignments: { select: { user: { select: { fullName: true } } } },
          predecessors: { select: { type: true, predecessor: { select: { reference: true } } } },
        },
      });
      return toCsv(rows, [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'WBS', value: (r) => r.wbsItem?.code },
        { header: 'Task', value: (r) => r.name },
        { header: 'Phase', value: (r) => r.phase?.name },
        { header: 'Assignees', value: (r) => r.assignments.map((a) => a.user.fullName).join('; ') },
        { header: 'Accountable', value: (r) => r.accountable?.fullName },
        { header: 'Status', value: (r) => r.status },
        { header: 'Priority', value: (r) => r.priority },
        { header: 'Progress %', value: (r) => r.progress },
        { header: 'Start', value: (r) => date(r.startDate) },
        { header: 'Due', value: (r) => date(r.dueDate) },
        {
          header: 'Overdue',
          value: (r) =>
            isOverdue({ status: r.status, dueDate: dateColumnToDateOnly(r.dueDate) }, todayDate)
              ? 'yes'
              : 'no',
        },
        { header: 'Estimated hours', value: (r) => decimal(r.estimatedHours) },
        { header: 'Actual hours', value: (r) => decimal(r.actualHours) },
        {
          header: 'Depends on',
          value: (r) =>
            r.predecessors.map((p) => `${p.predecessor.reference} (${p.type})`).join('; '),
        },
        { header: 'Completed at', value: (r) => instant(r.completedAt) },
      ]);
    }
    case 'risks': {
      const rows = await db.risk.findMany({
        where: { projectId },
        orderBy: [{ severityScore: 'desc' }, { reference: 'asc' }],
        include: { owner: { select: { fullName: true } }, phase: { select: { name: true } } },
      });
      return toCsv(rows, [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Risk', value: (r) => r.title },
        { header: 'Description', value: (r) => r.description },
        { header: 'Probability', value: (r) => r.probability },
        { header: 'Impact', value: (r) => r.impact },
        { header: 'Severity', value: (r) => r.severity },
        { header: 'Owner', value: (r) => r.owner?.fullName },
        { header: 'Mitigation', value: (r) => r.mitigation },
        { header: 'Contingency', value: (r) => r.contingency },
        { header: 'Status', value: (r) => r.status },
        { header: 'Due', value: (r) => date(r.dueDate) },
        { header: 'Phase', value: (r) => r.phase?.name },
      ]);
    }
    case 'issues': {
      const rows = await db.issue.findMany({
        where: { projectId },
        orderBy: { identifiedOn: 'desc' },
        include: { owner: { select: { fullName: true } }, phase: { select: { name: true } } },
      });
      return toCsv(rows, [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Issue', value: (r) => r.title },
        { header: 'Description', value: (r) => r.description },
        { header: 'Priority', value: (r) => r.priority },
        { header: 'Owner', value: (r) => r.owner?.fullName },
        { header: 'Identified', value: (r) => date(r.identifiedOn) },
        { header: 'Target resolution', value: (r) => date(r.targetResolution) },
        { header: 'Status', value: (r) => r.status },
        { header: 'Resolution', value: (r) => r.resolution },
        { header: 'Phase', value: (r) => r.phase?.name },
      ]);
    }
    case 'change-requests': {
      const rows = await db.changeRequest.findMany({
        where: { projectId },
        orderBy: { requestedOn: 'desc' },
        include: {
          requester: { select: { fullName: true } },
          approver: { select: { fullName: true } },
        },
      });
      return toCsv(rows, [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Title', value: (r) => r.title },
        { header: 'Reason', value: (r) => r.reason },
        { header: 'Requester', value: (r) => r.requester.fullName },
        { header: 'Requested', value: (r) => date(r.requestedOn) },
        { header: 'Status', value: (r) => r.status },
        { header: 'Schedule impact (days)', value: (r) => r.scheduleImpactDays },
        { header: 'Effort impact (hours)', value: (r) => decimal(r.effortImpactHours) },
        { header: 'Cost impact', value: (r) => decimal(r.costImpact) },
        { header: 'Resource impact', value: (r) => r.resourceImpact },
        { header: 'Approver', value: (r) => r.approver?.fullName },
        { header: 'Decided at', value: (r) => instant(r.decidedAt) },
        { header: 'Decision note', value: (r) => r.decisionNote },
      ]);
    }
    case 'decisions': {
      const rows = await db.decisionLog.findMany({
        where: { projectId },
        orderBy: { decidedOn: 'desc' },
        include: {
          decisionMaker: { select: { fullName: true } },
          phase: { select: { name: true } },
          task: { select: { reference: true } },
        },
      });
      return toCsv(rows, [
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Decision', value: (r) => r.title },
        { header: 'Description', value: (r) => r.description },
        { header: 'Reason', value: (r) => r.reason },
        { header: 'Decided on', value: (r) => date(r.decidedOn) },
        { header: 'Decision maker', value: (r) => r.decisionMaker?.fullName },
        { header: 'Phase', value: (r) => r.phase?.name },
        { header: 'Task', value: (r) => r.task?.reference },
      ]);
    }
    case 'milestones': {
      const rows = await db.milestone.findMany({
        where: { projectId },
        orderBy: { date: 'asc' },
        include: { owner: { select: { fullName: true } }, phase: { select: { name: true } } },
      });
      return toCsv(rows, [
        { header: 'Milestone', value: (r) => r.name },
        { header: 'Date', value: (r) => date(r.date) },
        { header: 'Status', value: (r) => r.status },
        { header: 'Owner', value: (r) => r.owner?.fullName },
        { header: 'Phase', value: (r) => r.phase?.name },
        { header: 'Description', value: (r) => r.description },
      ]);
    }
  }
}

export async function exportWorkload(db: Db, actor: Actor, query: WorkloadQuery): Promise<string> {
  const report = await getWorkloadReport(db, actor, query);
  return toCsv(report.rows, [
    { header: 'Member', value: (r) => r.user.fullName },
    { header: 'Email', value: (r) => r.user.email },
    { header: 'Projects', value: (r) => r.projects },
    { header: 'Total tasks', value: (r) => r.total },
    { header: 'Completed', value: (r) => r.completed },
    { header: 'In progress', value: (r) => r.inProgress },
    { header: 'Not started', value: (r) => r.notStarted },
    { header: 'Blocked', value: (r) => r.blocked },
    { header: 'Overdue', value: (r) => r.overdue },
    { header: 'Progress %', value: (r) => r.progress },
    { header: 'Estimated hours', value: (r) => r.estimatedHours },
    { header: 'Actual hours', value: (r) => r.actualHours },
  ]);
}

/**
 * Attendance days between two dates for the people the caller may see: everyone with
 * `attendance:read-all`, otherwise themselves and the members of projects they lead.
 */
export async function exportAttendance(
  db: Db,
  actor: Actor,
  range: { from: DateOnly; to: DateOnly },
): Promise<string> {
  const rows = await db.attendanceDay.findMany({
    where: {
      workDate: {
        gte: dateOnlyToDateColumn(range.from) as Date,
        lte: dateOnlyToDateColumn(range.to) as Date,
      },
      user: { organizationId: actor.organizationId },
    },
    orderBy: [{ workDate: 'asc' }],
    select: {
      workDate: true,
      status: true,
      firstStartedAt: true,
      lastEndedAt: true,
      workMinutes: true,
      breakMinutes: true,
      adjustmentReason: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
  });

  const allowed = new Map<string, boolean>();
  const visible = [];
  for (const row of rows) {
    if (!allowed.has(row.user.id)) {
      allowed.set(row.user.id, await canReadAttendanceOf(db, actor, row.user.id));
    }
    if (allowed.get(row.user.id) === true) visible.push(row);
  }

  return toCsv(visible, [
    { header: 'Date', value: (r) => date(r.workDate) },
    { header: 'Member', value: (r) => r.user.fullName },
    { header: 'Email', value: (r) => r.user.email },
    { header: 'Status', value: (r) => r.status },
    { header: 'First start', value: (r) => instant(r.firstStartedAt) },
    { header: 'Last end', value: (r) => instant(r.lastEndedAt) },
    { header: 'Work minutes', value: (r) => r.workMinutes },
    { header: 'Break minutes', value: (r) => r.breakMinutes },
    { header: 'Note', value: (r) => r.adjustmentReason },
  ]);
}
