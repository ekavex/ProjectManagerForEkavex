/**
 * A single task.
 *
 * Three things here are worth noticing. Progress and status are one control, because they
 * are one idea: dragging to 100% completes the task and completing it sets 100%. When a
 * dependency is unmet the server refuses the change once, explains which task is in the
 * way, and offers to proceed anyway — the override is recorded (spec section 20). And when
 * the project defines completion criteria, completing asks for them first (rule 7).
 */
import type { DependencyType, ProjectDetail, TaskStatus } from '@ekavist/shared';
import { DEPENDENCY_TYPES, MEMBER_SETTABLE_TASK_STATUSES, TASK_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import { Avatar, FactList } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  ProgressBar,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import {
  dueLabel,
  formatDate,
  formatHours,
  formatRelative,
  humanise,
  PRIORITY_TONE,
  TASK_STATUS_TONE,
} from '../../lib/format.js';
import { keys, useAttendanceToday, useTask, useTasks } from '../../lib/queries.js';
import { useQuery } from '@tanstack/react-query';

export function TaskDetailPanel({ project }: { project: ProjectDetail }) {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: task, isLoading, isError, error, refetch } = useTask(project.id, taskId);
  const [comment, setComment] = useState('');
  // The change the server warned about, kept so "proceed anyway" can resend it.
  const [predecessorWarning, setPredecessorWarning] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);
  const [completing, setCompleting] = useState(false);
  const rules = project.completionRules;
  const needsEvidence = rules.requiresNote || rules.requiresActualHours || rules.requiresAttachment;

  const canEdit = project.capabilities.includes('task:update');
  const canUpdateOwn = project.capabilities.includes('task:update-own-progress');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
  };

  const setStatus = useMutation({
    mutationFn: (input: {
      status: TaskStatus;
      override?: boolean;
      note?: string;
      actualHours?: number;
    }) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}/status`, {
        status: input.status,
        overridePredecessorWarning: input.override ?? false,
        ...(input.note != null && input.note !== '' ? { note: input.note } : {}),
        ...(input.actualHours != null ? { actualHours: input.actualHours } : {}),
      }),
    onSuccess: () => {
      setPredecessorWarning(null);
      setCompleting(false);
      invalidate();
    },
    onError: (cause: unknown, variables) => {
      if (cause instanceof ApiError && cause.code === 'TASK_PREDECESSOR_INCOMPLETE') {
        setPredecessorWarning({
          message: cause.message,
          retry: () => setStatus.mutate({ ...variables, override: true }),
        });
        return;
      }
      if (cause instanceof ApiError && cause.code === 'TASK_COMPLETION_CRITERIA_UNMET') {
        setCompleting(true);
      }
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the task.');
    },
  });

  const setProgress = useMutation({
    mutationFn: ({ progress, override }: { progress: number; override?: boolean }) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}/progress`, {
        progress,
        overridePredecessorWarning: override ?? false,
      }),
    onSuccess: () => {
      setPredecessorWarning(null);
      invalidate();
    },
    onError: (cause: unknown, variables) => {
      if (cause instanceof ApiError && cause.code === 'TASK_PREDECESSOR_INCOMPLETE') {
        setPredecessorWarning({
          message: cause.message,
          retry: () => setProgress.mutate({ ...variables, override: true }),
        });
        return;
      }
      if (cause instanceof ApiError && cause.code === 'TASK_COMPLETION_CRITERIA_UNMET') {
        setCompleting(true);
        return;
      }
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update progress.');
    },
  });

  // Completing asks for the evidence the project requires before sending anything.
  const changeStatus = (status: TaskStatus): void => {
    if (status === 'COMPLETED' && needsEvidence) {
      setCompleting(true);
      return;
    }
    setStatus.mutate({ status });
  };
  const changeProgress = (progress: number): void => {
    if (progress >= 100 && needsEvidence) {
      setCompleting(true);
      return;
    }
    setProgress.mutate({ progress });
  };

  const addComment = useMutation({
    mutationFn: (body: string) =>
      api.post(`/projects/${project.id}/tasks/${taskId}/comments`, { body }),
    onSuccess: () => {
      setComment('');
      void queryClient.invalidateQueries({
        queryKey: keys.taskComments(project.id, taskId),
      });
      invalidate();
    },
    onError: () => toast.error('Could not add the comment.'),
  });

  const comments = useQuery({
    queryKey: keys.taskComments(project.id, taskId),
    queryFn: async () =>
      (
        await api.get<{
          data: { id: string; author: { fullName: string }; body: string; createdAt: string }[];
        }>(`/projects/${project.id}/tasks/${taskId}/comments`)
      ).data,
    enabled: taskId !== '',
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
  if (task == null) return null;

  const statusOptions = canEdit ? TASK_STATUSES : MEMBER_SETTABLE_TASK_STATUSES;
  const mayChange = canEdit || canUpdateOwn;
  const canLink = project.capabilities.includes('dependency:manage') && project.archivedAt == null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Link
              to={`/projects/${project.id}/tasks`}
              className="text-[12px] text-ink-faint hover:text-accent"
            >
              ← All tasks
            </Link>
            <Badge tone="neutral">{task.reference}</Badge>
            <Badge tone={TASK_STATUS_TONE[task.status]}>{humanise(task.status)}</Badge>
            <Badge tone={PRIORITY_TONE[task.priority]}>{humanise(task.priority)}</Badge>
            {task.isOverdue && <Badge tone="danger">{dueLabel(task.daysUntilDue, true)}</Badge>}
            <span className="flex-1" />
            <WorkOnThisButton projectId={project.id} taskId={task.id} reference={task.reference} />
          </div>

          <h2 className="text-lg font-semibold text-ink">{task.name}</h2>
          {task.description != null && (
            <p className="mt-2 text-[13px] whitespace-pre-wrap text-ink-soft">{task.description}</p>
          )}

          {predecessorWarning != null && (
            <div className="mt-4 rounded-md border border-warn bg-warn-soft px-3 py-2.5">
              <p className="text-[13px] text-[oklch(42%_0.11_70)]">{predecessorWarning.message}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={setStatus.isPending || setProgress.isPending}
                  onClick={predecessorWarning.retry}
                >
                  Proceed anyway
                </Button>
                <Button size="sm" onClick={() => setPredecessorWarning(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {mayChange && (
            <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="task-status">
                <Select
                  id="task-status"
                  value={task.status}
                  disabled={setStatus.isPending}
                  onChange={(event) => changeStatus(event.target.value as TaskStatus)}
                >
                  {statusOptions.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={`Progress — ${task.progress}%`} htmlFor="task-progress">
                <input
                  id="task-progress"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  defaultValue={task.progress}
                  disabled={setProgress.isPending}
                  onMouseUp={(event) =>
                    changeProgress(Number((event.target as HTMLInputElement).value))
                  }
                  onTouchEnd={(event) =>
                    changeProgress(Number((event.target as HTMLInputElement).value))
                  }
                  onKeyUp={(event) =>
                    changeProgress(Number((event.target as HTMLInputElement).value))
                  }
                  className="h-9 w-full accent-[var(--color-accent)]"
                />
              </Field>
            </div>
          )}
        </Card>

        {(task.predecessors.length > 0 || task.successors.length > 0 || canLink) && (
          <Card title="Dependencies">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                  Waits for
                </p>
                {task.predecessors.length === 0 ? (
                  <p className="text-[13px] text-ink-faint">Nothing.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {task.predecessors.map((link) => (
                      <DependencyItem
                        key={link.dependencyId}
                        projectId={project.id}
                        link={link}
                        canRemove={canLink}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                  Blocks
                </p>
                {task.successors.length === 0 ? (
                  <p className="text-[13px] text-ink-faint">Nothing.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {task.successors.map((link) => (
                      <DependencyItem
                        key={link.dependencyId}
                        projectId={project.id}
                        link={link}
                        canRemove={canLink}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {canLink && <AddDependencyForm projectId={project.id} taskId={task.id} />}
          </Card>
        )}

        <Card title="Comments">
          {comments.data == null ? (
            <LoadingState />
          ) : comments.data.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-faint">
              No comments yet. Record decisions and blockers here so they stay with the task.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.data.map((entry) => (
                <li key={entry.id} className="flex gap-2.5">
                  <Avatar name={entry.author.fullName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px]">
                      <span className="font-medium text-ink">{entry.author.fullName}</span>
                      <span className="ml-1.5 text-ink-faint">
                        {formatRelative(entry.createdAt)}
                      </span>
                    </p>
                    <p className="text-[13px] whitespace-pre-wrap text-ink-soft">{entry.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {project.capabilities.includes('task:comment') && (
            <form
              className="mt-3 flex gap-2 border-t border-line pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (comment.trim() !== '') addComment.mutate(comment.trim());
              }}
            >
              <Textarea
                rows={2}
                value={comment}
                placeholder="Add a comment…"
                onChange={(event) => setComment(event.target.value)}
              />
              <Button
                variant="primary"
                type="submit"
                loading={addComment.isPending}
                disabled={comment.trim() === ''}
              >
                Post
              </Button>
            </form>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Details">
          <ProgressBar
            value={task.progress}
            showLabel
            tone={task.status === 'COMPLETED' ? 'ok' : task.isOverdue ? 'danger' : 'accent'}
            className="mb-4"
          />
          <FactList
            columns={1}
            items={[
              {
                label: 'Assignees',
                value:
                  task.assignees.length === 0
                    ? 'Unassigned'
                    : task.assignees.map((assignee) => assignee.fullName).join(', '),
              },
              { label: 'Accountable', value: task.accountable?.fullName ?? '—' },
              { label: 'Phase', value: task.phase?.name ?? '—' },
              { label: 'WBS', value: task.wbs?.code ?? '—' },
              { label: 'Start', value: formatDate(task.startDate) },
              { label: 'Due', value: formatDate(task.dueDate) },
              { label: 'Estimated', value: formatHours(task.estimatedHours) },
              { label: 'Actual', value: formatHours(task.actualHours) },
              { label: 'Created by', value: task.createdBy?.fullName ?? '—' },
              {
                label: 'Completed',
                value: task.completedAt == null ? '—' : formatRelative(task.completedAt),
              },
            ]}
          />
        </Card>

        {task.attachments.length > 0 && (
          <Card title="Attachments">
            <ul className="flex flex-col gap-2">
              {task.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-2 text-[13px] text-accent hover:underline"
                  >
                    <Badge tone="neutral">{humanise(attachment.kind)}</Badge>
                    <span className="truncate">{attachment.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {project.capabilities.includes('task:attach') && (
          <AddLinkCard projectId={project.id} taskId={task.id} />
        )}
      </div>

      <CompleteTaskModal
        open={completing}
        rules={rules}
        attachments={task.attachments.length}
        defaultHours={task.actualHours}
        loading={setStatus.isPending}
        onClose={() => setCompleting(false)}
        onSubmit={(evidence) => setStatus.mutate({ status: 'COMPLETED', ...evidence })}
      />
    </div>
  );
}

const DEPENDENCY_LABEL: Record<DependencyType, string> = {
  FINISH_TO_START: 'Finish → start',
  START_TO_START: 'Start → start',
  FINISH_TO_FINISH: 'Finish → finish',
  START_TO_FINISH: 'Start → finish',
};

function DependencyItem({
  projectId,
  link,
  canRemove,
}: {
  projectId: string;
  link: {
    dependencyId: string;
    type: DependencyType;
    lagDays: number;
    task: { id: string; reference: string; name: string; status: TaskStatus };
  };
  canRemove: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/dependencies/${link.dependencyId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove the link.'),
  });

  return (
    <li className="flex items-center gap-2">
      <Link
        to={`/projects/${projectId}/tasks/${link.task.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-[13px] hover:text-accent"
      >
        <Badge tone={TASK_STATUS_TONE[link.task.status]}>{link.task.reference}</Badge>
        <span className="truncate">{link.task.name}</span>
      </Link>
      <span className="shrink-0 text-[11px] text-ink-faint">
        {DEPENDENCY_LABEL[link.type]}
        {link.lagDays !== 0 && ` ${link.lagDays > 0 ? '+' : ''}${link.lagDays}d`}
      </span>
      {canRemove && (
        <button
          type="button"
          className="shrink-0 rounded px-1 text-[12px] text-ink-faint hover:text-danger"
          aria-label={`Remove the link to ${link.task.reference}`}
          disabled={remove.isPending}
          onClick={() => {
            void confirm({
              title: 'Remove this dependency?',
              message: `${link.task.reference} will no longer be linked to this task.`,
              confirmLabel: 'Remove',
              tone: 'danger',
            }).then((ok) => {
              if (ok) remove.mutate();
            });
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * Links another task as a predecessor. The server rejects a link that would close a loop
 * and names the tasks involved, so the message is shown as it comes back.
 */
function AddDependencyForm({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [predecessorId, setPredecessorId] = useState('');
  const [type, setType] = useState<DependencyType>('FINISH_TO_START');
  const [lagDays, setLagDays] = useState(0);
  const { data } = useTasks(projectId, {
    page: 1,
    pageSize: 50,
    sort: 'reference',
    search: search.trim() === '' ? undefined : search.trim(),
  });
  const candidates = (data?.data ?? []).filter((candidate) => candidate.id !== taskId);

  const add = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/dependencies`, {
        predecessorId,
        successorId: taskId,
        type,
        lagDays,
      }),
    onSuccess: () => {
      setPredecessorId('');
      setSearch('');
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      toast.success('Dependency added.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the dependency.'),
  });

  return (
    <form
      className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_10rem_6rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (predecessorId !== '') add.mutate();
      }}
    >
      <Field label="Waits for" htmlFor="dependency-task">
        <div className="flex flex-col gap-1.5">
          <Input
            type="search"
            placeholder="Find a task…"
            aria-label="Find a task to depend on"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            id="dependency-task"
            required
            value={predecessorId}
            onChange={(event) => setPredecessorId(event.target.value)}
          >
            <option value="">Choose a task…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.reference} — {candidate.name}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <Field label="Type" htmlFor="dependency-type">
        <Select
          id="dependency-type"
          value={type}
          onChange={(event) => setType(event.target.value as DependencyType)}
        >
          {DEPENDENCY_TYPES.map((value) => (
            <option key={value} value={value}>
              {DEPENDENCY_LABEL[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Lag (days)" htmlFor="dependency-lag">
        <Input
          id="dependency-lag"
          type="number"
          min={-365}
          max={365}
          value={lagDays}
          onChange={(event) => setLagDays(Number(event.target.value) || 0)}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        loading={add.isPending}
        disabled={predecessorId === ''}
      >
        Link
      </Button>
    </form>
  );
}

/** Collects the evidence the project's completion criteria ask for (business rule 7). */
function CompleteTaskModal({
  open,
  rules,
  attachments,
  defaultHours,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  rules: ProjectDetail['completionRules'];
  attachments: number;
  defaultHours: number | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (evidence: { note?: string; actualHours?: number }) => void;
}) {
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(defaultHours == null ? '' : String(defaultHours));
  const missingAttachment = rules.requiresAttachment && attachments === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Complete this task"
      description="This project asks for a little evidence before a task is marked complete."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="complete-task"
            loading={loading}
            disabled={missingAttachment}
          >
            Mark complete
          </Button>
        </>
      }
    >
      <form
        id="complete-task"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
            ...(hours !== '' ? { actualHours: Number(hours) } : {}),
          });
        }}
      >
        <Field
          label="Completion note"
          htmlFor="complete-note"
          required={rules.requiresNote}
          hint="What was delivered, and where to find it."
        >
          <Textarea
            id="complete-note"
            rows={3}
            required={rules.requiresNote}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field label="Actual hours" htmlFor="complete-hours" required={rules.requiresActualHours}>
          <Input
            id="complete-hours"
            type="number"
            min={0}
            step={0.25}
            required={rules.requiresActualHours}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </Field>
        {missingAttachment && (
          <p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-[13px] text-[oklch(42%_0.11_70)]">
            Attach a link or file reference to this task first; this project requires one.
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * Points the running work session at this task, or starts the day on it (spec section
 * 29). Time is then attributed to the task without ending attendance.
 */
function WorkOnThisButton({
  projectId,
  taskId,
  reference,
}: {
  projectId: string;
  taskId: string;
  reference: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: today } = useAttendanceToday();
  const current = today?.openSession?.task?.id === taskId;

  const work = useMutation({
    mutationFn: () =>
      today?.isWorking === true
        ? api.post('/attendance/switch', { projectId, taskId })
        : api.post('/attendance/start-work', { projectId, taskId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.attendanceToday });
      toast.success(`Now working on ${reference}.`);
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not switch task.'),
  });

  if (today == null) return null;
  if (current) return <Badge tone="ok">Working on this now</Badge>;
  if (today.isOnBreak) return null;
  return (
    <Button size="sm" variant="ghost" loading={work.isPending} onClick={() => work.mutate()}>
      {today.isWorking ? 'Switch to this task' : 'Start work on this'}
    </Button>
  );
}

function AddLinkCard({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/tasks/${taskId}/attachments`, { name, url }),
    onSuccess: () => {
      setName('');
      setUrl('');
      void queryClient.invalidateQueries({ queryKey: keys.task(projectId, taskId) });
      toast.success('Link attached.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not attach the link.'),
  });

  return (
    <Card title="Attach a link" description="Google Drive links are recognised automatically.">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Name" htmlFor="attachment-name" required>
          <Input
            id="attachment-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Link" htmlFor="attachment-url" required>
          <Input
            id="attachment-url"
            type="url"
            required
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" loading={add.isPending}>
          Attach
        </Button>
      </form>
    </Card>
  );
}
