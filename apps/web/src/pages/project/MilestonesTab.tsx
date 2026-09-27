/**
 * Milestones (spec section 21).
 *
 * A milestone is a date that matters, not a piece of work: it has no duration and no
 * progress of its own. Linking tasks to it is what makes it meaningful — the Gantt draws
 * it as a diamond and the dashboards list the ones coming up.
 */
import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneStatus,
  ProjectDetail,
} from '@ekavist/shared';
import { MILESTONE_STATUSES } from '@ekavist/shared';
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
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise } from '../../lib/format.js';
import { useMembers, useMilestones, usePhases, useTasks } from '../../lib/queries.js';

const STATUS_TONE: Record<MilestoneStatus, 'neutral' | 'info' | 'ok' | 'warn' | 'danger'> = {
  PLANNED: 'info',
  AT_RISK: 'warn',
  ACHIEVED: 'ok',
  MISSED: 'danger',
  CANCELLED: 'neutral',
};

export function MilestonesTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, error, refetch } = useMilestones(project.id);
  const canManage = project.capabilities.includes('milestone:manage');

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/projects/${project.id}/milestones/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', project.id] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the milestone.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${project.id}/milestones/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Milestone removed.');
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
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ink-faint">
          The dates that matter: approvals, deliveries, go-live. They appear as diamonds on the
          Gantt and in the upcoming list on the dashboards.
        </p>
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            Add milestone
          </Button>
        )}
      </div>

      <Card bodyClassName="p-0">
        {data == null || data.length === 0 ? (
          <EmptyState
            title="No milestones yet"
            description="Mark the points this project will be judged by."
            action={
              canManage ? (
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  Add the first one
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Milestone</Th>
                <Th>Date</Th>
                <Th>Phase</Th>
                <Th>Owner</Th>
                <Th>Linked tasks</Th>
                <Th>Status</Th>
                {canManage && <Th />}
              </tr>
            </thead>
            <tbody>
              {data.map((milestone: Milestone) => (
                <tr key={milestone.id} className="hover:bg-canvas">
                  <Td>
                    <span className="font-medium">{milestone.name}</span>
                    {milestone.description != null && (
                      <span className="block truncate text-[12px] text-ink-faint">
                        {milestone.description}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="tabular text-[13px]">{formatDate(milestone.date)}</span>
                  </Td>
                  <Td>
                    <span className="text-[13px] text-ink-soft">
                      {milestone.phase?.name ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[13px] text-ink-soft">
                      {milestone.owner?.fullName ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    {milestone.tasks.length === 0 ? (
                      <span className="text-[12px] text-ink-faint">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {milestone.tasks.map((task) => (
                          <Badge key={task.id} tone="neutral">
                            {task.reference}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {canManage ? (
                      <Select
                        value={milestone.status}
                        className="h-8 w-32"
                        aria-label={`Status for ${milestone.name}`}
                        onChange={(event) =>
                          update.mutate({
                            id: milestone.id,
                            body: { status: event.target.value },
                          })
                        }
                      >
                        {MILESTONE_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {humanise(value)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={STATUS_TONE[milestone.status]}>
                        {humanise(milestone.status)}
                      </Badge>
                    )}
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void confirm({
                            title: `Remove ${milestone.name}?`,
                            message:
                              'The milestone is deleted. The tasks linked to it are untouched.',
                            confirmLabel: 'Remove',
                          }).then((ok) => {
                            if (ok) remove.mutate(milestone.id);
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <MilestoneModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function MilestoneModal({
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
  const { data: members } = useMembers(project.id);
  const { data: tasks } = useTasks(project.id, { page: 1, pageSize: 100 });

  const [form, setForm] = useState<Partial<CreateMilestoneInput>>({
    status: 'PLANNED',
    taskIds: [],
  });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/milestones`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Milestone added.');
      setForm({ status: 'PLANNED', taskIds: [] });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the milestone.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a milestone"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="milestone-form" loading={create.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Milestone" htmlFor="milestone-name" required>
          <Input
            id="milestone-name"
            required
            autoFocus
            placeholder="Requirements approved"
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="milestone-description">
          <Textarea
            id="milestone-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="milestone-date" required>
            <Input
              id="milestone-date"
              type="date"
              required
              value={form.date ?? ''}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </Field>
          <Field label="Owner" htmlFor="milestone-owner">
            <Select
              id="milestone-owner"
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
        </div>

        <Field label="Phase" htmlFor="milestone-phase">
          <Select
            id="milestone-phase"
            value={form.phaseId ?? ''}
            onChange={(event) => setForm({ ...form, phaseId: event.target.value || undefined })}
          >
            <option value="">No phase</option>
            {(phases ?? []).map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.sequence}. {phase.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Tasks this depends on"
          htmlFor="milestone-tasks"
          hint="Linking tasks is what turns a date into something measurable."
        >
          <div className="scroll-thin flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {(tasks?.data ?? []).map((task) => {
              const selected = (form.taskIds ?? []).includes(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      taskIds: selected
                        ? (form.taskIds ?? []).filter((id) => id !== task.id)
                        : [...(form.taskIds ?? []), task.id],
                    })
                  }
                  className={
                    selected
                      ? 'rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium text-white'
                      : 'rounded-full border border-line-strong px-2.5 py-1 text-[12px] text-ink-soft hover:bg-canvas'
                  }
                >
                  {task.reference} {task.name.slice(0, 28)}
                </button>
              );
            })}
          </div>
        </Field>
      </form>
    </Modal>
  );
}
