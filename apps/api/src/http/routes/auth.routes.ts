import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from '@ekavist/shared';
import { Router } from 'express';
import { ERROR_CODES } from '@ekavist/shared';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../lib/errors.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../lib/tokens.js';
import * as authService from '../../services/auth.service.js';
import { body, clientIp, requireActor, userAgent } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, refreshLimiter } from '../middleware/common.js';
import { handler, validate } from '../middleware/validate.js';

export const authRouter: Router = Router();

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  handler(async (req, res) => {
    const meta = { ip: clientIp(req), userAgent: userAgent(req) };
    const result = await authService.login(prisma, body<LoginInput>(req), meta);

    res.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      refreshCookieOptions(result.refreshExpires),
    );
    res.json(result.response);
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  handler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof presented !== 'string' || presented.length === 0) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Please sign in to continue.');
    }

    const meta = { ip: clientIp(req), userAgent: userAgent(req) };
    const result = await authService.refreshSession(prisma, presented, meta);

    res.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      refreshCookieOptions(result.refreshExpires),
    );
    res.json(result.response);
  }),
);

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout(prisma, typeof presented === 'string' ? presented : null);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    const actor = requireActor(req);
    res.json(await authService.loadCurrentUser(prisma, actor.id));
  }),
);

/**
 * Always answers 204, whether or not the address belongs to an account, so the endpoint
 * cannot be used to discover who has one.
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  handler(async (req, res) => {
    await authService.requestPasswordReset(prisma, body<ForgotPasswordInput>(req).email);
    res.status(204).send();
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  handler(async (req, res) => {
    const meta = { ip: clientIp(req), userAgent: userAgent(req) };
    await authService.resetPassword(prisma, body<ResetPasswordInput>(req), meta);
    res.status(204).send();
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const meta = { ip: clientIp(req), userAgent: userAgent(req) };
    await authService.changePassword(prisma, actor.id, body<ChangePasswordInput>(req), meta);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
    res.status(204).send();
  }),
);
