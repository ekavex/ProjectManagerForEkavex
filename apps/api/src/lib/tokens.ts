/**
 * Token minting and hashing.
 *
 * Access tokens are short-lived JWTs carrying only an id and a version marker; every
 * request re-reads the user, so a deactivated account stops working immediately rather
 * than at the next token expiry.
 *
 * Refresh and password-reset tokens are opaque random strings. Only their SHA-256 is
 * stored, so a database dump does not hand out sessions.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { ERROR_CODES } from '@ekavist/shared';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export interface AccessTokenClaims {
  sub: string;
  org: string;
}

export function signAccessToken(claims: AccessTokenClaims): { token: string; expiresIn: number } {
  const options: SignOptions = {
    expiresIn: env.AUTH_ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: 'ekavist',
    audience: 'ekavist-api',
  };
  const token = jwt.sign(claims, env.AUTH_JWT_SECRET, options);
  const decoded = jwt.decode(token);
  const expiresIn =
    typeof decoded === 'object' && decoded != null && typeof decoded.exp === 'number'
      ? decoded.exp - Math.floor(Date.now() / 1000)
      : 900;
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
      issuer: 'ekavist',
      audience: 'ekavist-api',
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'That sign-in token is not valid.');
    }
    return { sub: payload.sub, org: String(payload['org'] ?? '') };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(
        ERROR_CODES.TOKEN_EXPIRED,
        'Your session has expired. Please sign in again.',
      );
    }
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'That sign-in token is not valid.', {
      cause: error,
    });
  }
}

/** An opaque token plus the hash that is safe to store. */
export interface OpaqueToken {
  token: string;
  hash: string;
}

export function createOpaqueToken(bytes = 48): OpaqueToken {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.AUTH_REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

export function passwordResetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.AUTH_PASSWORD_RESET_TTL_MINUTES * 60_000);
}

export const REFRESH_COOKIE_NAME = 'ekavist_refresh';

export function refreshCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    expires,
  };
}
