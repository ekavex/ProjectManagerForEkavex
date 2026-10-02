/**
 * Excel import (spec sections 66 to 68, decision D-009).
 *
 * Two steps, always. An upload is parsed and validated into an `ImportJob` and nothing
 * touches the project tables. The user reviews the preview, and only then confirms — at
 * which point the whole import runs inside one transaction that rolls back completely on
 * any error. A half-imported tracker is worse than a rejected one.
 */
import {
  ERROR_CODES,
  TASK_STATUSES,
  type ImportIssue,
  type ImportMappingInput,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportResult,
  type ImportTargetField,
  type Priority,
  type TaskStatus,
} from '@ekavist/shared';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { Db, RootDb } from '../db/prisma.js';
import { topologicalOrder } from '../domain/dependency.js';
import { dateOnlyToDateColumn, isDateOnly, type DateOnly } from '../domain/time.js';
import { numberWbsTree } from '../domain/wbs.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor, ProjectContext } from '../policy/actor.js';
import { assertProjectMutable, assertProjectPermission } from '../policy/project-access.js';
import { recordAudit, recordActivity } from './audit.service.js';
import { recomputeProjectProgress } from './rollup.service.js';

/** One parsed spreadsheet row, before anything is written. */
interface ParsedRow {
  row: number;
  wbsCode: string | null;
  phaseName: string | null;
  taskName: string | null;
  description: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  estimatedHours: number | null;
  status: TaskStatus | null;
  progress: number | null;
  priority: Priority | null;
  predecessor: string | null;
  milestone: string | null;
}

const STATUS_ALIASES: Record<string, TaskStatus> = {
  'not started': 'NOT_STARTED',
  notstarted: 'NOT_STARTED',
  todo: 'NOT_STARTED',
  'to do': 'NOT_STARTED',
  new: 'NOT_STARTED',
  'in progress': 'IN_PROGRESS',
  inprogress: 'IN_PROGRESS',
  wip: 'IN_PROGRESS',
  ongoing: 'IN_PROGRESS',
  blocked: 'BLOCKED',
  'on hold': 'BLOCKED',
  'under review': 'UNDER_REVIEW',
  review: 'UNDER_REVIEW',
  completed: 'COMPLETED',
  complete: 'COMPLETED',
  done: 'COMPLETED',
  closed: 'COMPLETED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  dropped: 'CANCELLED',
};

const PRIORITY_ALIASES: Record<string, Priority> = {
  low: 'LOW',
  medium: 'MEDIUM',
  normal: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
  urgent: 'CRITICAL',
};

/** Column headers the importer recognises without being told. */
const HEADER_GUESSES: { pattern: RegExp; field: ImportTargetField }[] = [
  { pattern: /^wbs/i, field: 'WBS_CODE' },
  { pattern: /^phase/i, field: 'PHASE_NAME' },
  { pattern: /^(task|activity|work item|deliverable)/i, field: 'TASK_NAME' },
  { pattern: /^(description|details|notes?)/i, field: 'DESCRIPTION' },
  { pattern: /^(owner email|email)/i, field: 'OWNER_EMAIL' },
  { pattern: /^(owner|assignee|assigned|responsible)/i, field: 'OWNER_NAME' },
  { pattern: /^(start|planned start)/i, field: 'START_DATE' },
  { pattern: /^(end|due|finish|target)/i, field: 'DUE_DATE' },
  { pattern: /^(estimate|estimated|effort|hours)/i, field: 'ESTIMATED_HOURS' },
  { pattern: /^status/i, field: 'STATUS' },
  { pattern: /^(progress|complete|%)/i, field: 'PROGRESS' },
  { pattern: /^priority/i, field: 'PRIORITY' },
  { pattern: /^(predecessor|depends|dependency)/i, field: 'PREDECESSOR' },
  { pattern: /^milestone/i, field: 'MILESTONE' },
];

// ------------------------------------------------------------------- parsing

