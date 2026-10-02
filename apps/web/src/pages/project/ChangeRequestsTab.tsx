/**
 * Change requests (spec section 46).
 *
 * The workflow is deliberately visible on screen: requested, analysed, decided. A change
 * cannot be approved before its impact has been recorded, and approving it does not touch
 * the plan unless the approver explicitly asks for the schedule shift to be applied.
 */
import { ExportButton } from '../../components/ExportButton.js';
import type {
  AnalyseChangeRequestInput,
  ChangeRequest,
  CreateChangeRequestInput,
  ProjectDetail,
} from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useToast } from '../../components/ui/overlays.js';
import { Pagination } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise } from '../../lib/format.js';
import { useChangeRequests, usePhases } from '../../lib/queries.js';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'ok' | 'danger'> = {
  REQUESTED: 'info',
  IMPACT_ANALYSIS: 'warn',
  UNDER_REVIEW: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  IMPLEMENTED: 'ok',
  WITHDRAWN: 'neutral',
};

export function ChangeRequestsTab({ project }: { project: ProjectDetail }) {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [analysing, setAnalysing] = useState<ChangeRequest | null>(null);

  const { data, isLoading, isError, error, refetch } = useChangeRequests(project.id, {
    page,
    pageSize: 20,
  });

  const canRaise = project.capabilities.includes('change-request:create');
  const canDecide = project.capabilities.includes('change-request:decide');

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ink-faint">
          Scope changes go through this register so the plan never moves without a decision behind
          it. Record the impact first, then approve or reject.
        </p>
        <div className="flex shrink-0 gap-2">
          {project.capabilities.includes('report:export') && (
            <ExportButton path={`/projects/${project.id}/export/change-requests`} />
          )}
          {canRaise && (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              Raise a change
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="card">
          <LoadingState />
        </div>
      ) : isError ? (
        <div className="card">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : data == null || data.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No change requests"
            description="When someone asks for something outside the agreed scope, record it here."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.data.map((request) => (
            <ChangeRequestCard
              key={request.id}
              project={project}
              request={request}
              canDecide={canDecide}
              onAnalyse={() => setAnalysing(request)}
            />
          ))}
          <div className="card">
            <Pagination meta={data.meta} onPageChange={setPage} />
          </div>
        </div>
      )}

      <CreateModal project={project} open={creating} onClose={() => setCreating(false)} />
      <AnalyseModal project={project} request={analysing} onClose={() => setAnalysing(null)} />
    </>
  );
}

