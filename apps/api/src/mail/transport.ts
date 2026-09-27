/**
 * Email transport.
 *
 * The only place that talks to an SMTP server. A message is reported as sent only when
 * the transport accepted it; every other outcome is a recorded failure (master prompt
 * section 67 — the UI must never claim a delivery that did not happen).
 *
 * Three modes:
 *   smtp    — a real server.
 *   json    — writes the rendered message to logs/mail/ and reports success. Used in
 *             development so the content is inspectable; the UI labels it as such.
 *   console — logs a one-line summary. Used by tests.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { loggerFor } from '../lib/logger.js';

const log = loggerFor('mail');

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface DeliveryResult {
  delivered: boolean;
  messageId: string | null;
  error: string | null;
  /** True when the transport is not a real mail server, so callers can say so honestly. */
  simulated: boolean;
}

let transporter: Transporter | null = null;

function smtpTransport(): Transporter {
  if (transporter != null) return transporter;
  transporter = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_SECURE,
    ...(env.EMAIL_USER ? { auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD ?? '' } } : {}),
  });
  return transporter;
}

export async function sendMail(mail: OutgoingMail): Promise<DeliveryResult> {
  switch (env.EMAIL_TRANSPORT) {
    case 'smtp':
      return sendViaSmtp(mail);
    case 'json':
      return writeToDisk(mail);
    case 'console':
    default:
      log.info({ to: mail.to, subject: mail.subject }, 'Email (console transport)');
      return { delivered: true, messageId: null, error: null, simulated: true };
  }
}

async function sendViaSmtp(mail: OutgoingMail): Promise<DeliveryResult> {
  try {
    const info = await smtpTransport().sendMail({
      from: env.EMAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    // A server that accepted the envelope but rejected every recipient is not a success.
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      return {
        delivered: false,
        messageId: info.messageId ?? null,
        error: `The mail server rejected: ${info.rejected.join(', ')}`,
        simulated: false,
      };
    }
    return {
      delivered: true,
      messageId: info.messageId ?? null,
      error: null,
      simulated: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error, to: mail.to }, 'SMTP delivery failed');
    return { delivered: false, messageId: null, error: message, simulated: false };
  }
}

async function writeToDisk(mail: OutgoingMail): Promise<DeliveryResult> {
  try {
    const dir = path.join(env.repoRoot, 'logs', 'mail');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = mail.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(dir, `${stamp}-${safeTo}.html`);
    await writeFile(
      file,
      `<!-- to: ${mail.to}\n     subject: ${mail.subject} -->\n${mail.html}`,
      'utf8',
    );
    log.info(
      { to: mail.to, subject: mail.subject, file },
      'Email written to disk (json transport)',
    );
    return { delivered: true, messageId: file, error: null, simulated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { delivered: false, messageId: null, error: message, simulated: true };
  }
}

/** Verifies the configured SMTP server at startup so a misconfiguration is visible early. */
export async function verifyTransport(): Promise<boolean> {
  if (env.EMAIL_TRANSPORT !== 'smtp') return true;
  try {
    await smtpTransport().verify();
    log.info({ host: env.EMAIL_HOST, port: env.EMAIL_PORT }, 'SMTP transport ready');
    return true;
  } catch (error) {
    log.warn(
      { err: error, host: env.EMAIL_HOST, port: env.EMAIL_PORT },
      'SMTP transport is not reachable. Queued mail will be retried and failures recorded.',
    );
    return false;
  }
}
