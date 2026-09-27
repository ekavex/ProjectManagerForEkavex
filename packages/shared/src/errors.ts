/**
 * Stable error codes. The API never returns a bare message: every failure carries one of
 * these codes so the UI can react to a specific condition, and so that changing the
 * wording of a message is not a breaking change.
 */
export const ERROR_CODES = {
  // --- Transport / generic -------------------------------------------------
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // --- Authentication ------------------------------------------------------
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',

  // --- Authorisation -------------------------------------------------------
  FORBIDDEN: 'FORBIDDEN',
  NOT_PROJECT_MEMBER: 'NOT_PROJECT_MEMBER',
  PROJECT_READ_ONLY: 'PROJECT_READ_ONLY',

  // --- Projects ------------------------------------------------------------
  PROJECT_CODE_TAKEN: 'PROJECT_CODE_TAKEN',
  PROJECT_LEAD_REQUIRED: 'PROJECT_LEAD_REQUIRED',
  PROJECT_STATUS_TRANSITION_INVALID: 'PROJECT_STATUS_TRANSITION_INVALID',
  PROJECT_CLOSURE_INCOMPLETE: 'PROJECT_CLOSURE_INCOMPLETE',
  MEMBER_ALREADY_ADDED: 'MEMBER_ALREADY_ADDED',
  MEMBER_IS_LEAD: 'MEMBER_IS_LEAD',

  // --- Waterfall -----------------------------------------------------------
  PHASE_GATE_BLOCKED: 'PHASE_GATE_BLOCKED',
  PHASE_NOT_SUBMITTED: 'PHASE_NOT_SUBMITTED',
  PHASE_TASKS_INCOMPLETE: 'PHASE_TASKS_INCOMPLETE',
  PHASE_APPROVER_IS_SUBMITTER: 'PHASE_APPROVER_IS_SUBMITTER',
  PHASE_ALREADY_DECIDED: 'PHASE_ALREADY_DECIDED',

  // --- WBS and tasks -------------------------------------------------------
  WBS_PARENT_INVALID: 'WBS_PARENT_INVALID',
  WBS_CYCLE: 'WBS_CYCLE',
  TASK_DEPENDENCY_CYCLE: 'TASK_DEPENDENCY_CYCLE',
  TASK_DEPENDENCY_DUPLICATE: 'TASK_DEPENDENCY_DUPLICATE',
  TASK_DEPENDENCY_SELF: 'TASK_DEPENDENCY_SELF',
  TASK_PREDECESSOR_INCOMPLETE: 'TASK_PREDECESSOR_INCOMPLETE',
  TASK_NOT_ASSIGNED_TO_YOU: 'TASK_NOT_ASSIGNED_TO_YOU',
  TASK_DATES_INVALID: 'TASK_DATES_INVALID',
  TASK_STATUS_TRANSITION_INVALID: 'TASK_STATUS_TRANSITION_INVALID',

  // --- Attendance ----------------------------------------------------------
  WORK_SESSION_ALREADY_OPEN: 'WORK_SESSION_ALREADY_OPEN',
  WORK_SESSION_NOT_OPEN: 'WORK_SESSION_NOT_OPEN',
  BREAK_ALREADY_OPEN: 'BREAK_ALREADY_OPEN',
  BREAK_NOT_OPEN: 'BREAK_NOT_OPEN',
  WORK_SESSION_OVERLAP: 'WORK_SESSION_OVERLAP',

  // --- Chat ----------------------------------------------------------------
  MESSAGE_NOT_EDITABLE: 'MESSAGE_NOT_EDITABLE',
  MESSAGE_ALREADY_PINNED: 'MESSAGE_ALREADY_PINNED',
  MESSAGE_NOT_PINNED: 'MESSAGE_NOT_PINNED',

  // --- Change requests -----------------------------------------------------
  CHANGE_REQUEST_ALREADY_DECIDED: 'CHANGE_REQUEST_ALREADY_DECIDED',
  CHANGE_REQUEST_ANALYSIS_REQUIRED: 'CHANGE_REQUEST_ANALYSIS_REQUIRED',

  // --- Import --------------------------------------------------------------
  IMPORT_VALIDATION_FAILED: 'IMPORT_VALIDATION_FAILED',
  IMPORT_JOB_NOT_PENDING: 'IMPORT_JOB_NOT_PENDING',

  // --- Users ---------------------------------------------------------------
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  CANNOT_DEACTIVATE_SELF: 'CANNOT_DEACTIVATE_SELF',
  CANNOT_DEMOTE_LAST_ADMIN: 'CANNOT_DEMOTE_LAST_ADMIN',
  USER_LEADS_ACTIVE_PROJECTS: 'USER_LEADS_ACTIVE_PROJECTS',

  // --- Integrations --------------------------------------------------------
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
  requestId: string;
}
