/**
 * Audit and activity recording.
 *
 * Two different records with two different jobs:
 *
 *   AuditLog    — who changed what, with the before and after values. Compliance and
 *                 investigation. Append-only; no update or delete path exists.
 *   ActivityLog — a readable sentence for the project feed. Not every audit entry earns
 *                 one, and some activity (a message posted) is not worth auditing.
 *
 * Both are written inside the caller's transaction, so a change and its record commit
 * together or not at all.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { logger } from '../lib/logger.js';

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ActivityInput {
  projectId: string;
  actorId: string | null;
  verb: string;
  summary: string;
  entityType: string;
  entityId: string;
}

/** Fields that must never reach the audit log even if a caller passes a whole row. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
]);

/**
 * Strips secrets and undefined values, and converts the Prisma scalars that are not JSON
 * (Decimal, Date, BigInt) into something a JSONB column can hold.
 */
export function sanitiseForAudit(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  if (depth > 6) return '[nested]';

  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();

  const primitive = typeof value;
  if (primitive === 'string' || primitive === 'number' || primitive === 'boolean') {
    return value as Prisma.InputJsonValue;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitiseForAudit(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
    return items;
  }

  if (primitive === 'object') {
    // Prisma Decimal and similar wrappers expose toString but are not plain objects.
    const candidate = value as { toFixed?: unknown; toString(): string };
    if (typeof candidate.toFixed === 'function') return candidate.toString();

    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      const cleaned = sanitiseForAudit(item, depth + 1);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }

  return undefined;
}

/**
 * Only the fields that actually changed, so an audit entry reads as a diff rather than as
 * two copies of a row. Returns null when nothing differs.
 */
export function diffValues<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { old: Record<string, unknown>; new: Record<string, unknown> } | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const previous = before[key];
    if (equalish(previous, next)) continue;
    oldValues[key] = previous;
    newValues[key] = next;
  }

  return Object.keys(newValues).length === 0 ? null : { old: oldValues, new: newValues };
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.toISOString().startsWith(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equalish(item, b[index]));
  }
  if (a == null && b == null) return true;
  // Decimal columns arrive as objects but compare correctly as strings.
  if (a != null && b != null && typeof a === 'object' && typeof b !== 'object') {
    return String(a) === String(b);
  }
  return false;
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  const oldValue = sanitiseForAudit(input.oldValue);
  const newValue = sanitiseForAudit(input.newValue);

  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      projectId: input.projectId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(oldValue !== undefined ? { oldValue } : {}),
      ...(newValue !== undefined ? { newValue } : {}),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function recordActivity(db: Db, input: ActivityInput): Promise<void> {
  await db.activityLog.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      verb: input.verb,
      summary: input.summary,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}

/**
 * The usual pairing: one audit entry and one feed entry for the same change.
 */
export async function recordChange(
  db: Db,
  audit: AuditInput,
  activity: ActivityInput | null,
): Promise<void> {
  await recordAudit(db, audit);
  if (activity != null) await recordActivity(db, activity);
}

/**
 * For side-effect paths where a failed audit write must not fail the user's action — a
 * login, for instance. The failure is logged loudly instead of being swallowed.
 */
export async function recordAuditBestEffort(db: Db, input: AuditInput): Promise<void> {
  try {
    await recordAudit(db, input);
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'Failed to write an audit entry');
  }
}
