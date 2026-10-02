/**
 * Project settings: the details set at creation, the completion criteria for tasks, and
 * the project's status — including archiving and restoring (spec sections 10, 11, 81).
 *
 * Completion is deliberately absent from the status buttons: a live project is completed
 * through the closure checklist, which the server enforces as well.
 */
import type { ProjectDetail, ProjectStatus, UpdateProjectInput } from '@ekavist/shared';
import { PRIORITIES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { humanise, PROJECT_STATUS_TONE } from '../../lib/format.js';
import { useUsers } from '../../lib/queries.js';

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export function SettingsTab({ project }: { project: ProjectDetail }) {
  const canEdit = project.capabilities.includes('project:update');
  const editable = canEdit && project.archivedAt == null && project.allowedStatuses.length > 0;
  const live = ['DRAFT', 'PLANNED', 'ACTIVE', 'ON_HOLD', 'AT_RISK'].includes(project.status);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-4">
        <DetailsForm key={project.updatedAt} project={project} disabled={!editable || !live} />
      </div>
      <div className="flex flex-col gap-4">
        <StatusCard project={project} />
        <CompletionRulesCard project={project} disabled={!editable || !live} />
      </div>
    </div>
  );
}

function useSaveProject(project: ProjectDetail, success: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => api.patch(`/projects/${project.id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(success);
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the project.'),
  });
}

function DetailsForm({ project, disabled }: { project: ProjectDetail; disabled: boolean }) {
  const { data: users } = useUsers({ page: 1, pageSize: 100, status: 'ACTIVE' });
  const save = useSaveProject(project, 'Project details saved.');
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
    leadId: project.lead?.id ?? '',
    startDate: project.startDate,
    plannedEndDate: project.plannedEndDate,
    priority: project.priority,
    category: project.category ?? '',
    client: project.client ?? '',
    budget: project.budget == null ? '' : String(project.budget),
    location: project.location ?? '',
    externalStakeholder: project.externalStakeholder ?? '',
    objectives: project.objectives.join('\n'),
    deliverables: project.deliverables.join('\n'),
  });
  const set = (patch: Partial<typeof form>): void => setForm({ ...form, ...patch });
  const fieldError = (path: string) =>
    save.error instanceof ApiError ? save.error.fieldError(path) : undefined;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim());
    save.mutate({
      name: form.name,
      description: form.description,
      ...(form.leadId !== '' ? { leadId: form.leadId } : {}),
      startDate: form.startDate,
      plannedEndDate: form.plannedEndDate,
      priority: form.priority,
      category: blankToNull(form.category),
      client: blankToNull(form.client),
      budget: form.budget.trim() === '' ? null : Number(form.budget),
      location: blankToNull(form.location),
      externalStakeholder: blankToNull(form.externalStakeholder),
      objectives: lines(form.objectives),
      deliverables: lines(form.deliverables),
    } as UpdateProjectInput);
  };

  return (
    <Card
      title="Project details"
      description={
        disabled
          ? 'This project no longer accepts changes, or you cannot edit it.'
          : 'Changing the lead makes them a member and tells them.'
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <fieldset disabled={disabled} className="contents">
          <Field label="Name" htmlFor="p-name" required error={fieldError('name')}>
            <Input
              id="p-name"
              required
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field label="Project lead" htmlFor="p-lead" required>
            <Select
              id="p-lead"
              value={form.leadId}
              onChange={(event) => set({ leadId: event.target.value })}
            >
              {project.lead != null &&
                !(users?.data ?? []).some((user) => user.id === project.lead?.id) && (
                  <option value={project.lead.id}>{project.lead.fullName}</option>
                )}
              {(users?.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="p-start" required error={fieldError('startDate')}>
            <Input
              id="p-start"
              type="date"
              required
              value={form.startDate}
              onChange={(event) => set({ startDate: event.target.value })}
            />
          </Field>
          <Field
            label="Planned completion"
            htmlFor="p-end"
            required
            error={fieldError('plannedEndDate')}
          >
            <Input
              id="p-end"
              type="date"
              required
              value={form.plannedEndDate}
              onChange={(event) => set({ plannedEndDate: event.target.value })}
            />
          </Field>
          <Field label="Priority" htmlFor="p-priority">
            <Select
              id="p-priority"
              value={form.priority}
              onChange={(event) =>
                set({ priority: event.target.value as ProjectDetail['priority'] })
              }
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="p-category">
            <Input
              id="p-category"
              value={form.category}
              onChange={(event) => set({ category: event.target.value })}
            />
          </Field>
          <Field label="Client or department" htmlFor="p-client">
            <Input
              id="p-client"
              value={form.client}
              onChange={(event) => set({ client: event.target.value })}
            />
          </Field>
          <Field label="Budget" htmlFor="p-budget" error={fieldError('budget')}>
            <Input
              id="p-budget"
              type="number"
              min={0}
              step="0.01"
              value={form.budget}
              onChange={(event) => set({ budget: event.target.value })}
            />
          </Field>
          <Field label="Location" htmlFor="p-location">
            <Input
              id="p-location"
              value={form.location}
              onChange={(event) => set({ location: event.target.value })}
            />
          </Field>
          <Field label="External stakeholder" htmlFor="p-stakeholder">
            <Input
              id="p-stakeholder"
              value={form.externalStakeholder}
              onChange={(event) => set({ externalStakeholder: event.target.value })}
            />
          </Field>
          <Field label="Description" htmlFor="p-description" className="sm:col-span-2">
            <Textarea
              id="p-description"
              rows={3}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>
          <Field label="Objectives" htmlFor="p-objectives" hint="One per line.">
            <Textarea
              id="p-objectives"
              rows={4}
              value={form.objectives}
              onChange={(event) => set({ objectives: event.target.value })}
            />
          </Field>
          <Field label="Expected deliverables" htmlFor="p-deliverables" hint="One per line.">
            <Textarea
              id="p-deliverables"
              rows={4}
              value={form.deliverables}
              onChange={(event) => set({ deliverables: event.target.value })}
            />
          </Field>
          {!disabled && (
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save details
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

function CompletionRulesCard({ project, disabled }: { project: ProjectDetail; disabled: boolean }) {
  const save = useSaveProject(project, 'Completion criteria saved.');
  const rules = project.completionRules;

  const toggle = (
    key:
      'completionRequiresNote' | 'completionRequiresActualHours' | 'completionRequiresAttachment',
    value: boolean,
  ): void => save.mutate({ [key]: value } as UpdateProjectInput);

  return (
    <Card
      title="Task completion criteria"
      description="What a task must carry before anyone can mark it complete."
    >
      <div className="flex flex-col gap-3">
        <Checkbox
          label="A completion note"
          description="What was delivered and where it is."
          checked={rules.requiresNote}
          disabled={disabled || save.isPending}
          onChange={(event) => toggle('completionRequiresNote', event.target.checked)}
        />
        <Checkbox
          label="Actual hours"
          description="So effort can be compared with the estimate."
          checked={rules.requiresActualHours}
          disabled={disabled || save.isPending}
          onChange={(event) => toggle('completionRequiresActualHours', event.target.checked)}
        />
        <Checkbox
          label="An attachment or linked document"
          description="Evidence such as a test report or a Drive link."
          checked={rules.requiresAttachment}
          disabled={disabled || save.isPending}
          onChange={(event) => toggle('completionRequiresAttachment', event.target.checked)}
        />
      </div>
    </Card>
  );
}

/** Where the project is in its life, and the moves available from here. */
function StatusCard({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [target, setTarget] = useState<ProjectStatus | null>(null);
  const [reason, setReason] = useState('');

  const canChange = project.capabilities.includes('project:update');
  const canArchive = project.capabilities.includes('project:archive');
  const canClose = project.capabilities.includes('project:close');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const change = useMutation({
    mutationFn: (input: { status: ProjectStatus; reason?: string }) =>
      api.patch(`/projects/${project.id}/status`, input),
    onSuccess: (_data, input) => {
      invalidate();
      setTarget(null);
      setReason('');
      toast.success(`Project is now ${humanise(input.status).toLowerCase()}.`);
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not change the status.'),
  });

  const archive = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/archive`),
    onSuccess: () => {
      invalidate();
      toast.success('Project archived. It is now read-only.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not archive the project.'),
  });

  const moves = project.allowedStatuses.filter((status) => status !== 'ARCHIVED');
  const isArchived = project.status === 'ARCHIVED';

  return (
    <Card title="Status">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={PROJECT_STATUS_TONE[project.status]}>{humanise(project.status)}</Badge>
        {project.closedAt != null && (
          <span className="text-[12px] text-ink-faint">Closed {project.closedAt.slice(0, 10)}</span>
        )}
      </div>

      {canChange && moves.length > 0 && (
        <>
          <p className="mb-2 text-[12px] text-ink-faint">
            {isArchived ? 'Restore this project to:' : 'Move this project to:'}
          </p>
          <div className="flex flex-wrap gap-2">
            {moves.map((status) => (
              <Button key={status} size="sm" onClick={() => setTarget(status)}>
                {humanise(status)}
              </Button>
            ))}
          </div>
        </>
      )}

      {(project.status === 'ACTIVE' || project.status === 'AT_RISK') && canClose && (
        <p className="mt-3 text-[12px] text-ink-faint">
          Finished? Complete the project through the{' '}
          <Link to={`/projects/${project.id}/closure`} className="text-accent hover:underline">
            closure checklist
          </Link>
          .
        </p>
      )}

      {canArchive && project.allowedStatuses.includes('ARCHIVED') && (
        <div className="mt-4 border-t border-line pt-3">
          <Button
            size="sm"
            variant="danger"
            loading={archive.isPending}
            onClick={() => {
              void confirm({
                title: 'Archive this project?',
                message:
                  'Archived projects are read-only for everyone. You can restore it later from here.',
                confirmLabel: 'Archive',
                tone: 'danger',
              }).then((ok) => {
                if (ok) archive.mutate();
              });
            }}
          >
            Archive project
          </Button>
        </div>
      )}

      <Modal
        open={target != null}
        onClose={() => setTarget(null)}
        title={target == null ? '' : `Move to ${humanise(target).toLowerCase()}`}
        description="The reason is recorded in the activity feed."
        size="sm"
        footer={
          <>
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={change.isPending}
              onClick={() =>
                target != null &&
                change.mutate({
                  status: target,
                  ...(reason.trim() !== '' ? { reason: reason.trim() } : {}),
                })
              }
            >
              Change status
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="status-reason">
          <Textarea
            id="status-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </Modal>
    </Card>
  );
}
