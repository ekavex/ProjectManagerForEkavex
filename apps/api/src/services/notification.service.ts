/**
 * The notification engine (spec section 64).
 *
 * One entry point — `notify` — for every event in the system. It decides the recipients,
 * writes the in-app record, respects the recipient's email preference, and queues the
 * email. No other module writes a `Notification` row, which is what keeps the deadline
 * rules in one place instead of scattered through the features (master prompt section 22).
 */
import type {
  ListNotificationsQuery,
  Notification as NotificationDto,
  NotificationRule as NotificationRuleDto,
  NotificationType,
  Paginated,
  UpdateNotificationRulesInput,
} from '@ekavist/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { isUniqueConstraintError } from '../db/prisma.js';
import { loggerFor } from '../lib/logger.js';
import { enqueueEmail } from '../mail/outbox.js';
import type { TemplateName, TemplatePayload } from '../mail/templates.js';
import { emitToUser } from '../realtime/emitter.js';

const log = loggerFor('notifications');

/** Which preference switch governs each notification type. */
const PREFERENCE_KEY: Partial<Record<NotificationType, string>> = {
  TASK_ASSIGNED: 'emailOnTaskAssigned',
  TASK_DUE_SOON: 'emailOnTaskDueSoon',
  TASK_DUE_TODAY: 'emailOnTaskDueSoon',
  TASK_OVERDUE: 'emailOnTaskOverdue',
  MENTION: 'emailOnMention',
  PROJECT_ASSIGNED: 'emailOnProjectAssigned',
  PROJECT_MEMBER_ADDED: 'emailOnProjectAssigned',
  PHASE_APPROVAL_REQUIRED: 'emailOnPhaseDecision',
  PHASE_APPROVED: 'emailOnPhaseDecision',
  PHASE_REJECTED: 'emailOnPhaseDecision',
  DAILY_SUMMARY: 'emailDailySummary',
  WEEKLY_SUMMARY: 'emailWeeklySummary',
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  projectId?: string | null;
  taskId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** SPA route the "open" action navigates to. */
  link?: string | null;
  /**
   * Makes a scheduled reminder idempotent. Two runs of the deadline job on the same day
   * produce one notification, because the second insert violates the unique index.
   */
  dedupeKey?: string | null;
  email?: {
    template: TemplateName;
    payload: TemplatePayload;
    /** Sends regardless of the recipient's preference. Used for password reset only. */
    force?: boolean;
  };
}

export interface NotifyResult {
  created: boolean;
  notificationId: string | null;
  emailQueued: boolean;
}

/**
 * Creates one notification.
 *
 * A recipient who is inactive is skipped silently: deactivated people should not
 * accumulate mail. A duplicate `dedupeKey` is also a silent no-op rather than an error,
 * because the caller is a scheduler that legitimately retries.
 */
export async function notify(db: Db, input: NotifyInput): Promise<NotifyResult> {
  const recipient = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      status: true,
      notificationPreference: true,
    },
  });

  if (recipient == null || recipient.status !== 'ACTIVE') {
    return { created: false, notificationId: null, emailQueued: false };
  }

  let notificationId: string;
  try {
    const row = await db.notification.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
      select: { id: true },
    });
    notificationId = row.id;
  } catch (error) {
    if (input.dedupeKey != null && isUniqueConstraintError(error, 'dedupeKey')) {
      return { created: false, notificationId: null, emailQueued: false };
    }
    throw error;
  }

  let emailQueued = false;
  if (input.email != null) {
    const key = PREFERENCE_KEY[input.type];
    const preference = recipient.notificationPreference as Record<string, boolean> | null;
    const allowed =
      input.email.force === true || key == null || preference == null || preference[key] !== false;

    if (allowed) {
      await enqueueEmail(db, {
        toEmail: recipient.email,
        toUserId: recipient.id,
        template: input.email.template,
        payload: input.email.payload,
        notificationId,
      });
      emailQueued = true;
    }
  }

  await pushToClient(db, input.userId, notificationId);

  return { created: true, notificationId, emailQueued };
}

/** Notifies several people with the same content, skipping anyone in `exclude`. */
export async function notifyMany(
  db: Db,
  userIds: readonly string[],
  build: (userId: string) => NotifyInput,
  exclude: readonly string[] = [],
): Promise<void> {
  const excluded = new Set(exclude);
  const unique = [...new Set(userIds)].filter((id) => !excluded.has(id));
  for (const userId of unique) {
    try {
      await notify(db, build(userId));
    } catch (error) {
      // One bad recipient must not stop the rest.
      log.error({ err: error, userId }, 'Failed to create a notification');
    }
  }
}

async function pushToClient(db: Db, userId: string, notificationId: string): Promise<void> {
  try {
    const row = await db.notification.findUnique({
      where: { id: notificationId },
      include: { project: { select: { id: true, code: true, name: true } } },
    });
    if (row == null) return;

    const unreadCount = await db.notification.count({ where: { userId, readAt: null } });

    const dto: NotificationDto = {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      project: row.project,
      entityType: row.entityType,
      entityId: row.entityId,
      link: row.link,
    };

    emitToUser(userId, 'notification:new', { notification: dto, unreadCount });
  } catch (error) {
    log.warn({ err: error, userId }, 'Could not push a notification to the client');
  }
}

