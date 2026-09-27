/**
 * A single task.
 *
 * Two things here are worth noticing. Progress and status are one control, because they
 * are one idea: dragging to 100% completes the task and completing it sets 100%. And when
 * a predecessor is unfinished the server refuses the change once, explains which task is
 * in the way, and offers to proceed anyway — the override is recorded (spec section 20).
 */
import type { ProjectDetail, TaskStatus } from '@ekavist/shared';
import { MEMBER_SETTABLE_TASK_STATUSES, TASK_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../components/ui/overlays.js';
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
import { keys, useTask } from '../../lib/queries.js';
import { useQuery } from '@tanstack/react-query';

export function TaskDetailPanel({ project }: { project: ProjectDetail }) {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: task, isLoading, isError, error, refetch } = useTask(project.id, taskId);
  const [comment, setComment] = useState('');
  const [predecessorWarning, setPredecessorWarning] = useState<{
    message: string;
    status: TaskStatus;
  } | null>(null);

  const canEdit = project.capabilities.includes('task:update');
  const canUpdateOwn = project.capabilities.includes('task:update-own-progress');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
  };

  const setStatus = useMutation({
    mutationFn: ({ status, override }: { status: TaskStatus; override?: boolean }) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}/status`, {
        status,
        overridePredecessorWarning: override ?? false,
      }),
    onSuccess: () => {
      setPredecessorWarning(null);
      invalidate();
    },
    onError: (cause: unknown, variables) => {
      if (cause instanceof ApiError && cause.code === 'TASK_PREDECESSOR_INCOMPLETE') {
        setPredecessorWarning({ message: cause.message, status: variables.status });
        return;
      }
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the task.');
    },
  });

  const setProgress = useMutation({
    mutationFn: (progress: number) =>
      api.patch(`/projects/${project.id}/tasks/${taskId}/progress`, { progress }),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update progress.'),
  });

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
                  loading={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({ status: predecessorWarning.status, override: true })
                  }
                >
                  Start it anyway
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
                  onChange={(event) =>
                    setStatus.mutate({ status: event.target.value as TaskStatus })
                  }
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
                    setProgress.mutate(Number((event.target as HTMLInputElement).value))
                  }
                  onTouchEnd={(event) =>
                    setProgress.mutate(Number((event.target as HTMLInputElement).value))
                  }
                  className="h-9 w-full accent-[var(--color-accent)]"
                />
              </Field>
            </div>
          )}
        </Card>

        {(task.predecessors.length > 0 || task.successors.length > 0) && (
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
                      <li key={link.dependencyId}>
                        <Link
                          to={`/projects/${project.id}/tasks/${link.task.id}`}
                          className="flex items-center gap-2 text-[13px] hover:text-accent"
                        >
                          <Badge tone={TASK_STATUS_TONE[link.task.status]}>
                            {link.task.reference}
                          </Badge>
                          <span className="truncate">{link.task.name}</span>
                        </Link>
                      </li>
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
                      <li key={link.dependencyId}>
                        <Link
                          to={`/projects/${project.id}/tasks/${link.task.id}`}
                          className="flex items-center gap-2 text-[13px] hover:text-accent"
                        >
                          <Badge tone={TASK_STATUS_TONE[link.task.status]}>
                            {link.task.reference}
                          </Badge>
                          <span className="truncate">{link.task.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
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
    </div>
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
