/**
 * Work Breakdown Structure (spec section 15).
 *
 * The tree is stored flat with a materialised `code`; `domain/wbs.ts` computes the codes
 * and this module persists them. Any operation that changes the shape of the tree
 * renumbers it in the same transaction, so a code is never stale.
 */
import {
  ERROR_CODES,
  type CreateWbsItemInput,
  type MoveWbsItemInput,
  type UpdateWbsItemInput,
  type WbsNode,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { compareWbsCodes, numberWbsTree, wouldCreateWbsCycle } from '../domain/wbs.js';
import { dateColumnToDateOnly, dateOnlyToDateColumn } from '../domain/time.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordAudit, recordChange } from './audit.service.js';
import { recomputeProjectProgress } from './rollup.service.js';
import { USER_SUMMARY_SELECT, toUserSummaryOrNull } from './user.mapper.js';

const WBS_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  phaseId: true,
  parentId: true,
  position: true,
  depth: true,
  plannedStart: true,
  plannedEnd: true,
  deliverable: true,
  progress: true,
  owner: { select: USER_SUMMARY_SELECT },
  _count: { select: { tasks: true } },
} satisfies Prisma.WbsItemSelect;

type WbsRow = Prisma.WbsItemGetPayload<{ select: typeof WBS_SELECT }>;

/** Returns the forest. Children are nested, ordered by code. */
export async function getWbsTree(db: Db, projectId: string, phaseId?: string): Promise<WbsNode[]> {
  const rows = await db.wbsItem.findMany({
    where: { projectId, ...(phaseId != null ? { phaseId } : {}) },
    select: WBS_SELECT,
  });
  return buildTree(rows);
}

function buildTree(rows: readonly WbsRow[]): WbsNode[] {
  const byId = new Map<string, WbsNode>();
  for (const row of rows) byId.set(row.id, toNode(row));

  const roots: WbsNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id) as WbsNode;
    const parent = row.parentId == null ? null : byId.get(row.parentId);
    if (parent == null) roots.push(node);
    else parent.children.push(node);
  }

  const sortRecursive = (nodes: WbsNode[]): void => {
    nodes.sort((a, b) => compareWbsCodes(a.code, b.code));
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(roots);

  return roots;
}

function toNode(row: WbsRow): WbsNode {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    phaseId: row.phaseId,
    parentId: row.parentId,
    owner: toUserSummaryOrNull(row.owner),
    plannedStart: dateColumnToDateOnly(row.plannedStart),
    plannedEnd: dateColumnToDateOnly(row.plannedEnd),
    deliverable: row.deliverable,
    progress: row.progress,
    taskCount: row._count.tasks,
    children: [],
  };
}

export async function getWbsItem(db: Db, projectId: string, wbsId: string): Promise<WbsNode> {
  const row = await db.wbsItem.findFirst({
    where: { id: wbsId, projectId },
    select: WBS_SELECT,
  });
  if (row == null) throw notFound('That WBS item');
  return toNode(row);
}

// -------------------------------------------------------------------- create

