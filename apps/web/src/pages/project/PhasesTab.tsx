/**
 * Phases and their gates (spec sections 5 and 13).
 *
 * The gate is the point of this screen: a phase that cannot start says why, and a phase
 * waiting on a decision offers approve and reject to the person entitled to make it.
 */
import type { CreatePhaseInput, Phase, ProjectDetail } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  ProgressBar,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise, PHASE_STATUS_TONE } from '../../lib/format.js';
import { keys, useMembers, usePhases } from '../../lib/queries.js';

export function PhasesTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Phase | null>(null);

  const { data: phases, isLoading, isError, error, refetch } = usePhases(project.id);
  const canManage = project.capabilities.includes('phase:create');
  const canApprove = project.capabilities.includes('phase:approve');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.phases(project.id) });
    void queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
    void queryClient.invalidateQueries({ queryKey: keys.projectDashboard(project.id) });
  };

  const act = useMutation({
    mutationFn: ({ phaseId, action, body }: { phaseId: string; action: string; body?: unknown }) =>
      api.post(`/projects/${project.id}/phases/${phaseId}/${action}`, body ?? {}),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'That did not work.'),
  });

  const remove = useMutation({
    mutationFn: (phaseId: string) => api.delete(`/projects/${project.id}/phases/${phaseId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Phase removed. Its tasks are still in the project, without a phase.');
    },
  });

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-faint">
          Waterfall phases run in order. A phase with an approval gate blocks the ones after it
          until the gate is approved.
        </p>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            Add phase
          </Button>
        )}
      </div>

      {phases == null || phases.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No phases yet"
            description="Add the phases this project will move through."
            action={
              canManage ? (
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  Add the first phase
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {phases.map((phase) => (
            <li key={phase.id}>
              <Card
                title={
                  <span className="flex items-center gap-2">
                    <span className="tabular grid size-6 place-items-center rounded-full bg-canvas text-[11px] font-semibold text-ink-soft">
                      {phase.sequence}
                    </span>
                    <span className="text-sm font-semibold">{phase.name}</span>
                    <Badge tone={PHASE_STATUS_TONE[phase.status]}>{humanise(phase.status)}</Badge>
                    {phase.gate.approvalRequired && (
                      <Badge tone={phase.gate.status === 'APPROVED' ? 'ok' : 'info'}>
                        Gate: {humanise(phase.gate.status)}
                      </Badge>
                    )}
                  </span>
                }
                action={
                  <div className="flex flex-wrap gap-1.5">
                    {canManage && phase.status === 'NOT_STARTED' && (
                      <Button
                        size="sm"
                        disabled={!phase.canStart}
                        loading={act.isPending}
                        onClick={() => act.mutate({ phaseId: phase.id, action: 'start' })}
                      >
                        Start
                      </Button>
                    )}
                    {canManage &&
                      phase.gate.approvalRequired &&
                      (phase.gate.status === 'PENDING' || phase.gate.status === 'REJECTED') && (
                        <Button
                          size="sm"
                          loading={act.isPending}
                          onClick={() => act.mutate({ phaseId: phase.id, action: 'submit' })}
                        >
                          Submit for approval
                        </Button>
                      )}
                    {canApprove && phase.gate.status === 'SUBMITTED' && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={act.isPending}
                          onClick={() => act.mutate({ phaseId: phase.id, action: 'approve' })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={act.isPending}
                          onClick={() => {
                            const reason = window.prompt('Why is this phase being rejected?');
                            if (reason == null) return;
                            act.mutate({
                              phaseId: phase.id,
                              action: 'reject',
                              body: { note: reason, requiresRework: true },
                            });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(phase)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void confirm({
                              title: `Remove ${phase.name}?`,
                              message:
                                'Tasks in this phase stay in the project but lose their phase. This cannot be undone.',
                              confirmLabel: 'Remove phase',
                            }).then((ok) => {
                              if (ok) remove.mutate(phase.id);
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                }
              >
                <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div>
                    {phase.description != null && (
                      <p className="mb-3 text-[13px] text-ink-soft">{phase.description}</p>
                    )}

                    {!phase.canStart && phase.blockedReason != null && (
                      <p className="mb-3 rounded-md border border-warn bg-warn-soft px-2.5 py-2 text-[12px] text-[oklch(42%_0.11_70)]">
                        {phase.blockedReason}
                      </p>
                    )}

                    {phase.gate.status === 'REJECTED' && phase.gate.decisionNote != null && (
                      <p className="mb-3 rounded-md border border-danger bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
                        Rejected: {phase.gate.decisionNote}
                      </p>
                    )}

                    <ProgressBar value={phase.progress} showLabel />

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-4">
                      <Fact label="Owner" value={phase.owner?.fullName ?? '—'} />
                      <Fact label="Planned start" value={formatDate(phase.plannedStart)} />
                      <Fact label="Planned end" value={formatDate(phase.plannedEnd)} />
                      <Fact label="Actual start" value={formatDate(phase.actualStart)} />
                    </dl>
                  </div>

                  <div className="rounded-md bg-canvas px-3 py-2.5">
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                      Tasks
                    </p>
                    <p className="tabular text-sm text-ink">
                      {phase.taskCounts.completed} of {phase.taskCounts.total} complete
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      {phase.taskCounts.inProgress} in progress
                      {phase.taskCounts.overdue > 0 && (
                        <span className="font-medium text-danger">
                          {' '}
                          · {phase.taskCounts.overdue} overdue
                        </span>
                      )}
                    </p>

                    {phase.deliverables.length > 0 && (
                      <>
                        <p className="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                          Deliverables
                        </p>
                        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-soft">
                          {phase.deliverables.map((deliverable) => (
                            <li key={deliverable}>{deliverable}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <PhaseModal
        project={project}
        phase={editing}
        open={creating || editing != null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="text-[12px] text-ink">{value}</dd>
    </div>
  );
}

function PhaseModal({
  project,
  phase,
  open,
  onClose,
}: {
  project: ProjectDetail;
  phase: Phase | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: members } = useMembers(project.id);

  const [form, setForm] = useState<Partial<CreatePhaseInput>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = phase?.id ?? (open ? 'new' : null);
  if (key != null && key !== loadedFor) {
    setLoadedFor(key);
    setForm(
      phase == null
        ? { approvalRequired: false, deliverables: [] }
        : {
            name: phase.name,
            description: phase.description ?? undefined,
            ownerId: phase.owner?.id,
            plannedStart: phase.plannedStart ?? undefined,
            plannedEnd: phase.plannedEnd ?? undefined,
            approvalRequired: phase.gate.approvalRequired,
            approverId: phase.gate.approver?.id,
            deliverables: phase.deliverables,
          },
    );
  }

  const save = useMutation({
    mutationFn: (input: Partial<CreatePhaseInput>) =>
      phase == null
        ? api.post(`/projects/${project.id}/phases`, input)
        : api.patch(`/projects/${project.id}/phases/${phase.id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.phases(project.id) });
      toast.success(phase == null ? 'Phase added.' : 'Phase saved.');
      setLoadedFor(null);
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the phase.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate(form);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setLoadedFor(null);
        onClose();
      }}
      title={phase == null ? 'Add a phase' : `Edit ${phase.name}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="phase-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="phase-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="phase-name" required className="sm:col-span-2">
          <Input
            id="phase-name"
            required
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="phase-description" className="sm:col-span-2">
          <Textarea
            id="phase-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <Field label="Owner" htmlFor="phase-owner">
          <Select
            id="phase-owner"
            value={form.ownerId ?? ''}
            onChange={(event) => setForm({ ...form, ownerId: event.target.value || undefined })}
          >
            <option value="">No owner</option>
            {(members ?? []).map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <div />

        <Field label="Planned start" htmlFor="phase-start">
          <Input
            id="phase-start"
            type="date"
            value={form.plannedStart ?? ''}
            onChange={(event) => setForm({ ...form, plannedStart: event.target.value })}
          />
        </Field>

        <Field label="Planned end" htmlFor="phase-end">
          <Input
            id="phase-end"
            type="date"
            value={form.plannedEnd ?? ''}
            onChange={(event) => setForm({ ...form, plannedEnd: event.target.value })}
          />
        </Field>

        <Field
          label="Deliverables"
          htmlFor="phase-deliverables"
          hint="One per line."
          className="sm:col-span-2"
        >
          <Textarea
            id="phase-deliverables"
            rows={3}
            value={(form.deliverables ?? []).join('\n')}
            onChange={(event) =>
              setForm({
                ...form,
                deliverables: event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line !== ''),
              })
            }
          />
        </Field>

        <label className="flex items-start gap-2.5 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.approvalRequired === true}
            onChange={(event) => setForm({ ...form, approvalRequired: event.target.checked })}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm text-ink">This phase needs approval to close</span>
            <span className="block text-[12px] text-ink-faint">
              Later phases cannot start until the gate is approved. If the approver is the person
              who submits it, an administrator has to decide instead.
            </span>
          </span>
        </label>

        {form.approvalRequired === true && (
          <Field label="Approver" htmlFor="phase-approver" className="sm:col-span-2">
            <Select
              id="phase-approver"
              value={form.approverId ?? ''}
              onChange={(event) =>
                setForm({ ...form, approverId: event.target.value || undefined })
              }
            >
              <option value="">The project lead</option>
              {(members ?? []).map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.fullName}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
