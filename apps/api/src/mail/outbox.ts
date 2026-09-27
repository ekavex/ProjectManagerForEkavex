/**
 * The email outbox.
 *
 * Nothing sends mail inline. A request enqueues a row and returns; the dispatch job picks
 * it up. That keeps a slow or unreachable mail server from holding a user's request open
 * (master prompt section 48), and it makes every attempt auditable: a row reaches SENT
 * only after the transport accepted it, and a failure keeps its error.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.js';
import { loggerFor } from '../lib/logger.js';
import { renderTemplate, type TemplateName, type TemplatePayload } from './templates.js';
import { sendMail } from './transport.js';

const log = loggerFor('outbox');

const MAX_ATTEMPTS = 5;

export interface EnqueueInput {
  toEmail: string;
  toUserId?: string | null;
  template: TemplateName;
  payload: TemplatePayload;
  notificationId?: string | null;
}

export async function enqueueEmail(db: Db, input: EnqueueInput): Promise<string> {
  const rendered = renderTemplate(input.template, input.payload);
  const row = await db.emailNotification.create({
    data: {
      toEmail: input.toEmail,
      toUserId: input.toUserId ?? null,
      subject: rendered.subject,
      template: input.template,
      payload: input.payload as Prisma.InputJsonValue,
      notificationId: input.notificationId ?? null,
      status: 'QUEUED',
    },
    select: { id: true },
  });
  return row.id;
}

export interface DispatchStats {
  attempted: number;
  sent: number;
  failed: number;
  abandoned: number;
}

/**
 * Sends the queued messages, oldest first.
 *
 * Claiming a row by flipping it to SENDING before the network call means a crash mid-send
 * leaves evidence rather than a row that silently reverts to QUEUED and sends twice.
 */
export async function dispatchQueue(db: Db, batchSize = 25): Promise<DispatchStats> {
  const stats: DispatchStats = { attempted: 0, sent: 0, failed: 0, abandoned: 0 };

  const queued = await db.emailNotification.findMany({
    where: { status: 'QUEUED', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, toEmail: true, template: true, payload: true, attempts: true },
  });

  for (const row of queued) {
    stats.attempted += 1;

    const claimed = await db.emailNotification.updateMany({
      where: { id: row.id, status: 'QUEUED' },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    // Another worker took it first.
    if (claimed.count === 0) continue;

    const rendered = renderTemplate(
      row.template as TemplateName,
      (row.payload ?? {}) as TemplatePayload,
    );
    const result = await sendMail({
      to: row.toEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    if (result.delivered) {
      await db.emailNotification.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      stats.sent += 1;
    } else {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await db.emailNotification.update({
        where: { id: row.id },
        data: {
          status: exhausted ? 'FAILED' : 'QUEUED',
          lastError: result.error?.slice(0, 1000) ?? 'Delivery failed for an unknown reason.',
        },
      });
      if (exhausted) {
        stats.abandoned += 1;
        log.error(
          { emailId: row.id, to: row.toEmail, error: result.error },
          'Giving up on an email after the maximum number of attempts',
        );
      } else {
        stats.failed += 1;
      }
    }
  }

  return stats;
}