function ChangeRequestCard({
  project,
  request,
  canDecide,
  onAnalyse,
}: {
  project: ProjectDetail;
  request: ChangeRequest;
  canDecide: boolean;
  onAnalyse: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [applySchedule, setApplySchedule] = useState(false);
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      api.post(`/projects/${project.id}/change-requests/${request.id}/decide`, {
        approved,
        note,
        applyScheduleImpact: approved && applySchedule,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Decision recorded.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not record the decision.'),
  });

  const decided = request.status === 'APPROVED' || request.status === 'REJECTED';

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Badge tone="neutral">{request.reference}</Badge>
          <span className="text-sm font-semibold">{request.title}</span>
          <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>{humanise(request.status)}</Badge>
        </span>
      }
      description={`Raised by ${request.requester.fullName} on ${formatDate(request.requestedOn)}`}
    >
      {request.description != null && (
        <p className="text-[13px] text-ink-soft">{request.description}</p>
      )}
      {request.reason != null && (
        <p className="mt-1.5 text-[13px] text-ink-soft">
          <span className="font-medium">Reason: </span>
          {request.reason}
        </p>
      )}

      {request.impact == null ? (
        <div className="mt-3 rounded-md border border-warn bg-warn-soft px-3 py-2.5">
          <p className="text-[13px] text-[oklch(42%_0.11_70)]">
            The impact has not been analysed yet. A change cannot be decided until it has.
          </p>
          {canDecide && (
            <Button size="sm" className="mt-2" onClick={onAnalyse}>
              Record the impact
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-canvas px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            Impact analysis
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
            <div>
              <dt className="text-ink-faint">Schedule</dt>
              <dd className="tabular text-ink">
                {request.impact.scheduleImpactDays > 0 ? '+' : ''}
                {request.impact.scheduleImpactDays} day(s)
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Effort</dt>
              <dd className="tabular text-ink">{request.impact.effortImpactHours} hours</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Cost</dt>
              <dd className="tabular text-ink">
                {request.impact.costImpact == null ? '—' : request.impact.costImpact}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Tasks affected</dt>
              <dd className="tabular text-ink">{request.impact.affectedTasks.length}</dd>
            </div>
          </dl>
          {request.impact.scopeImpact != null && (
            <p className="mt-2 text-[12px] text-ink-soft">
              <span className="font-medium">Scope: </span>
              {request.impact.scopeImpact}
            </p>
          )}
        </div>
      )}

      {decided ? (
        <p className="mt-3 text-[12px] text-ink-faint">
          {humanise(request.status)} by {request.approver?.fullName ?? 'someone'} on{' '}
          {request.decidedAt == null ? '—' : formatDate(request.decidedAt.slice(0, 10))}.
          {request.decisionNote != null && ` ${request.decisionNote}`}
          {request.scheduleImpactApplied && ' The plan was shifted accordingly.'}
        </p>
      ) : (
        canDecide &&
        request.impact != null && (
          <div className="mt-3 border-t border-line pt-3">
            <Textarea
              rows={2}
              placeholder="Add a note explaining the decision…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            {request.impact.scheduleImpactDays !== 0 && (
              <div className="mt-2">
                <Checkbox
                  label={`Shift the plan by ${request.impact.scheduleImpactDays} day(s)`}
                  description="Moves the affected tasks and the project's target date. Every change is recorded in the audit log."
                  checked={applySchedule}
                  onChange={(event) => setApplySchedule(event.target.checked)}
                />
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={decide.isPending}
                onClick={() => decide.mutate(true)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={decide.isPending}
                onClick={() => decide.mutate(false)}
              >
                Reject
              </Button>
            </div>
          </div>
        )
      )}
    </Card>
  );
}

function CreateModal({
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
  const { data: phases } = usePhases(project.id);
  const [form, setForm] = useState<Partial<CreateChangeRequestInput>>({});

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/change-requests`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Change request raised.');
      setForm({});
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not raise the change.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a change request"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="cr-form" loading={create.isPending}>
            Raise
          </Button>
        </>
      }
    >
      <form id="cr-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="What is being asked for" htmlFor="cr-title" required>
          <Input
            id="cr-title"
            required
            autoFocus
            value={form.title ?? ''}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Description" htmlFor="cr-description">
          <Textarea
            id="cr-description"
            rows={3}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field label="Why it is needed" htmlFor="cr-reason">
          <Textarea
            id="cr-reason"
            rows={3}
            value={form.reason ?? ''}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <Field label="Phase" htmlFor="cr-phase">
          <Select
            id="cr-phase"
            value={form.phaseId ?? ''}
            onChange={(event) => setForm({ ...form, phaseId: event.target.value || undefined })}
          >
            <option value="">No phase</option>
            {(phases ?? []).map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function AnalyseModal({
  project,
  request,
  onClose,
}: {
  project: ProjectDetail;
  request: ChangeRequest | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Partial<AnalyseChangeRequestInput>>({
    scheduleImpactDays: 0,
    effortImpactHours: 0,
    affectedTaskIds: [],
  });

  const analyse = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/change-requests/${request?.id}/analyse`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Impact recorded.');
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not record the impact.'),
  });

  return (
    <Modal
      open={request != null}
      onClose={onClose}
      title={`Impact of ${request?.reference ?? ''}`}
      description="Record every impact explicitly. Approving a change never moves the plan on its own."
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={analyse.isPending} onClick={() => analyse.mutate()}>
            Save the analysis
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Scope impact" htmlFor="impact-scope">
          <Textarea
            id="impact-scope"
            rows={2}
            value={form.scopeImpact ?? ''}
            onChange={(event) => setForm({ ...form, scopeImpact: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Schedule impact (days)"
            htmlFor="impact-days"
            hint="Positive delays the project."
          >
            <Input
              id="impact-days"
              type="number"
              value={form.scheduleImpactDays ?? 0}
              onChange={(event) =>
                setForm({ ...form, scheduleImpactDays: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Extra effort (hours)" htmlFor="impact-hours">
            <Input
              id="impact-hours"
              type="number"
              step={0.5}
              value={form.effortImpactHours ?? 0}
              onChange={(event) =>
                setForm({ ...form, effortImpactHours: Number(event.target.value) })
              }
            />
          </Field>
        </div>

        <Field label="Resource impact" htmlFor="impact-resource">
          <Textarea
            id="impact-resource"
            rows={2}
            value={form.resourceImpact ?? ''}
            onChange={(event) => setForm({ ...form, resourceImpact: event.target.value })}
          />
        </Field>

        <Field label="Risk impact" htmlFor="impact-risk">
          <Textarea
            id="impact-risk"
            rows={2}
            value={form.riskImpact ?? ''}
            onChange={(event) => setForm({ ...form, riskImpact: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}
