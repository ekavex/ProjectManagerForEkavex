/**
 * Project closure (spec sections 82 and 83): the checklist derived from live data, the
 * handover note, lessons learned, and the close itself.
 *
 * Open items do not make closing impossible — real projects end with loose threads — but
 * they must be acknowledged explicitly, and the acknowledgement is recorded.
 */
import type { LessonCategory, ProjectDetail } from '@ekavist/shared';
import { LESSON_CATEGORIES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm, useToast } from '../../components/ui/overlays.js';
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
import { formatRelative, humanise } from '../../lib/format.js';
import { keys, useClosure, useLessons } from '../../lib/queries.js';

export function ClosureTab({ project }: { project: ProjectDetail }) {
  const canClose = project.capabilities.includes('project:close');
  const closable = project.status === 'ACTIVE' || project.status === 'AT_RISK';
  const lessonsWritable = canClose && project.archivedAt == null && project.status !== 'CANCELLED';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-4">
        <Checklist project={project} canClose={canClose && closable} />
        <LessonsCard project={project} writable={lessonsWritable} />
      </div>
      <HandoverCard project={project} editable={canClose && closable} />
    </div>
  );
}

function Checklist({ project, canClose }: { project: ProjectDetail; canClose: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, isLoading, isError, error, refetch } = useClosure(project.id);
  const [acknowledge, setAcknowledge] = useState(false);

  const close = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/closure`, { acknowledgeOpenItems: acknowledge }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project closed. Everyone on it has been told.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not close the project.'),
  });

  if (isLoading) {
    return (
      <Card title="Closure checklist">
        <LoadingState />
      </Card>
    );
  }
  if (isError || data == null) {
    return (
      <Card title="Closure checklist">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  const open = data.items.filter((item) => !item.satisfied).length;

  return (
    <Card
      title="Closure checklist"
      description="Every item is read from the project itself, not ticked by hand."
    >
      <ul className="flex flex-col gap-2.5">
        {data.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            <span
              className={
                item.satisfied
                  ? 'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ok-soft text-[12px] text-ok'
                  : 'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-warn-soft text-[12px] text-[oklch(45%_0.12_70)]'
              }
              aria-hidden="true"
            >
              {item.satisfied ? '✓' : '!'}
            </span>
            <div>
              <p className="text-[13px] font-medium text-ink">{item.label}</p>
              <p className="text-[12px] text-ink-faint">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      {project.status === 'COMPLETED' ? (
        <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-soft">
          This project was closed {project.closedAt != null ? formatRelative(project.closedAt) : ''}
          . Lessons can still be added below.
        </p>
      ) : canClose ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
          {open > 0 && (
            <Checkbox
              label={`Close with ${open} open item${open === 1 ? '' : 's'}`}
              description="The items you are leaving open are recorded with the closure."
              checked={acknowledge}
              onChange={(event) => setAcknowledge(event.target.checked)}
            />
          )}
          <div>
            <Button
              variant="primary"
              loading={close.isPending}
              disabled={open > 0 && !acknowledge}
              onClick={() => {
                void confirm({
                  title: 'Close this project?',
                  message:
                    'It becomes Completed and read-only. Lessons learned can still be added afterwards.',
                  confirmLabel: 'Close project',
                }).then((ok) => {
                  if (ok) close.mutate();
                });
              }}
            >
              Close project
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-faint">
          Only an active or at-risk project can be closed, by its lead.
        </p>
      )}
    </Card>
  );
}

function HandoverCard({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState(project.handoverNote ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/projects/${project.id}`, {
        handoverNote: note.trim() === '' ? null : note.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Handover note saved.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the note.'),
  });

  return (
    <Card
      title="Handover"
      description="Who now owns the result, where everything is, and what they need to know."
    >
      {editable ? (
        <div className="flex flex-col gap-3">
          <Textarea
            rows={10}
            aria-label="Handover note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save handover note
            </Button>
          </div>
        </div>
      ) : project.handoverNote != null ? (
        <p className="text-[13px] whitespace-pre-wrap text-ink-soft">{project.handoverNote}</p>
      ) : (
        <p className="text-[13px] text-ink-faint">No handover note was written.</p>
      )}
    </Card>
  );
}

function LessonsCard({ project, writable }: { project: ProjectDetail; writable: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useLessons(project.id);
  const [category, setCategory] = useState<LessonCategory>('WHAT_WENT_WELL');
  const [note, setNote] = useState('');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.lessons(project.id) });
    void queryClient.invalidateQueries({ queryKey: keys.closure(project.id) });
  };

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/lessons`, { category, note: note.trim() }),
    onSuccess: () => {
      setNote('');
      invalidate();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the lesson.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${project.id}/lessons/${id}`),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove the lesson.'),
  });

  return (
    <Card title="Lessons learned" description="What the next project should keep, and change.">
      {isLoading ? (
        <LoadingState />
      ) : data == null || data.length === 0 ? (
        <EmptyState
          title="No lessons recorded yet"
          description="What went well, what went wrong, and what to do differently next time."
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((lesson) => (
            <li key={lesson.id} className="flex items-start gap-2.5">
              <Badge tone="neutral">{humanise(lesson.category)}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] whitespace-pre-wrap text-ink">{lesson.note}</p>
                <p className="text-[11px] text-ink-faint">
                  {lesson.author?.fullName ?? 'Someone'} · {formatRelative(lesson.createdAt)}
                </p>
              </div>
              {writable && (
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[12px] text-ink-faint hover:text-danger"
                  aria-label="Remove this lesson"
                  onClick={() => remove.mutate(lesson.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {writable && (
        <form
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim() !== '') add.mutate();
          }}
        >
          <Field label="Kind" htmlFor="lesson-category">
            <Select
              id="lesson-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as LessonCategory)}
            >
              {LESSON_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lesson" htmlFor="lesson-note">
            <Input
              id="lesson-note"
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={add.isPending}
            disabled={note.trim() === ''}
          >
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}