export async function parseUpload(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  file: { originalname: string; buffer: Buffer },
  mapping: Partial<ImportMappingInput>,
): Promise<ImportPreview> {
  assertProjectPermission(context, 'import:run');
  assertProjectMutable(context);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.IMPORT_VALIDATION_FAILED,
      'That file could not be read as an Excel workbook. Save it as .xlsx and try again.',
      { cause: error },
    );
  }

  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const sheet =
    mapping.sheet != null ? workbook.getWorksheet(mapping.sheet) : workbook.worksheets[0];

  if (sheet == null) {
    throw new AppError(
      ERROR_CODES.IMPORT_VALIDATION_FAILED,
      `That workbook has no sheet named "${mapping.sheet ?? ''}". Sheets: ${sheetNames.join(', ')}.`,
    );
  }

  const headerRow = mapping.headerRow ?? 1;
  const headers = readHeaders(sheet, headerRow);
  const columns = mapping.columns ?? guessColumns(headers);

  const { rows, issues } = readRows(sheet, headerRow, headers, columns);

  // --- cross-row validation ---------------------------------------------
  const knownEmails = new Set(
    (
      await db.user.findMany({
        where: { organizationId: actor.organizationId },
        select: { email: true },
      })
    ).map((user) => user.email.toLowerCase()),
  );
  const knownNames = new Map(
    (
      await db.user.findMany({
        where: { organizationId: actor.organizationId },
        select: { id: true, fullName: true },
      })
    ).map((user) => [user.fullName.toLowerCase(), user.id]),
  );

  const unknownUsers = new Set<string>();
  const seenTasks = new Set<string>();

  for (const row of rows) {
    if (row.ownerEmail != null && !knownEmails.has(row.ownerEmail.toLowerCase())) {
      unknownUsers.add(row.ownerEmail);
      issues.push({
        row: row.row,
        column: 'OWNER_EMAIL',
        severity: mapping.createMissingUsers === true ? 'WARNING' : 'ERROR',
        code: 'UNKNOWN_USER',
        message:
          mapping.createMissingUsers === true
            ? `${row.ownerEmail} has no account; one will be created and invited.`
            : `${row.ownerEmail} has no Ekavist account. Create the account first, or allow the import to create it.`,
      });
    } else if (
      row.ownerEmail == null &&
      row.ownerName != null &&
      !knownNames.has(row.ownerName.toLowerCase())
    ) {
      unknownUsers.add(row.ownerName);
      issues.push({
        row: row.row,
        column: 'OWNER_NAME',
        severity: 'WARNING',
        code: 'UNKNOWN_USER_NAME',
        message: `No account matches "${row.ownerName}". The task will be imported unassigned.`,
      });
    }

    if (row.taskName != null) {
      const key = `${row.wbsCode ?? ''}|${row.taskName.toLowerCase()}`;
      if (seenTasks.has(key)) {
        issues.push({
          row: row.row,
          column: 'TASK_NAME',
          severity: 'WARNING',
          code: 'DUPLICATE_TASK',
          message: `"${row.taskName}" appears more than once under the same WBS item.`,
        });
      }
      seenTasks.add(key);
    }
  }

  // Circular dependencies are rejected before anything is written (spec section 68).
  const cycleIssue = detectCycles(rows);
  if (cycleIssue != null) issues.push(cycleIssue);

  // --- summary ------------------------------------------------------------
  const phases = [
    ...new Set(rows.map((row) => row.phaseName).filter((n): n is string => n != null)),
  ];
  const wbsCodes = new Set(rows.map((row) => row.wbsCode).filter((c): c is string => c != null));
  const taskRows = rows.filter((row) => row.taskName != null);
  const errorRows = new Set(
    issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.row),
  );
  const warningRows = new Set(
    issues.filter((issue) => issue.severity === 'WARNING').map((issue) => issue.row),
  );

  const previewRows: ImportPreviewRow[] = rows.map((row) => ({
    row: row.row,
    wbsCode: row.wbsCode,
    phaseName: row.phaseName,
    taskName: row.taskName,
    ownerEmail: row.ownerEmail,
    startDate: row.startDate,
    dueDate: row.dueDate,
    status: row.status,
    progress: row.progress,
    predecessor: row.predecessor,
    valid: !errorRows.has(row.row),
  }));

  const canConfirm = errorRows.size === 0 && taskRows.length > 0;
  const checksum = createHash('sha256')
    .update(JSON.stringify({ rows, columns }))
    .digest('hex')
    .slice(0, 32);

  const resolvedMapping: ImportMappingInput = {
    sheet: sheet.name,
    headerRow,
    columns,
    createMissingUsers: mapping.createMissingUsers ?? false,
  };

  const summary: ImportPreview['summary'] = {
    totalRows: rows.length,
    validRows: rows.length - errorRows.size,
    errorRows: errorRows.size,
    warningRows: warningRows.size,
    phasesToCreate: phases,
    wbsToCreate: wbsCodes.size,
    tasksToCreate: taskRows.length,
    unknownUsers: [...unknownUsers],
  };

  const job = await db.importJob.create({
    data: {
      projectId: context.projectId,
      uploadedById: actor.id,
      fileName: file.originalname,
      checksum,
      status: 'PARSED',
      mapping: resolvedMapping as unknown as Prisma.InputJsonValue,
      parsedRows: rows as unknown as Prisma.InputJsonValue,
      issues: issues as unknown as Prisma.InputJsonValue,
      summary: summary as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  await recordAudit(db, {
    actorId: actor.id,
    projectId: context.projectId,
    action: 'import.parsed',
    entityType: 'ImportJob',
    entityId: job.id,
    newValue: { fileName: file.originalname, ...summary },
  });

  return {
    jobId: job.id,
    checksum,
    sheets: sheetNames,
    detectedColumns: headers.map((header) => header.label),
    mapping: resolvedMapping,
    rows: previewRows,
    issues,
    summary,
    canConfirm,
  };
}

interface HeaderCell {
  column: number;
  label: string;
}

function readHeaders(sheet: ExcelJS.Worksheet, headerRow: number): HeaderCell[] {
  const headers: HeaderCell[] = [];
  const row = sheet.getRow(headerRow);
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const label = cellText(cell);
    if (label !== '') headers.push({ column: columnNumber, label });
  });
  return headers;
}

