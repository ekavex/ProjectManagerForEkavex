/**
 * Authentication.
 *
 * Decisions worth knowing:
 *   * A failed login and an unknown email produce the same answer and take a similar
 *     amount of time, so the endpoint does not confirm which addresses exist.
 *   * Refresh tokens rotate. Presenting one that was already exchanged means it leaked,
 *     so the whole family is revoked rather than just that token.
 *   * "Forgot password" always answers 204, for the same reason as the first point.
 */
import {
  ERROR_CODES,
  type CurrentUser,
  type LoginResponse,
  type TwoFactorEnrolment,
  type TwoFactorStatus,
} from '@ekavist/shared';
import type { Db, RootDb } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { loggerFor } from '../lib/logger.js';
import { hashPassword, needsRehash, verifyPassword } from '../lib/password.js';
import {
  createOpaqueToken,
  hashToken,
  passwordResetExpiry,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/tokens.js';
import {
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '../lib/totp.js';
import { enqueueEmail } from '../mail/outbox.js';
import { loadOrgPermissions } from '../policy/actor.js';
import { recordAuditBestEffort } from './audit.service.js';
import { toCurrentUser, USER_DETAIL_SELECT } from './user.mapper.js';

const log = loggerFor('auth');

/** Consecutive failures after which the account is locked for a short period. */
const LOCK_THRESHOLD = 8;
const LOCK_MINUTES = 15;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionResult {
  response: LoginResponse;
  refreshToken: string;
  refreshExpires: Date;
}

export async function login(
  db: Db,
  input: { email: string; password: string; code?: string | undefined },
  meta: RequestMeta,
): Promise<SessionResult> {
  const user = await db.user.findFirst({
    where: { email: input.email },
    select: {
      ...USER_DETAIL_SELECT,
      passwordHash: true,
      failedLogins: true,
      lockedUntil: true,
      totpSecret: true,
      totpEnabledAt: true,
      totpRecoveryCodes: true,
    },
  });

  const invalidCredentials = new AppError(
    ERROR_CODES.INVALID_CREDENTIALS,
    'That email address and password do not match an account.',
  );

  if (user == null) {
    // Spend comparable time so the response does not reveal that the address is unknown.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=3,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
      input.password,
    );
    throw invalidCredentials;
  }

  if (user.lockedUntil != null && user.lockedUntil > new Date()) {
    throw new AppError(
      ERROR_CODES.ACCOUNT_DISABLED,
      'Too many failed attempts. Please try again in a few minutes or reset your password.',
    );
  }

  if (user.passwordHash == null) {
    throw new AppError(
      ERROR_CODES.INVALID_CREDENTIALS,
      'This account has no password yet. Use "Forgot password" to set one.',
    );
  }

  const matches = await verifyPassword(user.passwordHash, input.password);
  if (!matches) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil: failed >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await recordAuditBestEffort(db, {
      actorId: user.id,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw invalidCredentials;
  }

  // Status is checked after the password so a wrong password on a disabled account does
  // not reveal that the account exists.
  if (user.status !== 'ACTIVE') {
    throw new AppError(
      ERROR_CODES.ACCOUNT_DISABLED,
      'This account is not active. Please contact your administrator.',
    );
  }

  // Second factor, checked only once the password is right so it reveals nothing extra.
  // A missing code is a prompt, not a failure; a wrong one counts towards the lockout.
  let usedRecoveryCode: string | null = null;
  if (user.totpEnabledAt != null && user.totpSecret != null) {
    if (input.code == null) {
      throw new AppError(
        ERROR_CODES.TWO_FACTOR_REQUIRED,
        'Enter the six-digit code from your authenticator app.',
      );
    }
    usedRecoveryCode = matchRecoveryCode(user.totpRecoveryCodes, input.code);
    if (!verifyTotp(user.totpSecret, input.code) && usedRecoveryCode == null) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await recordAuditBestEffort(db, {
        actorId: user.id,
        action: 'auth.two-factor.failed',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new AppError(
        ERROR_CODES.TWO_FACTOR_INVALID,
        'That code is not valid. Check the time on your phone, or use a recovery code.',
      );
    }
  }

  // Transparent upgrade if the hashing parameters have since been strengthened.
  const rehash = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;

  await db.user.update({
    where: { id: user.id },
    data: {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(rehash != null ? { passwordHash: rehash } : {}),
      // A recovery code works once.
      ...(usedRecoveryCode != null
        ? {
            totpRecoveryCodes: user.totpRecoveryCodes.filter((hash) => hash !== usedRecoveryCode),
          }
        : {}),
    },
  });

  await recordAuditBestEffort(db, {
    actorId: user.id,
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return issueSession(db, user.id, meta);
}

/** Mints an access token and a fresh refresh-token family. */
export async function issueSession(
  db: Db,
  userId: string,
  meta: RequestMeta,
  familyId?: string,
): Promise<SessionResult> {
  const user = await loadCurrentUser(db, userId);
  const { token: accessToken, expiresIn } = signAccessToken({
    sub: userId,
    org: user.organization.id,
  });

  const refresh = createOpaqueToken();
  const expires = refreshTokenExpiry();

  const row = await db.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.hash,
      familyId: familyId ?? refresh.hash.slice(0, 32),
      expiresAt: expires,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
    select: { id: true },
  });
  log.debug({ userId, tokenId: row.id }, 'Issued a refresh token');

  return {
    response: { accessToken, expiresIn, user },
    refreshToken: refresh.token,
    refreshExpires: expires,
  };
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * A token that was already rotated is treated as a leak: every token in its family is
 * revoked, which signs out the attacker and the legitimate user, who then signs in again.
 */
export async function refreshSession(
  db: Db,
  presentedToken: string,
  meta: RequestMeta,
): Promise<SessionResult> {
  const tokenHash = hashToken(presentedToken);
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      rotatedAt: true,
    },
  });

  if (existing == null) {
    throw new AppError(
      ERROR_CODES.TOKEN_INVALID,
      'Your session is no longer valid. Please sign in.',
    );
  }

  if (existing.rotatedAt != null || existing.revokedAt != null) {
    await db.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditBestEffort(db, {
      actorId: existing.userId,
      action: 'auth.refresh.reuse-detected',
      entityType: 'User',
      entityId: existing.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw new AppError(
      ERROR_CODES.REFRESH_TOKEN_REUSED,
      'Your session was ended for security reasons. Please sign in again.',
    );
  }

  if (existing.expiresAt < new Date()) {
    throw new AppError(
      ERROR_CODES.TOKEN_EXPIRED,
      'Your session has expired. Please sign in again.',
    );
  }

  const user = await db.user.findUnique({
    where: { id: existing.userId },
    select: { status: true },
  });
  if (user == null || user.status !== 'ACTIVE') {
    throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, 'This account is not active.');
  }

  await db.refreshToken.update({
    where: { id: existing.id },
    data: { rotatedAt: new Date() },
  });

  return issueSession(db, existing.userId, meta, existing.familyId);
}

export async function logout(db: Db, presentedToken: string | null): Promise<void> {
  if (presentedToken == null) return;
  await db.refreshToken.updateMany({
    where: { tokenHash: hashToken(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user. Used when an account is deactivated. */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Starts a password reset. Always succeeds from the caller's point of view; the email is
 * only queued when the address belongs to an account that can sign in.
 */
export async function requestPasswordReset(db: Db, email: string): Promise<void> {
  const user = await db.user.findFirst({
    where: { email },
    select: { id: true, email: true, fullName: true, status: true },
  });

  if (user == null || user.status !== 'ACTIVE') {
    log.debug({ email }, 'Password reset requested for an address with no active account');
    return;
  }

  // Older outstanding links stop working, so a forwarded email cannot be replayed.
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = createOpaqueToken(32);
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: token.hash, expiresAt: passwordResetExpiry() },
  });

  await enqueueEmail(db, {
    toEmail: user.email,
    toUserId: user.id,
    template: 'password-reset',
    payload: {
      name: user.fullName,
      token: token.token,
      expiresInMinutes: env.AUTH_PASSWORD_RESET_TTL_MINUTES,
    },
  });
}

export async function resetPassword(
  db: RootDb,
  input: { token: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (row == null || row.usedAt != null || row.expiresAt < new Date()) {
    throw new AppError(
      ERROR_CODES.TOKEN_INVALID,
      'That reset link is no longer valid. Please request a new one.',
    );
  }

  const passwordHash = await hashPassword(input.password);

  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    // A password change ends every existing session.
    await tx.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: row.userId,
        action: 'auth.password.reset',
        entityType: 'User',
        entityId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });
}

export async function changePassword(
  db: RootDb,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (
    user?.passwordHash == null ||
    !(await verifyPassword(user.passwordHash, input.currentPassword))
  ) {
    throw new AppError(ERROR_CODES.PASSWORD_INCORRECT, 'Your current password is not correct.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'auth.password.changed',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });
}

export async function loadCurrentUser(db: Db, userId: string): Promise<CurrentUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: USER_DETAIL_SELECT,
  });
  if (user == null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'That account no longer exists.');
  }

  const [organization, permissions] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, timezone: true, workdayStart: true, lateAfter: true },
    }),
    loadOrgPermissions(db, user.organizationId, user.role),
  ]);

  return toCurrentUser(user, organization, [...permissions]);
}

