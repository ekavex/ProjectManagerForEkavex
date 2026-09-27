/**
 * The last line of the request pipeline.
 *
 * An `AppError` is a decision the application made: its code and message go to the client
 * as they are. Anything else is a fault: it is logged with its stack and the client gets a
 * generic message, because server internals are not the user's business (spec section 72).
 */
import { ERROR_CODES, type ApiErrorBody } from '@ekavist/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { AppError, isAppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  const bodyOut: ApiErrorBody = {
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `No route matches ${req.method} ${req.path}.`,
    },
    requestId: req.requestId,
  };
  res.status(404).json(bodyOut);
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = toAppError(error);

  if (appError.status >= 500) {
    logger.error(
      {
        err: appError.cause ?? appError,
        requestId: req.requestId,
        path: req.path,
        method: req.method,
      },
      'Unhandled error while serving a request',
    );
  } else {
    logger.debug(
      { code: appError.code, requestId: req.requestId, path: req.path, method: req.method },
      appError.message,
    );
  }

  const payload: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
    requestId: req.requestId,
  };

  res.status(appError.status).json(payload);
};

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, 'Some fields need attention.', {
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        `That file is larger than the ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)} MB limit.`,
        { cause: error },
      );
    }
    return new AppError(ERROR_CODES.VALIDATION_FAILED, 'That upload could not be accepted.', {
      cause: error,
    });
  }

  // Body-parser rejects malformed JSON with a SyntaxError carrying a status.
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: number }).status === 400
  ) {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, 'The request body is not valid JSON.', {
      cause: error,
    });
  }

  return new AppError(
    ERROR_CODES.INTERNAL_ERROR,
    'Something went wrong on our side. The problem has been logged and nothing you entered was lost.',
    { status: 500, cause: error },
  );
}
