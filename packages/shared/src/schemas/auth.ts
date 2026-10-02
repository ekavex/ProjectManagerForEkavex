import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.').max(200),
  /** A six-digit authenticator code or a recovery code, once two-factor is enabled. */
  code: z.string().trim().min(6).max(32).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Confirms enrolment, or authorises turning two-factor off. */
export const twoFactorCodeSchema = z.object({
  code: z.string().trim().min(6).max(32),
});
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().trim().min(6).max(32),
});
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
