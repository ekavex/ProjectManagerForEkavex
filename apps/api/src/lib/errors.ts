/**
 * The application error model.
 *
 * Anything the API refuses to do throws an `AppError`. It carries a stable code, the HTTP
 * status, and a message that is safe to show a user. Anything else that escapes a handler
 * is an unexpected fault: the middleware logs it with its stack and answers with a generic
 * INTERNAL_ERROR, so server internals never reach the client (spec section 72).
 */
import { ERROR_CODES, type ApiErrorDetail, type ErrorCode } from '@ekavist/shared';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[] | undefined;
  /** The underlying failure, logged but never serialised to the client. */
  override readonly cause: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: ApiErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.details = options.details;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Default HTTP status for each code, so call sites rarely need to pass one. */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR_CODES.VALIDATION_FAILED]: 400,
  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.TOKEN_INVALID]: 401,
  [ERROR_CODES.REFRESH_TOKEN_REUSED]: 401,
  [ERROR_CODES.PASSWORD_INCORRECT]: 401,
  [ERROR_CODES.TWO_FACTOR_REQUIRED]: 401,
  [ERROR_CODES.TWO_FACTOR_INVALID]: 401,
  [ERROR_CODES.ACCOUNT_DISABLED]: 403,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.PROJECT_READ_ONLY]: 403,
  [ERROR_CODES.TASK_NOT_ASSIGNED_TO_YOU]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.NOT_PROJECT_MEMBER]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.EMAIL_TAKEN]: 409,
  [ERROR_CODES.PROJECT_CODE_TAKEN]: 409,
  [ERROR_CODES.MEMBER_ALREADY_ADDED]: 409,
  [ERROR_CODES.WORK_SESSION_ALREADY_OPEN]: 409,
  [ERROR_CODES.BREAK_ALREADY_OPEN]: 409,
  [ERROR_CODES.MESSAGE_ALREADY_PINNED]: 409,
  [ERROR_CODES.TASK_DEPENDENCY_DUPLICATE]: 409,
  [ERROR_CODES.PHASE_ALREADY_DECIDED]: 409,
  [ERROR_CODES.CHANGE_REQUEST_ALREADY_DECIDED]: 409,
  [ERROR_CODES.LEAVE_ALREADY_DECIDED]: 409,
  [ERROR_CODES.LEAVE_OVERLAP]: 409,
  [ERROR_CODES.TWO_FACTOR_ALREADY_ENABLED]: 409,
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};

function statusForCode(code: ErrorCode): number {
  // Anything not listed is a rule violation on an otherwise well-formed request.
  return STATUS_BY_CODE[code] ?? 422;
}

// --------------------------------------------------------------------------
// Constructors for the shapes used most often. They exist so call sites read as
// statements of fact rather than as error plumbing.
// --------------------------------------------------------------------------

export function notFound(what: string): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, `${what} was not found.`);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError(ERROR_CODES.FORBIDDEN, message);
}

export function unauthenticated(message = 'Please sign in to continue.'): AppError {
  return new AppError(ERROR_CODES.UNAUTHENTICATED, message);
}

export function conflict(code: ErrorCode, message: string): AppError {
  return new AppError(code, message);
}

export function invalid(code: ErrorCode, message: string, details?: ApiErrorDetail[]): AppError {
  return new AppError(code, message, details ? { details } : {});
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
