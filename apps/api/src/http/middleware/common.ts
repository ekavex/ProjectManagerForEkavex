/** Request id, logging and rate limiting. */
import { ERROR_CODES } from '@ekavist/shared';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Attaches a request id, echoed in the response header and in every error body, so a user
 * reporting a problem can quote one string that finds the log line.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

export const httpLogger: RequestHandler = pinoHttp({
  logger,
  genReqId: (req) => (req as { requestId?: string }).requestId ?? randomUUID(),
  customLogLevel: (_req, res, err) => {
    if (err != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/api/v1/health',
  },
}) as RequestHandler;

function limiter(max: number, windowMs: number, message: string): RequestHandler {
  const options: Partial<Options> = {
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests would otherwise fail on the second run of a suite.
    skip: () => env.isTest,
    handler: (req, res) => {
      res.status(429).json({
        error: { code: ERROR_CODES.RATE_LIMITED, message },
        requestId: req.requestId,
      });
    },
  };
  return rateLimit(options);
}

/** Broad limit for the whole API. */
export const generalLimiter = limiter(
  env.RATE_LIMIT_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many requests. Please wait a moment and try again.',
);

/**
 * Tight limit for the endpoints where a password or a reset token is guessed: login,
 * forgot-password, reset-password and change-password.
 */
export const authLimiter = limiter(
  env.RATE_LIMIT_AUTH_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many attempts. Please wait a minute before trying again.',
);

/**
 * Refreshing a session is not a credential guess.
 *
 * The SPA calls `/auth/refresh` on every page load, so several tabs or a few quick
 * navigations would exhaust the credential limit and lock a legitimate person out of their
 * own session. The endpoint is protected by an httpOnly cookie and by rotation — replaying
 * a used token revokes the whole family — so the limit here only needs to stop a flood.
 */
export const refreshLimiter = limiter(
  Math.max(60, env.RATE_LIMIT_AUTH_MAX * 6),
  env.RATE_LIMIT_WINDOW_MS,
  'Too many session refreshes. Please wait a moment and reload.',
);

/** Chat posting: generous for a person, restrictive for a script. */
export const writeLimiter = limiter(
  120,
  60_000,
  'You are sending messages very quickly. Please slow down.',
);