/** Housekeeping: drops refresh and reset tokens that can no longer be used. */
export async function purgeExpiredTokens(db: Db): Promise<{ refresh: number; reset: number }> {
  const cutoff = new Date();
  const [refresh, reset] = await Promise.all([
    db.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
  return { refresh: refresh.count, reset: reset.count };
}

// ---------------------------------------------------------------- two-factor

/** The stored hash that the presented recovery code matches, or null. */
function matchRecoveryCode(hashes: readonly string[], code: string): string | null {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== 10) return null;
  const hash = hashToken(normalised);
  return hashes.includes(hash) ? hash : null;
}

export async function getTwoFactorStatus(db: Db, userId: string): Promise<TwoFactorStatus> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpEnabledAt: true, totpRecoveryCodes: true },
  });
  return {
    enabled: user.totpEnabledAt != null,
    enabledAt: user.totpEnabledAt?.toISOString() ?? null,
    recoveryCodesRemaining: user.totpEnabledAt == null ? 0 : user.totpRecoveryCodes.length,
  };
}

/**
 * Starts enrolment: a fresh secret is stored but does nothing until a code generated from
 * it is confirmed, so an abandoned enrolment never locks anyone out.
 */
export async function beginTwoFactorEnrolment(db: Db, userId: string): Promise<TwoFactorEnrolment> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, totpEnabledAt: true, organization: { select: { name: true } } },
  });
  if (user.totpEnabledAt != null) {
    throw new AppError(
      ERROR_CODES.TWO_FACTOR_ALREADY_ENABLED,
      'Two-factor sign-in is already on. Turn it off first to enrol a new device.',
    );
  }
  const secret = generateSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecret: secret } });
  return {
    secret,
    otpauthUrl: otpauthUrl(secret, user.email, user.organization.name || 'Ekavist'),
  };
}

