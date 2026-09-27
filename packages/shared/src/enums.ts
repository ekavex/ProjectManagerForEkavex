/**
 * Every status, role and category used anywhere in Ekavist.
 *
 * These names are mirrored one-for-one by the Prisma enums in
 * `apps/api/prisma/schema.prisma`. A value must never be written as a bare string
 * literal in application code: import the constant, so a rename is a compile error
 * rather than a silent behaviour change.
 */

export const ORG_ROLES = ['SUPER_ADMIN', 'PROJECT_LEAD', 'TEAM_MEMBER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROJECT_ROLES = ['LEAD', 'MEMBER', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_STATUSES = [
  'DRAFT',
  'PLANNED',
  'ACTIVE',
  'ON_HOLD',
  'AT_RISK',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses in which a project accepts ordinary modifications (business rule 20). */
export const MUTABLE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  'DRAFT',
  'PLANNED',
  'ACTIVE',
  'ON_HOLD',
  'AT_RISK',
];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PHASE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'APPROVED',
  'BLOCKED',
  'REWORK_REQUIRED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const PHASE_GATE_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type PhaseGateStatus = (typeof PHASE_GATE_STATUSES)[number];

export const TASK_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
  'UNDER_REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that mean the work is finished and no longer counts as outstanding. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED'];

/** Statuses a team member may set on a task assigned to them. */
export const MEMBER_SETTABLE_TASK_STATUSES: readonly TaskStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
  'UNDER_REVIEW',
  'COMPLETED',
];

export const DEPENDENCY_TYPES = [
  'FINISH_TO_START',
  'START_TO_START',
  'FINISH_TO_FINISH',
  'START_TO_FINISH',
] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

/** Only Finish-to-Start is enforced in v1 (spec section 20). */
export const SUPPORTED_DEPENDENCY_TYPES: readonly DependencyType[] = ['FINISH_TO_START'];

export const MILESTONE_STATUSES = [
  'PLANNED',
  'AT_RISK',
  'ACHIEVED',
  'MISSED',
  'CANCELLED',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const RACI_ROLES = ['RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED'] as const;
export type RaciRole = (typeof RACI_ROLES)[number];

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'HALF_DAY',
  'LEAVE',
  'ABSENT',
  'HOLIDAY',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'REQUIREMENTS',
  'DESIGN',
  'DEVELOPMENT',
  'TESTING',
  'REPORTS',
  'MEETING',
  'FINAL_DELIVERABLES',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const RESOURCE_KINDS = ['FILE', 'LINK', 'GOOGLE_DRIVE'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const NOTE_VISIBILITIES = ['PROJECT', 'LEADS_ONLY'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_STATUSES = ['OPEN', 'MONITORING', 'MITIGATED', 'CLOSED', 'OCCURRED'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const ISSUE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const CHANGE_REQUEST_STATUSES = [
  'REQUESTED',
  'IMPACT_ANALYSIS',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'IMPLEMENTED',
  'WITHDRAWN',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_DUE_TODAY',
  'TASK_OVERDUE',
  'TASK_BLOCKED',
  'TASK_COMPLETED',
  'PROJECT_ASSIGNED',
  'PROJECT_MEMBER_ADDED',
  'MENTION',
  'MESSAGE_RECEIVED',
  'MESSAGE_PINNED',
  'PHASE_APPROVAL_REQUIRED',
  'PHASE_APPROVED',
  'PHASE_REJECTED',
  'CHANGE_REQUEST_CREATED',
  'CHANGE_REQUEST_DECIDED',
  'RISK_ASSIGNED',
  'ISSUE_ASSIGNED',
  'LEAD_OVERDUE_DIGEST',
  'DAILY_SUMMARY',
  'WEEKLY_SUMMARY',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const HEALTH_LEVELS = ['OK', 'ATTENTION', 'CRITICAL'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const IMPORT_JOB_STATUSES = ['PARSED', 'CONFIRMED', 'FAILED', 'CANCELLED'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/** The eight default Waterfall phases (spec section 13). */
export const DEFAULT_PHASE_TEMPLATE = [
  { name: 'Initiation', description: 'Charter, stakeholders and project kickoff.' },
  { name: 'Requirements', description: 'Elicit, document and baseline the requirements.' },
  { name: 'Planning', description: 'Schedule, resources, WBS and risk planning.' },
  { name: 'Design', description: 'Architecture and detailed design.' },
  { name: 'Execution', description: 'Build and integrate the solution.' },
  { name: 'Testing', description: 'Verification and validation.' },
  { name: 'Deployment', description: 'Release and delivery to the client.' },
  { name: 'Closure', description: 'Handover, final report and lessons learned.' },
] as const;
