/**
 * Excel import endpoints.
 *
 * Upload and confirm are separate requests on purpose: nothing reaches the project tables
 * until a person has seen the preview and agreed to it (decision D-009).
 */
import { ERROR_CODES, confirmImportSchema, type ConfirmImportInput } from '@ekavist/shared';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../lib/errors.js';
import * as importService from '../../services/import.service.js';
import { body, requireActor, requireProjectContext } from '../context.js';
import { handler, validate } from '../middleware/validate.js';

/**
 * The workbook is held in memory and never written to disk: it is parsed, turned into an
 * `ImportJob` row, and discarded. There is no uploaded-file path to secure because there
 * is no uploaded file.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const isSpreadsheet =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      /\.xlsx?$/i.test(file.originalname);

    if (!isSpreadsheet) {
      callback(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Upload an Excel workbook (.xlsx). Other file types are not accepted.',
        ),
      );
      return;
    }
    callback(null, true);
  },
});

export const importRouter: Router = Router({ mergeParams: true });

importRouter.post(
  '/',
  upload.single('file'),
  handler(async (req, res) => {
    const file = req.file;
    if (file == null) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file was uploaded.');
    }

    // The mapping arrives as a JSON string beside the file, because a multipart body
    // cannot carry nested objects.
    let mapping: Record<string, unknown> = {};
    const raw = (req.body as { mapping?: unknown }).mapping;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        mapping = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The column mapping is not valid JSON.');
      }
    }

    const preview = await importService.parseUpload(
      prisma,
      requireActor(req),
      requireProjectContext(req),
      { originalname: file.originalname, buffer: file.buffer },
      mapping,
    );

    res.status(201).json(preview);
  }),
);

importRouter.get(
  '/:jobId',
  handler(async (req, res) => {
    res.json(
      await importService.getImportJob(
        prisma,
        requireProjectContext(req).projectId,
        req.params.jobId as string,
      ),
    );
  }),
);

importRouter.post(
  '/:jobId/confirm',
  validate({ body: confirmImportSchema }),
  handler(async (req, res) => {
    res.json(
      await importService.confirmImport(
        prisma,
        requireActor(req),
        requireProjectContext(req),
        req.params.jobId as string,
        body<ConfirmImportInput>(req).checksum,
      ),
    );
  }),
);