/** Confirms enrolment and returns the recovery codes, which are shown exactly once. */
export async function confirmTwoFactor(
  db: RootDb,
  userId: string,
  code: string,
  meta: RequestMeta,
): Promise<{ recoveryCodes: string[] }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (user.totpEnabledAt != null) {
    throw new AppError(ERROR_CODES.TWO_FACTOR_ALREADY_ENABLED, 'Two-factor sign-in is already on.');
  }
  if (user.totpSecret == null || !verifyTotp(user.totpSecret, code)) {
    throw new AppError(
      ERROR_CODES.TWO_FACTOR_INVALID,
      'That code does not match. Make sure the app shows Ekavist and try the newest code.',
    );
  }

  const recoveryCodes = generateRecoveryCodes();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpRecoveryCodes: recoveryCodes.map((item) => hashToken(normaliseRecoveryCode(item))),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'auth.two-factor.enabled',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });
  return { recoveryCodes };
}

/** Turning it off needs both the password and a current code. */
export async function disableTwoFactor(
  db: RootDb,
  userId: string,
  input: { password: string; code: string },
  meta: RequestMeta,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      passwordHash: true,
      totpSecret: true,
      totpEnabledAt: true,
      totpRecoveryCodes: true,
    },
  });
  if (user.totpEnabledAt == null || user.totpSecret == null) {
    throw new AppError(ERROR_CODES.TWO_FACTOR_NOT_ENABLED, 'Two-factor sign-in is not on.');
  }
  if (user.passwordHash == null || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(ERROR_CODES.PASSWORD_INCORRECT, 'Your password is not correct.');
  }
  if (
    !verifyTotp(user.totpSecret, input.code) &&
    matchRecoveryCode(user.totpRecoveryCodes, input.code) == null
  ) {
    throw new AppError(ERROR_CODES.TWO_FACTOR_INVALID, 'That code is not valid.');
  }
  await clearTwoFactor(db, userId, userId, meta);
}

/**
 * Removes two-factor from an account. Used by the owner, and by an administrator when
 * someone has lost their phone and their recovery codes.
 */
export async function clearTwoFactor(
  db: RootDb,
  actorId: string,
  userId: string,
  meta: RequestMeta,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: [] },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: actorId === userId ? 'auth.two-factor.disabled' : 'auth.two-factor.reset',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });
}