/** Everyone who should hear about a project-wide event: the lead and every member. */
export async function projectAudience(
  db: Db,
  projectId: string,
  options: { includeViewers?: boolean } = {},
): Promise<string[]> {
  const members = await db.projectMember.findMany({
    where: {
      projectId,
      ...(options.includeViewers === true ? {} : { projectRole: { in: ['LEAD', 'MEMBER'] } }),
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/** The people responsible for a project: its lead, plus any member with the LEAD role. */
export async function projectLeads(db: Db, projectId: string): Promise<string[]> {
  const [project, leads] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { leadId: true } }),
    db.projectMember.findMany({
      where: { projectId, projectRole: 'LEAD', user: { status: 'ACTIVE' } },
      select: { userId: true },
    }),
  ]);

  const ids = new Set(leads.map((lead) => lead.userId));
  if (project?.leadId != null) ids.add(project.leadId);
  return [...ids];
}

// ---------------------------------------------------------------- reading

/**
 * The in-app feed. Always scoped to the caller: there is no parameter that would let one
 * user read another's notifications.
 */
export async function listNotifications(
  db: Db,
  actor: { id: string },
  query: ListNotificationsQuery,
): Promise<Paginated<NotificationDto> & { unreadCount: number }> {
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.type != null ? { type: query.type } : {}),
    ...(query.projectId != null ? { projectId: query.projectId } : {}),
  };

  const [total, rows, unreadCount] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { project: { select: { id: true, code: true, name: true } } },
    }),
    db.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      project: row.project,
      entityType: row.entityType,
      entityId: row.entityId,
      link: row.link,
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    },
    unreadCount,
  };
}

export async function markRead(
  db: Db,
  actor: { id: string },
  notificationId: string,
): Promise<{ unreadCount: number }> {
  // The ownership check is part of the update, so a foreign id simply matches nothing.
  await db.notification.updateMany({
    where: { id: notificationId, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return {
    unreadCount: await db.notification.count({ where: { userId: actor.id, readAt: null } }),
  };
}

export async function markAllRead(db: Db, actor: { id: string }): Promise<{ unreadCount: number }> {
  await db.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { unreadCount: 0 };
}

// ------------------------------------------------------------------- rules

/**
 * The deadline rules (spec section 41). A fresh organisation gets the defaults the spec
 * describes: three days before, one day before, due today, and an overdue escalation.
 */
export const DEFAULT_NOTIFICATION_RULES: {
  type: NotificationType;
  offsetDays: number;
  emailEnabled: boolean;
  notifyLead: boolean;
}[] = [
  { type: 'TASK_DUE_SOON', offsetDays: 3, emailEnabled: true, notifyLead: false },
  { type: 'TASK_DUE_SOON', offsetDays: 1, emailEnabled: true, notifyLead: false },
  { type: 'TASK_DUE_TODAY', offsetDays: 0, emailEnabled: true, notifyLead: false },
  { type: 'TASK_OVERDUE', offsetDays: -1, emailEnabled: true, notifyLead: true },
  { type: 'TASK_OVERDUE', offsetDays: -3, emailEnabled: true, notifyLead: true },
  { type: 'TASK_OVERDUE', offsetDays: -7, emailEnabled: true, notifyLead: true },
];

export async function listRules(db: Db, organizationId: string): Promise<NotificationRuleDto[]> {
  const rows = await db.notificationRule.findMany({
    where: { organizationId },
    orderBy: [{ type: 'asc' }, { offsetDays: 'desc' }],
  });

  if (rows.length > 0) {
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      offsetDays: row.offsetDays,
      enabled: row.enabled,
      emailEnabled: row.emailEnabled,
      notifyLead: row.notifyLead,
    }));
  }

  // Nothing configured yet: seed the defaults so the page is never empty and the
  // scheduler has something to work from.
  await db.notificationRule.createMany({
    data: DEFAULT_NOTIFICATION_RULES.map((rule) => ({ ...rule, organizationId, enabled: true })),
    skipDuplicates: true,
  });
  return listRules(db, organizationId);
}

export async function updateRules(
  db: Db,
  organizationId: string,
  rules: UpdateNotificationRulesInput['rules'],
): Promise<NotificationRuleDto[]> {
  for (const rule of rules) {
    await db.notificationRule.upsert({
      where: {
        organizationId_type_offsetDays: {
          organizationId,
          type: rule.type,
          offsetDays: rule.offsetDays,
        },
      },
      create: { organizationId, ...rule },
      update: {
        enabled: rule.enabled,
        emailEnabled: rule.emailEnabled,
        notifyLead: rule.notifyLead,
      },
    });
  }
  return listRules(db, organizationId);
}
