/**
 * Reading the audit log and the activity feed (spec sections 54, 55 and 90).
 *
 * The audit log is append-only and administrator-only. The activity feed is the readable
 * version for the project team, and is scoped to a project the caller can already see.
 */
import type {
  ActivityEntry,
  AuditEntry,
  ListActivityQuery,
  ListAuditQuery,
  Paginated,
  TimelineEntry,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { dateColumnToDateOnly } from '../domain/time.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectPermission } from '../policy/project-access.js';
import { pageMeta, paginate } from './pagination.js';
import { USER_SUMMARY_SELECT, toUserSummaryOrNull } from './user.mapper.js';

export async function listAudit(
  db: Db,
  actor: Actor,
  query: ListAuditQuery,
): Promise<Paginated<AuditEntry>> {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType != null ? { entityType: query.entityType } : {}),
    ...(query.entityId != null ? { entityId: query.entityId } : {}),
    ...(query.actorId != null ? { actorId: query.actorId } : {}),
    ...(query.action != null ? { action: { contains: query.action } } : {}),
    ...(query.projectId != null ? { projectId: query.projectId } : {}),
    ...(query.from != null || query.to != null
      ? {
          createdAt: {
            ...(query.from != null ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to != null ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    // Entries always belong to this organisation, via the actor or the project.
    OR: [
      { actor: { organizationId: actor.organizationId } },
      { project: { organizationId: actor.organizationId } },
    ],
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        projectId: true,
        oldValue: true,
        newValue: true,
        ip: true,
        createdAt: true,
        actor: { select: USER_SUMMARY_SELECT },
      },
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      actor: toUserSummaryOrNull(row.actor),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      projectId: row.projectId,
      oldValue: row.oldValue,
      newValue: row.newValue,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: pageMeta(query, total),
  };
}

export async function listActivity(
  db: Db,
  context: ProjectContext,
  query: ListActivityQuery,
): Promise<Paginated<ActivityEntry>> {
  assertProjectPermission(context, 'project:read');

  const where: Prisma.ActivityLogWhereInput = {
    projectId: context.projectId,
    ...(query.actorId != null ? { actorId: query.actorId } : {}),
    ...(query.from != null || query.to != null
      ? {
          createdAt: {
            ...(query.from != null ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to != null ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.activityLog.count({ where }),
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(query),
      select: {
        id: true,
        verb: true,
        summary: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: USER_SUMMARY_SELECT },
      },
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      actor: toUserSummaryOrNull(row.actor),
      verb: row.verb,
      summary: row.summary,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: pageMeta(query, total),
  };
}

/**
 * The project timeline (spec section 90): the milestones of the project's own history,
 * grouped by day. Deliberately coarser than the activity feed — it answers "what happened
 * to this project", not "who clicked what".
 */
export async function getTimeline(db: Db, context: ProjectContext): Promise<TimelineEntry[]> {
  assertProjectPermission(context, 'project:read');

  const MILESTONE_VERBS = new Set([
    'created',
    'approved',
    'rejected',
    'submitted',
    'closed',
    'changed status',
    'assigned',
    'recorded',
  ]);

  const rows = await db.activityLog.findMany({
    where: { projectId: context.projectId, verb: { in: [...MILESTONE_VERBS] } },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true, summary: true, createdAt: true },
  });

  const byDay = new Map<string, TimelineEntry>();
  for (const row of rows) {
    const date = dateColumnToDateOnly(row.createdAt) as string;
    const entry = byDay.get(date) ?? { date, events: [] };
    entry.events.push({
      id: row.id,
      summary: row.summary,
      at: row.createdAt.toISOString(),
    });
    byDay.set(date, entry);
  }

  return [...byDay.values()];
}
