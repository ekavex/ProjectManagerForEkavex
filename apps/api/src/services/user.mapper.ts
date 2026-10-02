/**
 * User selects and DTO mapping.
 *
 * The selects are explicit and exported so no query anywhere reads the whole `User` row.
 * That is the mechanism behind the rule that a password hash cannot reach a response: the
 * field is simply never selected (docs/PERMISSIONS.md section 5).
 */
import type { CurrentUser, Permission, UserDetail, UserSummary } from '@ekavist/shared';
import type { Prisma } from '@prisma/client';

export const USER_SUMMARY_SELECT = {
  id: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  designation: true,
} satisfies Prisma.UserSelect;

export const USER_DETAIL_SELECT = {
  ...USER_SUMMARY_SELECT,
  organizationId: true,
  phone: true,
  role: true,
  status: true,
  joiningDate: true,
  timezone: true,
  skills: true,
  totpEnabledAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  manager: { select: USER_SUMMARY_SELECT },
  notificationPreference: true,
} satisfies Prisma.UserSelect;

type UserSummaryRow = Prisma.UserGetPayload<{ select: typeof USER_SUMMARY_SELECT }>;
type UserDetailRow = Prisma.UserGetPayload<{ select: typeof USER_DETAIL_SELECT }>;

export function toUserSummary(row: UserSummaryRow): UserSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    designation: row.designation,
  };
}

export function toUserSummaryOrNull(row: UserSummaryRow | null | undefined): UserSummary | null {
  return row == null ? null : toUserSummary(row);
}

export function toUserDetail(row: UserDetailRow): UserDetail {
  return {
    ...toUserSummary(row),
    phone: row.phone,
    role: row.role,
    status: row.status,
    department: row.department,
    manager: toUserSummaryOrNull(row.manager),
    joiningDate: row.joiningDate?.toISOString().slice(0, 10) ?? null,
    timezone: row.timezone,
    skills: row.skills,
    twoFactorEnabled: row.totpEnabledAt != null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCurrentUser(
  row: UserDetailRow,
  organization: {
    id: string;
    name: string;
    timezone: string;
    workdayStart: string;
    lateAfter: string;
  },
  permissions: Permission[],
): CurrentUser {
  return {
    ...toUserDetail(row),
    permissions,
    organization,
    notificationPreferences: toPreferenceMap(row.notificationPreference),
  };
}

/** Defaults match the column defaults, so a user with no preference row still gets email. */
const PREFERENCE_DEFAULTS: Record<string, boolean> = {
  emailOnTaskAssigned: true,
  emailOnTaskDueSoon: true,
  emailOnTaskOverdue: true,
  emailOnMention: true,
  emailOnProjectAssigned: true,
  emailOnPhaseDecision: true,
  emailDailySummary: false,
  emailWeeklySummary: true,
};

export function toPreferenceMap(row: unknown): Record<string, boolean> {
  if (row == null || typeof row !== 'object') return { ...PREFERENCE_DEFAULTS };
  const source = row as Record<string, unknown>;
  const result: Record<string, boolean> = {};
  for (const key of Object.keys(PREFERENCE_DEFAULTS)) {
    const value = source[key];
    result[key] = typeof value === 'boolean' ? value : (PREFERENCE_DEFAULTS[key] as boolean);
  }
  return result;
}
