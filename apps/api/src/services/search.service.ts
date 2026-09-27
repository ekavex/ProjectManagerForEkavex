/**
 * Global and project search (spec section 56).
 *
 * Scoped to what the caller may see: projects they belong to, and content inside those
 * projects. An administrator searches the whole organisation. Personal notes are searched
 * only for their own owner, and only through the `NOTE` type.
 */
import type { GlobalSearchQuery, SearchHit, SearchType } from '@ekavist/shared';
import type { Db } from '../db/prisma.js';
import type { Actor } from '../policy/actor.js';
import { visibleProjectIds } from '../policy/project-access.js';

export async function globalSearch(
  db: Db,
  actor: Actor,
  query: GlobalSearchQuery,
): Promise<SearchHit[]> {
  const term = query.q.trim();
  const types: SearchType[] = query.types ?? [
    'PROJECT',
    'TASK',
    'USER',
    'DOCUMENT',
    'MESSAGE',
    'NOTE',
    'RISK',
    'ISSUE',
    'CHANGE_REQUEST',
  ];

  const visible = await visibleProjectIds(db, actor);
  const projectScope = visible == null ? {} : { id: { in: visible } };
  const childScope = visible == null ? {} : { projectId: { in: visible } };

  const contains = { contains: term, mode: 'insensitive' as const };
  const limit = query.limit;
  const hits: SearchHit[] = [];

  if (types.includes('PROJECT')) {
    const rows = await db.project.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...projectScope,
        OR: [{ name: contains }, { code: contains }, { client: contains }],
      },
      take: limit,
      select: { id: true, code: true, name: true, status: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'PROJECT',
        id: row.id,
        title: `${row.code} ${row.name}`,
        subtitle: row.status.toLowerCase().replace(/_/g, ' '),
        projectId: row.id,
        link: `/projects/${row.id}`,
      })),
    );
  }

  if (types.includes('TASK')) {
    const rows = await db.task.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null, organizationId: actor.organizationId, ...projectScope },
        OR: [{ name: contains }, { reference: contains }, { description: contains }],
      },
      take: limit,
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        projectId: true,
        project: { select: { code: true } },
      },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'TASK',
        id: row.id,
        title: `${row.reference} ${row.name}`,
        subtitle: `${row.project.code} · ${row.status.toLowerCase().replace(/_/g, ' ')}`,
        projectId: row.projectId,
        link: `/projects/${row.projectId}/tasks/${row.id}`,
      })),
    );
  }

  if (types.includes('USER') && actor.permissions.has('user:read')) {
    const rows = await db.user.findMany({
      where: {
        organizationId: actor.organizationId,
        status: 'ACTIVE',
        OR: [{ fullName: contains }, { email: contains }, { designation: contains }],
      },
      take: limit,
      select: { id: true, fullName: true, email: true, designation: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'USER',
        id: row.id,
        title: row.fullName,
        subtitle: row.designation ?? row.email,
        projectId: null,
        link: `/team/${row.id}`,
      })),
    );
  }

  if (types.includes('DOCUMENT')) {
    const rows = await db.document.findMany({
      where: {
        deletedAt: null,
        project: { deletedAt: null, organizationId: actor.organizationId, ...projectScope },
        OR: [{ name: contains }, { description: contains }],
      },
      take: limit,
      select: { id: true, name: true, category: true, projectId: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'DOCUMENT',
        id: row.id,
        title: row.name,
        subtitle: row.category.toLowerCase().replace(/_/g, ' '),
        projectId: row.projectId,
        link: `/projects/${row.projectId}/documents`,
      })),
    );
  }

  if (types.includes('MESSAGE')) {
    const rows = await db.message.findMany({
      where: {
        deletedAt: null,
        body: contains,
        project: { deletedAt: null, organizationId: actor.organizationId, ...projectScope },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        body: true,
        projectId: true,
        author: { select: { fullName: true } },
      },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'MESSAGE',
        id: row.id,
        title: row.body.slice(0, 120),
        subtitle: row.author.fullName,
        projectId: row.projectId,
        link: `/projects/${row.projectId}/chat?message=${row.id}`,
      })),
    );
  }

  if (types.includes('NOTE')) {
    // Personal notes: the caller's own only. There is no branch that could widen this.
    const personal = await db.personalNote.findMany({
      where: { userId: actor.id, OR: [{ title: contains }, { body: contains }] },
      take: limit,
      select: { id: true, title: true },
    });
    hits.push(
      ...personal.map((row) => ({
        type: 'NOTE',
        id: row.id,
        title: row.title,
        subtitle: 'Personal note',
        projectId: null,
        link: `/my-work/notes/${row.id}`,
      })),
    );

    const projectNotes = await db.projectNote.findMany({
      where: {
        project: { deletedAt: null, organizationId: actor.organizationId, ...projectScope },
        OR: [{ title: contains }, { body: contains }],
      },
      take: limit,
      select: { id: true, title: true, projectId: true },
    });
    hits.push(
      ...projectNotes.map((row) => ({
        type: 'NOTE',
        id: row.id,
        title: row.title,
        subtitle: 'Project note',
        projectId: row.projectId,
        link: `/projects/${row.projectId}/notes`,
      })),
    );
  }

  if (types.includes('RISK')) {
    const rows = await db.risk.findMany({
      where: {
        ...childScope,
        project: { deletedAt: null, organizationId: actor.organizationId },
        OR: [{ title: contains }, { reference: contains }],
      },
      take: limit,
      select: { id: true, reference: true, title: true, severity: true, projectId: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'RISK',
        id: row.id,
        title: `${row.reference} ${row.title}`,
        subtitle: `Severity ${row.severity.toLowerCase().replace(/_/g, ' ')}`,
        projectId: row.projectId,
        link: `/projects/${row.projectId}/risks`,
      })),
    );
  }

  if (types.includes('ISSUE')) {
    const rows = await db.issue.findMany({
      where: {
        ...childScope,
        project: { deletedAt: null, organizationId: actor.organizationId },
        OR: [{ title: contains }, { reference: contains }],
      },
      take: limit,
      select: { id: true, reference: true, title: true, status: true, projectId: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'ISSUE',
        id: row.id,
        title: `${row.reference} ${row.title}`,
        subtitle: row.status.toLowerCase().replace(/_/g, ' '),
        projectId: row.projectId,
        link: `/projects/${row.projectId}/issues`,
      })),
    );
  }

  if (types.includes('CHANGE_REQUEST')) {
    const rows = await db.changeRequest.findMany({
      where: {
        ...childScope,
        project: { deletedAt: null, organizationId: actor.organizationId },
        OR: [{ title: contains }, { reference: contains }],
      },
      take: limit,
      select: { id: true, reference: true, title: true, status: true, projectId: true },
    });
    hits.push(
      ...rows.map((row) => ({
        type: 'CHANGE_REQUEST',
        id: row.id,
        title: `${row.reference} ${row.title}`,
        subtitle: row.status.toLowerCase().replace(/_/g, ' '),
        projectId: row.projectId,
        link: `/projects/${row.projectId}/change-requests/${row.id}`,
      })),
    );
  }

  return hits;
}