function guessColumns(headers: HeaderCell[]): Record<string, ImportTargetField> {
  const columns: Record<string, ImportTargetField> = {};
  for (const header of headers) {
    const guess = HEADER_GUESSES.find((candidate) => candidate.pattern.test(header.label.trim()));
    columns[header.label] = guess?.field ?? 'IGNORE';
  }
  return columns;
}

function readRows(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  headers: HeaderCell[],
  columns: Record<string, ImportTargetField>,
): { rows: ParsedRow[]; issues: ImportIssue[] } {
  const rows: ParsedRow[] = [];
  const issues: ImportIssue[] = [];

  const columnFor = (field: ImportTargetField): number | null =>
    headers.find((header) => columns[header.label] === field)?.column ?? null;

  const map = {
    wbs: columnFor('WBS_CODE'),
    phase: columnFor('PHASE_NAME'),
    task: columnFor('TASK_NAME'),
    description: columnFor('DESCRIPTION'),
    ownerEmail: columnFor('OWNER_EMAIL'),
    ownerName: columnFor('OWNER_NAME'),
    start: columnFor('START_DATE'),
    due: columnFor('DUE_DATE'),
    hours: columnFor('ESTIMATED_HOURS'),
    status: columnFor('STATUS'),
    progress: columnFor('PROGRESS'),
    priority: columnFor('PRIORITY'),
    predecessor: columnFor('PREDECESSOR'),
    milestone: columnFor('MILESTONE'),
  };

  if (map.task == null) {
    issues.push({
      row: headerRow,
      column: null,
      severity: 'ERROR',
      code: 'NO_TASK_COLUMN',
      message:
        'No column is mapped to the task name. Map one before importing — a row without a task is not work.',
    });
  }

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const get = (column: number | null): string =>
      column == null ? '' : cellText(row.getCell(column));

    const taskName = get(map.task).trim();
    const wbsCode = get(map.wbs).trim();
    const phaseName = get(map.phase).trim();

    // A spacer row is one where *every* mapped column is empty. A row that carries dates
    // or an owner but no task name is not a spacer — it is a mistake, and is reported
    // below rather than being skipped silently.
    const everyMappedCellEmpty = Object.values(map).every((column) => get(column).trim() === '');
    if (everyMappedCellEmpty) return;

    const startDate = parseDate(get(map.start), rowNumber, 'START_DATE', issues, row, map.start);
    const dueDate = parseDate(get(map.due), rowNumber, 'DUE_DATE', issues, row, map.due);

    if (startDate != null && dueDate != null && dueDate < startDate) {
      issues.push({
        row: rowNumber,
        column: 'DUE_DATE',
        severity: 'ERROR',
        code: 'DATES_REVERSED',
        message: `The due date (${dueDate}) is before the start date (${startDate}).`,
      });
    }

    const statusText = get(map.status).trim().toLowerCase();
    let status: TaskStatus | null = null;
    if (statusText !== '') {
      status =
        STATUS_ALIASES[statusText] ??
        (TASK_STATUSES.includes(statusText.toUpperCase() as TaskStatus)
          ? (statusText.toUpperCase() as TaskStatus)
          : null);
      if (status == null) {
        issues.push({
          row: rowNumber,
          column: 'STATUS',
          severity: 'WARNING',
          code: 'UNKNOWN_STATUS',
          message: `"${get(map.status)}" is not a status Ekavist recognises; the task will be imported as Not started.`,
        });
      }
    }

    const progress = parsePercent(get(map.progress), rowNumber, issues);
    const hoursText = get(map.hours).trim();
    const estimatedHours = hoursText === '' ? null : Number(hoursText.replace(/[^\d.-]/g, ''));

    if (estimatedHours != null && Number.isNaN(estimatedHours)) {
      issues.push({
        row: rowNumber,
        column: 'ESTIMATED_HOURS',
        severity: 'WARNING',
        code: 'BAD_HOURS',
        message: `"${hoursText}" is not a number of hours; it will be left blank.`,
      });
    }

    if (taskName === '' && wbsCode !== '') {
      // A WBS-only row is a heading; that is valid and common in trackers.
    } else if (taskName === '') {
      issues.push({
        row: rowNumber,
        column: 'TASK_NAME',
        severity: 'ERROR',
        code: 'MISSING_TASK_NAME',
        message: 'This row has no task name.',
      });
    }

    const ownerEmail = get(map.ownerEmail).trim();
    const priorityText = get(map.priority).trim().toLowerCase();

    rows.push({
      row: rowNumber,
      wbsCode: wbsCode === '' ? null : wbsCode,
      phaseName: phaseName === '' ? null : phaseName,
      taskName: taskName === '' ? null : taskName,
      description: get(map.description).trim() || null,
      ownerEmail: ownerEmail === '' ? null : ownerEmail,
      ownerName: get(map.ownerName).trim() || null,
      startDate,
      dueDate,
      estimatedHours:
        estimatedHours == null || Number.isNaN(estimatedHours) ? null : estimatedHours,
      status,
      progress,
      priority: PRIORITY_ALIASES[priorityText] ?? null,
      predecessor: get(map.predecessor).trim() || null,
      milestone: get(map.milestone).trim() || null,
    });
  });

  return { rows, issues };
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return String((value as { result: unknown }).result ?? '');
    if ('richText' in value) {
      return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
    }
  }
  return String(value);
}

