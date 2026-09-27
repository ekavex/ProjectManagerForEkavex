/**
 * "My work" (spec section 26): one screen for everything assigned to the signed-in
 * person, plus their private notes.
 */
import type { CreatePersonalNoteInput, PersonalNote } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TaskTable } from '../components/TaskTable.js';
import { Modal, useConfirm, useToast } from '../components/ui/overlays.js';
import { PageHeader } from '../components/ui/page.js';
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
  Textarea,
} from '../components/ui/primitives.js';
import { api } from '../lib/api.js';
import { formatRelative } from '../lib/format.js';
import { keys, useMyWork, usePersonalNotes } from '../lib/queries.js';

type Bucket = 'today' | 'upcoming' | 'overdue' | 'completed';

export function MyWorkPage() {
  const [bucket, setBucket] = useState<Bucket>('today');
  const { data, isLoading, isError, error, refetch } = useMyWork();

  const counts = {
    today: data?.today.length ?? 0,
    upcoming: data?.upcoming.length ?? 0,
    overdue: data?.overdue.length ?? 0,
    completed: data?.completed.length ?? 0,
  };

  const buckets: { key: Bucket; label: string; tone?: 'danger' }[] = [
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'overdue', label: 'Overdue', tone: 'danger' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <>
      <PageHeader title="My work" subtitle="Everything assigned to you, across every project." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {buckets.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setBucket(item.key)}
                className={
                  bucket === item.key
                    ? 'rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white'
                    : 'rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink-soft hover:bg-canvas'
                }
              >
                {item.label}
                <span
                  className={
                    item.tone === 'danger' && counts[item.key] > 0 && bucket !== item.key
                      ? 'tabular ml-1.5 font-semibold text-danger'
                      : 'tabular ml-1.5 opacity-70'
                  }
                >
                  {counts[item.key]}
                </span>
              </button>
            ))}
          </div>

          <div className="card">
            {isLoading ? (
              <LoadingState />
            ) : isError ? (
              <ErrorState error={error} onRetry={() => void refetch()} />
            ) : data == null ? null : (
              <TaskTable
                tasks={data[bucket]}
                showProject
                emptyTitle={
                  bucket === 'overdue'
                    ? 'Nothing is overdue'
                    : bucket === 'today'
                      ? 'Nothing is due today'
                      : bucket === 'upcoming'
                        ? 'Nothing coming up'
                        : 'Nothing completed yet'
                }
                emptyDescription={
                  bucket === 'overdue'
                    ? 'Everything assigned to you is inside its due date.'
                    : bucket === 'upcoming'
                      ? 'No tasks are due in the next two weeks.'
                      : undefined
                }
              />
            )}
          </div>

          {data != null && data.projects.length > 0 && (
            <Card title="My projects" className="mt-4">
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={`/projects/${project.id}`}
                      className="card block px-3 py-2.5 hover:border-accent"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">
                          {project.name}
                        </span>
                        <Badge tone="neutral">{project.code}</Badge>
                      </span>
                      <ProgressBar value={project.progress} showLabel className="mt-2" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <PersonalNotes />
      </div>
    </>
  );
}

/**
 * Personal notes are private. The endpoint has no project parameter and the server keys
 * every query on the signed-in user, so there is no way for one person's notes to appear
 * in another's project view.
 */
function PersonalNotes() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<PersonalNote | 'new' | null>(null);

  const { data, isLoading } = usePersonalNotes({ page: 1, pageSize: 50 });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/me/notes/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'notes'] });
      void queryClient.invalidateQueries({ queryKey: keys.myDashboard });
      toast.success('Note deleted.');
    },
  });

  return (
    <>
      <Card
        title="My notes"
        description="Private to you. Nobody else can see these."
        action={
          <Button size="sm" onClick={() => setEditing('new')}>
            Add
          </Button>
        }
      >
        {isLoading ? (
          <LoadingState />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Reminders, questions and follow-ups that are just for you."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.data.map((note) => (
              <li key={note.id} className="card px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setEditing(note)}
                  >
                    <span className="flex items-center gap-1.5">
                      {note.pinned && <span aria-label="Pinned">📌</span>}
                      <span className="truncate text-[13px] font-medium text-ink">
                        {note.title}
                      </span>
                    </span>
                    {note.body !== '' && (
                      <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-faint">
                        {note.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-ink-faint">
                      {formatRelative(note.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${note.title}`}
                    className="rounded p-1 text-ink-faint hover:bg-canvas hover:text-danger"
                    onClick={() => {
                      void confirm({
                        title: 'Delete this note?',
                        message: `“${note.title}” will be removed. This cannot be undone.`,
                        confirmLabel: 'Delete',
                      }).then((confirmed) => {
                        if (confirmed) remove.mutate(note.id);
                      });
                    }}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NoteModal note={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function NoteModal({ note, onClose }: { note: PersonalNote | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = note !== 'new' && note != null ? note : null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  // Load the note's values once per open, without an effect that fights the user's typing.
  const key = existing?.id ?? (note === 'new' ? 'new' : null);
  if (key != null && key !== initialisedFor) {
    setInitialisedFor(key);
    setTitle(existing?.title ?? '');
    setBody(existing?.body ?? '');
    setPinned(existing?.pinned ?? false);
  }

  const save = useMutation({
    mutationFn: (input: CreatePersonalNoteInput) =>
      existing == null
        ? api.post('/me/notes', input)
        : api.patch(`/me/notes/${existing.id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'notes'] });
      void queryClient.invalidateQueries({ queryKey: keys.myDashboard });
      toast.success(existing == null ? 'Note added.' : 'Note saved.');
      setInitialisedFor(null);
      onClose();
    },
    onError: () => toast.error('Could not save the note.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate({ title, body, pinned, reminderAt: null });
  };

  return (
    <Modal
      open={note != null}
      onClose={() => {
        setInitialisedFor(null);
        onClose();
      }}
      title={existing == null ? 'New note' : 'Edit note'}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="note-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="note-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Title" htmlFor="note-title" required>
          <Input
            id="note-title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor="note-body">
          <Textarea
            id="note-body"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          Pin to the top
        </label>
      </form>
    </Modal>
  );
}
