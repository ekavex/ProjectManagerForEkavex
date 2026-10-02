/**
 * The Excel importer (spec sections 66 to 68): upload, map columns, validate, preview,
 * confirm. Nothing is written to the project until the last step, and the server refuses
 * to confirm while any row has an error.
 */
import type { ImportPreview, ImportResult, ProjectDetail } from '@ekavist/shared';
import { IMPORT_TARGET_FIELDS } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, useToast } from '../../components/ui/overlays.js';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { ApiError, api, upload } from '../../lib/api.js';
import { humanise } from '../../lib/format.js';

type Mapping = ImportPreview['mapping'];

export function ImportModal({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setFile(null);
    setPreview(null);
    setMapping(null);
    setError(null);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const check = useMutation({
    mutationFn: async ({ workbook, with: chosen }: { workbook: File; with: Mapping | null }) => {
      const form = new FormData();
      form.append('file', workbook);
      if (chosen != null) form.append('mapping', JSON.stringify(chosen));
      return upload<ImportPreview>(`/projects/${project.id}/import`, form);
    },
    onSuccess: (result) => {
      setError(null);
      setPreview(result);
      setMapping(result.mapping);
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : 'Could not read that workbook.'),
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.post<ImportResult>(`/projects/${project.id}/import/${preview?.jobId}/confirm`, {
        checksum: preview?.checksum,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success(
        `Imported ${result.tasksCreated} tasks, ${result.wbsCreated} WBS items and ${result.phasesCreated} phases.`,
      );
      close();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : 'The import did not complete.'),
  });

  const errors = preview?.issues.filter((issue) => issue.severity === 'ERROR') ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === 'WARNING') ?? [];

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import from Excel"
      description="Upload a project tracker, check how its columns map, review the preview, then confirm."
      size="xl"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          {preview != null && (
            <Button
              variant="primary"
              loading={confirm.isPending}
              disabled={!preview.canConfirm}
              onClick={() => confirm.mutate()}
            >
              Import {preview.summary.tasksToCreate} tasks
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Workbook (.xlsx)" htmlFor="import-file" className="min-w-64 flex-1">
            <Input
              id="import-file"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="pt-1.5"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                reset();
                setFile(chosen);
                if (chosen != null) check.mutate({ workbook: chosen, with: null });
              }}
            />
          </Field>
          {check.isPending && <span className="pb-2 text-[13px] text-ink-faint">Reading…</span>}
        </div>

        {preview != null && mapping != null && file != null && (
          <>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">1. Map the columns</h3>
              <div className="mb-3 flex flex-wrap gap-3">
                <Field label="Sheet" htmlFor="import-sheet">
                  <Select
                    id="import-sheet"
                    value={mapping.sheet}
                    onChange={(event) =>
                      // A different sheet has different headers; let the server guess again.
                      check.mutate({
                        workbook: file,
                        with: { ...mapping, sheet: event.target.value, columns: {} },
                      })
                    }
                  >
                    {preview.sheets.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Header row" htmlFor="import-header">
                  <Input
                    id="import-header"
                    type="number"
                    min={1}
                    max={100}
                    className="w-24"
                    value={mapping.headerRow}
                    onChange={(event) =>
                      setMapping({ ...mapping, headerRow: Number(event.target.value) || 1 })
                    }
                  />
                </Field>
                <div className="self-end pb-2">
                  <Checkbox
                    label="Create people the sheet names but Ekavist does not know"
                    checked={mapping.createMissingUsers}
                    onChange={(event) =>
                      setMapping({ ...mapping, createMissingUsers: event.target.checked })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {preview.detectedColumns.map((column) => (
                  <label key={column} className="flex items-center gap-2 text-[13px]">
                    <span className="w-36 shrink-0 truncate text-ink-soft" title={column}>
                      {column}
                    </span>
                    <Select
                      aria-label={`Map ${column}`}
                      value={mapping.columns[column] ?? 'IGNORE'}
                      onChange={(event) =>
                        setMapping({
                          ...mapping,
                          columns: { ...mapping.columns, [column]: event.target.value },
                        })
                      }
                    >
                      {IMPORT_TARGET_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {field === 'IGNORE' ? 'Ignore' : humanise(field)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              <Button
                size="sm"
                className="mt-3"
                loading={check.isPending}
                onClick={() => check.mutate({ workbook: file, with: mapping })}
              >
                Check again with this mapping
              </Button>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">2. Review</h3>
              <div className="mb-3 flex flex-wrap gap-2 text-[12px]">
                <Badge tone="neutral">{preview.summary.totalRows} rows</Badge>
                <Badge tone="ok">{preview.summary.tasksToCreate} tasks</Badge>
                <Badge tone="neutral">{preview.summary.wbsToCreate} WBS items</Badge>
                <Badge tone="neutral">{preview.summary.phasesToCreate.length} new phases</Badge>
                {errors.length > 0 && <Badge tone="danger">{errors.length} errors</Badge>}
                {warnings.length > 0 && <Badge tone="warn">{warnings.length} warnings</Badge>}
              </div>

              {preview.issues.length > 0 && (
                <ul className="scroll-thin mb-3 max-h-40 overflow-y-auto rounded-md border border-line text-[12px]">
                  {preview.issues.map((issue, index) => (
                    <li
                      key={`${issue.row}-${issue.code}-${index}`}
                      className="flex gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
                    >
                      <Badge tone={issue.severity === 'ERROR' ? 'danger' : 'warn'}>
                        {issue.row > 0 ? `Row ${issue.row}` : 'Sheet'}
                      </Badge>
                      <span className="text-ink-soft">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!preview.canConfirm && (
                <p className="mb-3 text-[13px] text-danger">
                  Fix the errors in the workbook, or change the mapping, before importing.
                </p>
              )}

              <Table>
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>WBS</Th>
                    <Th>Phase</Th>
                    <Th>Task</Th>
                    <Th>Owner</Th>
                    <Th>Start</Th>
                    <Th>Due</Th>
                    <Th>Status</Th>
                    <Th>Depends on</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row) => (
                    <tr key={row.row} className={row.valid ? undefined : 'bg-danger-soft'}>
                      <Td className="tabular text-ink-faint">{row.row}</Td>
                      <Td>{row.wbsCode ?? '—'}</Td>
                      <Td>{row.phaseName ?? '—'}</Td>
                      <Td>{row.taskName ?? '—'}</Td>
                      <Td>{row.ownerEmail ?? '—'}</Td>
                      <Td>{row.startDate ?? '—'}</Td>
                      <Td>{row.dueDate ?? '—'}</Td>
                      <Td>{row.status ?? '—'}</Td>
                      <Td>{row.predecessor ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {preview.rows.length > 50 && (
                <p className="mt-2 text-[12px] text-ink-faint">
                  Showing the first 50 of {preview.rows.length} rows.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