function parseDate(
  text: string,
  rowNumber: number,
  column: string,
  issues: ImportIssue[],
  row: ExcelJS.Row,
  columnIndex: number | null,
): DateOnly | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Excel dates arrive as real Date objects when the cell is formatted as a date.
  if (columnIndex != null) {
    const raw = row.getCell(columnIndex).value;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  }

  if (isDateOnly(trimmed)) return trimmed;

  // Day-first and month-first both appear in real trackers; day-first is assumed because
  // the ambiguity is reported rather than guessed silently.
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (match != null) {
    const [, first, second, yearPart] = match;
    const day = Number(first);
    const month = Number(second);
    const year = Number(yearPart!.length === 2 ? `20${yearPart}` : yearPart);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (day <= 12 && month <= 12 && day !== month) {
        issues.push({
          row: rowNumber,
          column,
          severity: 'WARNING',
          code: 'AMBIGUOUS_DATE',
          message: `"${trimmed}" could be day-first or month-first; it was read as ${day}/${month}/${year}.`,
        });
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  issues.push({
    row: rowNumber,
    column,
    severity: 'ERROR',
    code: 'BAD_DATE',
    message: `"${trimmed}" is not a date Ekavist can read. Use YYYY-MM-DD.`,
  });
  return null;
}

function parsePercent(text: string, rowNumber: number, issues: ImportIssue[]): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const numeric = Number(trimmed.replace('%', '').trim());
  if (Number.isNaN(numeric)) {
    issues.push({
      row: rowNumber,
      column: 'PROGRESS',
      severity: 'WARNING',
      code: 'BAD_PROGRESS',
      message: `"${trimmed}" is not a percentage; it will be left at zero.`,
    });
    return null;
  }

  // A cell formatted as a percentage arrives as a fraction.
  const percent =
    numeric > 0 && numeric <= 1 && trimmed.includes('%') === false ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Rejects `A -> B -> C -> A` before anything is written. */
function detectCycles(rows: readonly ParsedRow[]): ImportIssue | null {
  const byName = new Map<string, string>();
  for (const row of rows) {
    if (row.taskName != null) byName.set(row.taskName.toLowerCase(), row.taskName);
    if (row.wbsCode != null && row.taskName != null)
      byName.set(row.wbsCode.toLowerCase(), row.taskName);
  }

  const ids = [...new Set(rows.map((row) => row.taskName).filter((n): n is string => n != null))];
  const edges: { predecessorId: string; successorId: string }[] = [];

  for (const row of rows) {
    if (row.taskName == null || row.predecessor == null) continue;
    for (const reference of row.predecessor.split(/[,;]/)) {
      const key = reference.trim().toLowerCase();
      const predecessor = byName.get(key);
      if (predecessor != null) {
        edges.push({ predecessorId: predecessor, successorId: row.taskName });
      }
    }
  }

  if (edges.length === 0) return null;
  if (topologicalOrder(ids, edges) != null) return null;

  return {
    row: 0,
    column: 'PREDECESSOR',
    severity: 'ERROR',
    code: 'DEPENDENCY_CYCLE',
    message:
      'The predecessor column forms a loop: some tasks end up waiting for themselves. Fix the dependencies in the spreadsheet and upload it again.',
  };
}

// ---------------------------------------------------------------- confirming

export async function confirmImport(
  db: RootDb,
  actor: Actor,
  context: ProjectContext,
  jobId: string,
  checksum: string,
): Promise<ImportResult> {
  assertProjectPermission(context, 'import:run');
  assertProjectMutable(context);

  const job = await db.importJob.findFirst({
    where: { id: jobId, projectId: context.projectId },
    select: {
      id: true,
      status: true,
      checksum: true,
      parsedRows: true,
      mapping: true,
      issues: true,
    },
  });
  if (job == null) throw notFound('That import');

  if (job.status !== 'PARSED') {
    throw new AppError(
      ERROR_CODES.IMPORT_JOB_NOT_PENDING,
      'This import has already been confirmed or cancelled. Upload the file again to retry.',
    );
  }
  // A stale preview must not be confirmed: the user would be approving something they
  // are no longer looking at.
  if (job.checksum !== checksum) {
    throw new AppError(
      ERROR_CODES.IMPORT_JOB_NOT_PENDING,
      'The preview is out of date. Upload the file again and review it before confirming.',
    );
  }

  const issues = job.issues as unknown as ImportIssue[];
  if (issues.some((issue) => issue.severity === 'ERROR')) {
    throw new AppError(
      ERROR_CODES.IMPORT_VALIDATION_FAILED,
      'This file still has errors. Fix them in the spreadsheet and upload it again.',
    );
  }

  const rows = job.parsedRows as unknown as ParsedRow[];
  const mapping = job.mapping as unknown as ImportMappingInput;

  const result = await db.$transaction(
    async (tx) => {
      const counts: ImportResult = {
        jobId,
        phasesCreated: 0,
        wbsCreated: 0,
        tasksCreated: 0,
        dependenciesCreated: 0,
        milestonesCreated: 0,
        usersCreated: 0,
      };

      // --- people --------------------------------------------------------
      const usersByEmail = new Map(
        (
          await tx.user.findMany({
            where: { organizationId: actor.organizationId },
            select: { id: true, email: true, fullName: true },
          })
        ).map((user) => [user.email.toLowerCase(), user.id]),
      );
      const usersByName = new Map(
        (
          await tx.user.findMany({
            where: { organizationId: actor.organizationId },
            select: { id: true, fullName: true },
          })
        ).map((user) => [user.fullName.toLowerCase(), user.id]),
      );

      if (mapping.createMissingUsers) {
        for (const row of rows) {
          if (row.ownerEmail == null) continue;
          const key = row.ownerEmail.toLowerCase();
          if (usersByEmail.has(key)) continue;

          const created = await tx.user.create({
            data: {
              organizationId: actor.organizationId,
              email: key,
              fullName: row.ownerName ?? row.ownerEmail,
              role: 'TEAM_MEMBER',
              // No password: they receive an invitation and choose their own.
              notificationPreference: { create: {} },
            },
            select: { id: true },
          });
          usersByEmail.set(key, created.id);
          counts.usersCreated += 1;
        }
      }

      const resolveOwner = (row: ParsedRow): string | null => {
        if (row.ownerEmail != null) return usersByEmail.get(row.ownerEmail.toLowerCase()) ?? null;
        if (row.ownerName != null) return usersByName.get(row.ownerName.toLowerCase()) ?? null;
        return null;
      };

      // --- phases --------------------------------------------------------
      const existingPhases = await tx.phase.findMany({
        where: { projectId: context.projectId },
        select: { id: true, name: true, sequence: true },
      });
      const phasesByName = new Map(
        existingPhases.map((phase) => [phase.name.toLowerCase(), phase.id]),
      );
      let nextSequence = Math.max(0, ...existingPhases.map((phase) => phase.sequence)) + 1;

      for (const name of new Set(
        rows.map((row) => row.phaseName).filter((n): n is string => n != null),
      )) {
        if (phasesByName.has(name.toLowerCase())) continue;
        const created = await tx.phase.create({
          data: { projectId: context.projectId, name, sequence: nextSequence++ },
          select: { id: true },
        });
        phasesByName.set(name.toLowerCase(), created.id);
        counts.phasesCreated += 1;
      }

      // --- WBS -----------------------------------------------------------
      // Codes in the sheet ("1", "1.2", "1.2.3") describe the hierarchy, so the parent of
      // "1.2.3" is whichever row carries "1.2".
      const wbsRows = rows.filter((row) => row.wbsCode != null);
      const wbsIdByCode = new Map<string, string>();
      const sorted = [...wbsRows].sort(
        (a, b) => (a.wbsCode as string).split('.').length - (b.wbsCode as string).split('.').length,
      );

      for (const row of sorted) {
        const code = row.wbsCode as string;
        if (wbsIdByCode.has(code)) continue;

        const parentCode = code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : null;
        const parentId = parentCode == null ? null : (wbsIdByCode.get(parentCode) ?? null);
        const phaseId =
          row.phaseName != null ? (phasesByName.get(row.phaseName.toLowerCase()) ?? null) : null;

        const created = await tx.wbsItem.create({
          data: {
            projectId: context.projectId,
            phaseId,
            parentId,
            // A placeholder; the whole tree is renumbered below.
            code: `import-${code}-${counts.wbsCreated}`,
            position: counts.wbsCreated,
            name: row.taskName ?? code,
            ownerId: resolveOwner(row),
            plannedStart: dateOnlyToDateColumn(row.startDate),
            plannedEnd: dateOnlyToDateColumn(row.dueDate),
          },
          select: { id: true },
        });
        wbsIdByCode.set(code, created.id);
        counts.wbsCreated += 1;
      }

      // --- tasks ---------------------------------------------------------
      const project = await tx.project.findUniqueOrThrow({
        where: { id: context.projectId },
        select: { taskCounter: true, leadId: true },
      });
      let counter = project.taskCounter;

      const memberIds = new Set(
        (
          await tx.projectMember.findMany({
            where: { projectId: context.projectId },
            select: { userId: true },
          })
        ).map((member) => member.userId),
      );

      const taskIdByName = new Map<string, string>();

      for (const row of rows) {
        if (row.taskName == null) continue;
        // A row that only defines a WBS heading became a WBS item, not a task.
        if (
          row.wbsCode != null &&
          wbsIdByCode.get(row.wbsCode) != null &&
          row.predecessor == null &&
          row.dueDate == null &&
          row.status == null
        ) {
          continue;
        }

        const ownerId = resolveOwner(row);
        // Importing does not quietly add people to the project; an owner who is not a
        // member is added, because otherwise the assignment would be refused.
        if (ownerId != null && !memberIds.has(ownerId)) {
          await tx.projectMember.create({
            data: { projectId: context.projectId, userId: ownerId, projectRole: 'MEMBER' },
          });
          memberIds.add(ownerId);
        }

        counter += 1;
        const status = row.status ?? 'NOT_STARTED';
        const created = await tx.task.create({
          data: {
            projectId: context.projectId,
            phaseId:
              row.phaseName != null
                ? (phasesByName.get(row.phaseName.toLowerCase()) ?? null)
                : null,
            wbsItemId: row.wbsCode != null ? (wbsIdByCode.get(row.wbsCode) ?? null) : null,
            reference: `T-${counter}`,
            name: row.taskName,
            description: row.description,
            status,
            priority: row.priority ?? 'MEDIUM',
            progress: status === 'COMPLETED' ? 100 : (row.progress ?? 0),
            completedAt: status === 'COMPLETED' ? new Date() : null,
            startDate: dateOnlyToDateColumn(row.startDate),
            dueDate: dateOnlyToDateColumn(row.dueDate),
            estimatedHours: row.estimatedHours,
            accountableId: project.leadId,
            createdById: actor.id,
            ...(ownerId != null
              ? { assignments: { create: { userId: ownerId, isPrimary: true } } }
              : {}),
          },
          select: { id: true },
        });

        taskIdByName.set(row.taskName.toLowerCase(), created.id);
        if (row.wbsCode != null) taskIdByName.set(row.wbsCode.toLowerCase(), created.id);
        counts.tasksCreated += 1;

        if (row.milestone != null && row.milestone !== '' && row.dueDate != null) {
          await tx.milestone.create({
            data: {
              projectId: context.projectId,
              name: row.milestone,
              date: dateOnlyToDateColumn(row.dueDate) as Date,
              status: status === 'COMPLETED' ? 'ACHIEVED' : 'PLANNED',
              tasks: { create: { taskId: created.id } },
            },
          });
          counts.milestonesCreated += 1;
        }
      }

      await tx.project.update({
        where: { id: context.projectId },
        data: { taskCounter: counter },
      });

      // --- dependencies ---------------------------------------------------
      for (const row of rows) {
        if (row.taskName == null || row.predecessor == null) continue;
        const successorId = taskIdByName.get(row.taskName.toLowerCase());
        if (successorId == null) continue;

        for (const reference of row.predecessor.split(/[,;]/)) {
          const predecessorId = taskIdByName.get(reference.trim().toLowerCase());
          if (predecessorId == null || predecessorId === successorId) continue;

          await tx.taskDependency.create({
            data: {
              projectId: context.projectId,
              predecessorId,
              successorId,
              type: 'FINISH_TO_START',
            },
          });
          counts.dependenciesCreated += 1;
        }
      }

      // --- renumber and roll up -------------------------------------------
      const allWbs = await tx.wbsItem.findMany({
        where: { projectId: context.projectId },
        select: { id: true, parentId: true, position: true },
      });
      for (const item of allWbs) {
        await tx.wbsItem.update({ where: { id: item.id }, data: { code: `~${item.id}` } });
      }
      for (const numbered of numberWbsTree(allWbs)) {
        await tx.wbsItem.update({
          where: { id: numbered.id },
          data: { code: numbered.code, depth: numbered.depth, position: numbered.position },
        });
      }

      await recomputeProjectProgress(tx, context.projectId);

      await tx.importJob.update({
        where: { id: jobId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          result: counts as unknown as Prisma.InputJsonValue,
        },
      });

      await recordAudit(tx, {
        actorId: actor.id,
        projectId: context.projectId,
        action: 'import.confirmed',
        entityType: 'ImportJob',
        entityId: jobId,
        newValue: counts as unknown as Record<string, unknown>,
      });
      await recordActivity(tx, {
        projectId: context.projectId,
        actorId: actor.id,
        verb: 'imported',
        summary: `${actor.fullName} imported ${counts.tasksCreated} task(s) from a spreadsheet`,
        entityType: 'ImportJob',
        entityId: jobId,
      });

      return counts;
    },
    // A large tracker takes a while; the whole thing still commits or rolls back as one.
    { timeout: 120_000, maxWait: 10_000 },
  );

  return result;
}

export async function getImportJob(db: Db, projectId: string, jobId: string) {
  const job = await db.importJob.findFirst({
    where: { id: jobId, projectId },
    select: {
      id: true,
      fileName: true,
      status: true,
      checksum: true,
      issues: true,
      summary: true,
      result: true,
      createdAt: true,
      confirmedAt: true,
    },
  });
  if (job == null) throw notFound('That import');
  return job;
}