export async function createWbsItem(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  input: CreateWbsItemInput,
): Promise<WbsNode[]> {
  assertProjectPermission(context, 'wbs:create');
  assertProjectMutable(context);

  let phaseId = input.phaseId ?? null;

  if (input.parentId != null) {
    const parent = await db.wbsItem.findFirst({
      where: { id: input.parentId, projectId: context.projectId },
      select: { id: true, phaseId: true },
    });
    if (parent == null) {
      throw new AppError(
        ERROR_CODES.WBS_PARENT_INVALID,
        'That parent WBS item does not exist in this project.',
      );
    }
    // A child always belongs to the same phase as its parent; anything else would let a
    // subtree straddle two phases and make the phase rollup meaningless.
    phaseId = parent.phaseId;
  } else if (phaseId != null) {
    const found = await db.phase.count({ where: { id: phaseId, projectId: context.projectId } });
    if (found === 0) throw notFound('That phase');
  }

  await db.$transaction(async (tx) => {
    const siblings = await tx.wbsItem.findMany({
      where: { projectId: context.projectId, parentId: input.parentId ?? null },
      select: { id: true, position: true },
      orderBy: { position: 'asc' },
    });

    const position = input.position ?? siblings.length;
    for (const sibling of siblings.filter((item) => item.position >= position)) {
      await tx.wbsItem.update({
        where: { id: sibling.id },
        data: { position: sibling.position + 1 },
      });
    }

    const created = await tx.wbsItem.create({
      data: {
        projectId: context.projectId,
        phaseId,
        parentId: input.parentId ?? null,
        // A placeholder; `renumber` immediately replaces it with the real dotted code.
        code: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position,
        name: input.name,
        description: input.description ?? null,
        ownerId: input.ownerId ?? null,
        plannedStart: dateOnlyToDateColumn(input.plannedStart ?? null),
        plannedEnd: dateOnlyToDateColumn(input.plannedEnd ?? null),
        deliverable: input.deliverable ?? null,
      },
      select: { id: true, name: true },
    });

    await renumber(tx, context.projectId);

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'wbs.created',
        entityType: 'WbsItem',
        entityId: created.id,
        newValue: { name: created.name, parentId: input.parentId ?? null },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `${actor.fullName} added the WBS item ${created.name}`,
        entityType: 'WbsItem',
        entityId: created.id,
      },
    );
  });

  return getWbsTree(db, context.projectId);
}

// -------------------------------------------------------------------- update

export async function updateWbsItem(
  db: Db,
  actor: Actor,
  context: ProjectContext,
  wbsId: string,
  input: UpdateWbsItemInput,
): Promise<WbsNode> {
  assertProjectPermission(context, 'wbs:update');
  assertProjectMutable(context);

  const existing = await db.wbsItem.findFirst({
    where: { id: wbsId, projectId: context.projectId },
    select: { id: true, name: true, ownerId: true, plannedStart: true, plannedEnd: true },
  });
  if (existing == null) throw notFound('That WBS item');

  await db.wbsItem.update({
    where: { id: wbsId },
    data: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
      ...(input.plannedStart !== undefined
        ? { plannedStart: dateOnlyToDateColumn(input.plannedStart) }
        : {}),
      ...(input.plannedEnd !== undefined
        ? { plannedEnd: dateOnlyToDateColumn(input.plannedEnd) }
        : {}),
      ...(input.deliverable !== undefined ? { deliverable: input.deliverable ?? null } : {}),
    },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'wbs.updated',
    entityType: 'WbsItem',
    entityId: wbsId,
    oldValue: { name: existing.name },
    newValue: { name: input.name ?? existing.name },
  });

  return getWbsItem(db, context.projectId, wbsId);
}

// ---------------------------------------------------------------------- move

export async function moveWbsItem(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  wbsId: string,
  input: MoveWbsItemInput,
): Promise<WbsNode[]> {
  assertProjectPermission(context, 'wbs:update');
  assertProjectMutable(context);

  const all = await db.wbsItem.findMany({
    where: { projectId: context.projectId },
    select: { id: true, parentId: true, position: true, phaseId: true },
  });

  const item = all.find((candidate) => candidate.id === wbsId);
  if (item == null) throw notFound('That WBS item');

  if (input.parentId != null && !all.some((candidate) => candidate.id === input.parentId)) {
    throw new AppError(
      ERROR_CODES.WBS_PARENT_INVALID,
      'That parent WBS item does not exist in this project.',
    );
  }

  // Moving a node under its own descendant would detach the subtree from the project.
  if (wouldCreateWbsCycle(all, wbsId, input.parentId)) {
    throw new AppError(
      ERROR_CODES.WBS_CYCLE,
      'A WBS item cannot be moved underneath itself or one of its own children.',
    );
  }

  const newPhaseId =
    input.parentId != null
      ? (all.find((candidate) => candidate.id === input.parentId)?.phaseId ?? null)
      : (input.phaseId ?? item.phaseId);

  await db.$transaction(async (tx) => {
    // Close the gap the node leaves behind.
    const oldSiblings = all
      .filter((candidate) => candidate.parentId === item.parentId && candidate.id !== wbsId)
      .sort((a, b) => a.position - b.position);
    for (const [index, sibling] of oldSiblings.entries()) {
      if (sibling.position !== index) {
        await tx.wbsItem.update({ where: { id: sibling.id }, data: { position: index } });
      }
    }

    // Open a gap at the destination.
    const newSiblings = all
      .filter((candidate) => candidate.parentId === input.parentId && candidate.id !== wbsId)
      .sort((a, b) => a.position - b.position);
    const target = Math.min(input.position, newSiblings.length);
    for (const [index, sibling] of newSiblings.entries()) {
      const position = index >= target ? index + 1 : index;
      if (sibling.position !== position) {
        await tx.wbsItem.update({ where: { id: sibling.id }, data: { position } });
      }
    }

    await tx.wbsItem.update({
      where: { id: wbsId },
      data: { parentId: input.parentId, position: target, phaseId: newPhaseId },
    });

    // The whole subtree follows its new parent into that parent's phase.
    await applyPhaseToSubtree(tx, context.projectId, wbsId, newPhaseId);

    await renumber(tx, context.projectId);
    await recomputeProjectProgress(tx, context.projectId);

    await recordAudit(tx, {
      actorId: actor.id,
      projectId: context.projectId,
      action: 'wbs.moved',
      entityType: 'WbsItem',
      entityId: wbsId,
      oldValue: { parentId: item.parentId, position: item.position },
      newValue: { parentId: input.parentId, position: target },
    });
  });

  return getWbsTree(db, context.projectId);
}

