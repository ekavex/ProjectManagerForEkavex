/**
 * Structured logging.
 *
 * One Pino instance for the whole process. The redaction list is the important part: a
 * password, token or secret must never reach a log file even if a careless call site logs
 * a whole request body (master prompt section 47).
 */
import pino, { type Logger } from 'pino';
import { env } from '../config/env.js';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
  'body.token',
];

export const logger: Logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'ekavist-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

/** A child logger tagged with the subsystem, so job and mail output is easy to filter. */
export function loggerFor(component: string): Logger {
  return logger.child({ component });
}