export async function deleteWbsItem(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  wbsId: string,
): Promise<WbsNode[]> {
  assertProjectPermission(context, 'wbs:delete');
  assertProjectMutable(context);

  const item = await db.wbsItem.findFirst({
    where: { id: wbsId, projectId: context.projectId },
    select: { id: true, name: true, code: true },
  });
  if (item == null) throw notFound('That WBS item');

  await db.$transaction(async (tx) => {
    // Children cascade; tasks are detached rather than deleted (`WbsItem -> Task` is
    // SetNull), so the work remains visible in the project.
    await tx.wbsItem.delete({ where: { id: wbsId } });
    await renumber(tx, context.projectId);
    await recomputeProjectProgress(tx, context.projectId);

    await recordChange(
      tx,
      {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'wbs.deleted',
        entityType: 'WbsItem',
        entityId: wbsId,
        oldValue: { code: item.code, name: item.name },
      },
      {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'deleted',
        summary: `${actor.fullName} removed the WBS item ${item.code} ${item.name}`,
        entityType: 'WbsItem',
        entityId: wbsId,
      },
    );
  });

  return getWbsTree(db, context.projectId);
}

// ------------------------------------------------------------------ helpers

/**
 * Recomputes every code and depth in the project.
 *
 * Codes are parked out of the way first, because `(projectId, code)` is unique and a
 * one-by-one rewrite would collide with a code that has not been rewritten yet.
 */
export async function renumber(db: Db, projectId: string): Promise<void> {
  const rows = await db.wbsItem.findMany({
    where: { projectId },
    select: { id: true, parentId: true, position: true, code: true, depth: true },
  });
  if (rows.length === 0) return;

  const numbering = numberWbsTree(rows);

  for (const row of rows) {
    await db.wbsItem.update({
      where: { id: row.id },
      data: { code: `~${row.id}` },
    });
  }

  for (const item of numbering) {
    await db.wbsItem.update({
      where: { id: item.id },
      data: { code: item.code, depth: item.depth, position: item.position },
    });
  }
}

async function applyPhaseToSubtree(
  db: Db,
  projectId: string,
  rootId: string,
  phaseId: string | null,
): Promise<void> {
  const rows = await db.wbsItem.findMany({
    where: { projectId },
    select: { id: true, parentId: true },
  });

  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    const list = childrenOf.get(row.parentId);
    if (list) list.push(row.id);
    else childrenOf.set(row.parentId, [row.id]);
  }

  const ids: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }

  await db.wbsItem.updateMany({ where: { id: { in: ids } }, data: { phaseId } });
  // Tasks follow their WBS item into the new phase, so the phase rollup stays coherent.
  await db.task.updateMany({ where: { wbsItemId: { in: ids } }, data: { phaseId } });
}
