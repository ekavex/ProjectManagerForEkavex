/**
 * Project notes and the decision log (spec sections 38 and 39).
 *
 * Project notes are shared with the team; personal notes live under My work and are never
 * reachable from a project. The decision log is separate on purpose: a decision is part of
 * the project record, not a note someone may later edit away.
 */
import type { CreateDecisionInput, CreateProjectNoteInput, ProjectDetail } from '@ekavist/shared';
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
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, formatRelative } from '../../lib/format.js';
import { useDecisions, useMembers, usePhases, useProjectNotes } from '../../lib/queries.js';

export function NotesTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectNotes project={project} />
      <DecisionLog project={project} />
    </div>
  );
}

function ProjectNotes({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, error, refetch } = useProjectNotes(project.id, {
    page: 1,
    pageSize: 50,
  });
  const canWrite = project.capabilities.includes('note:project-write');

  const remove = useMutation({
    mutationFn: (noteId: string) => api.delete(`/projects/${project.id}/notes/${noteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'notes'] });
      toast.success('Note deleted.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not delete the note.'),
  });

  return (
    <>
      <Card
        title="Project notes"
        description="Shared with the project team."
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add note
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title="No project notes yet"
            description="Meeting notes, instructions and shared knowledge belong here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.data.map((note) => (
              <li key={note.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      {note.pinned && <span aria-label="Pinned">📌</span>}
                      {note.title}
                      {note.visibility === 'LEADS_ONLY' && <Badge tone="warn">Leads only</Badge>}
                    </p>
                    {note.body !== '' && (
                      <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-soft">
                        {note.body}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {note.author.fullName} · {formatRelative(note.updatedAt)}
                      {note.phase != null && ` · ${note.phase.name}`}
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      aria-label={`Delete ${note.title}`}
                      className="rounded p-1 text-ink-faint hover:bg-canvas hover:text-danger"
                      onClick={() => {
                        void confirm({
                          title: `Delete “${note.title}”?`,
                          message: 'This cannot be undone.',
                          confirmLabel: 'Delete',
                        }).then((ok) => {
                          if (ok) remove.mutate(note.id);
                        });
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NoteModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function NoteModal({
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
  const [form, setForm] = useState<Partial<CreateProjectNoteInput>>({
    visibility: 'PROJECT',
    pinned: false,
  });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/notes`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'notes'] });
      toast.success('Note added.');
      setForm({ visibility: 'PROJECT', pinned: false });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the note.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a project note"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="project-note" loading={create.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="project-note" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Title" htmlFor="note-title" required>
          <Input
            id="note-title"
            required
            autoFocus
            value={form.title ?? ''}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Note" htmlFor="note-body">
          <Textarea
            id="note-body"
            rows={6}
            value={form.body ?? ''}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phase" htmlFor="note-phase">
            <Select
              id="note-phase"
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
          <Field label="Visible to" htmlFor="note-visibility">
            <Select
              id="note-visibility"
              value={form.visibility ?? 'PROJECT'}
              onChange={(event) =>
                setForm({
                  ...form,
                  visibility: event.target.value as CreateProjectNoteInput['visibility'],
                })
              }
            >
              <option value="PROJECT">Everyone on the project</option>
              <option value="LEADS_ONLY">Project leads only</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.pinned === true}
            onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
            className="size-4 accent-[var(--color-accent)]"
          />
          Pin to the top
        </label>
      </form>
    </Modal>
  );
}

function DecisionLog({ project }: { project: ProjectDetail }) {
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useDecisions(project.id);
  const canManage = project.capabilities.includes('decision:manage');

  return (
    <>
      <Card
        title="Decision log"
        description="What was decided, when, by whom and why."
        action={
          canManage ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Record a decision
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <LoadingState />
        ) : data == null || data.length === 0 ? (
          <EmptyState
            title="No decisions recorded"
            description="Recording decisions as they happen makes the project review far easier later."
          />
        ) : (
          <ol className="flex flex-col gap-3">
            {data.map((decision) => (
              <li key={decision.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <Badge tone="neutral">{decision.reference}</Badge>
                  {decision.title}
                </p>
                {decision.description != null && (
                  <p className="mt-0.5 text-[13px] text-ink-soft">{decision.description}</p>
                )}
                {decision.reason != null && (
                  <p className="mt-1 text-[12px] text-ink-faint">
                    <span className="font-medium">Why: </span>
                    {decision.reason}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-faint">
                  {formatDate(decision.decidedOn)}
                  {decision.decisionMaker != null && ` · ${decision.decisionMaker.fullName}`}
                  {decision.phase != null && ` · ${decision.phase.name}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <DecisionModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function DecisionModal({
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
  const { data: members } = useMembers(project.id);
  const { data: phases } = usePhases(project.id);
  const [form, setForm] = useState<Partial<CreateDecisionInput>>({
    decidedOn: new Date().toISOString().slice(0, 10),
  });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/decisions`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'decisions'] });
      toast.success('Decision recorded.');
      setForm({ decidedOn: new Date().toISOString().slice(0, 10) });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not record the decision.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a decision"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="decision-form" loading={create.isPending}>
            Record
          </Button>
        </>
      }
    >
      <form id="decision-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Decision" htmlFor="decision-title" required>
          <Input
            id="decision-title"
            required
            autoFocus
            value={form.title ?? ''}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Description" htmlFor="decision-description">
          <Textarea
            id="decision-description"
            rows={3}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field
          label="Reason"
          htmlFor="decision-reason"
          hint="Why this and not the alternative. This is the part people need months later."
        >
          <Textarea
            id="decision-reason"
            rows={3}
            value={form.reason ?? ''}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Decided on" htmlFor="decision-date" required>
            <Input
              id="decision-date"
              type="date"
              required
              value={form.decidedOn ?? ''}
              onChange={(event) => setForm({ ...form, decidedOn: event.target.value })}
            />
          </Field>
          <Field label="Decision maker" htmlFor="decision-maker" required>
            <Select
              id="decision-maker"
              required
              value={form.decisionMakerId ?? ''}
              onChange={(event) => setForm({ ...form, decisionMakerId: event.target.value })}
            >
              <option value="">Choose…</option>
              {(members ?? []).map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Phase" htmlFor="decision-phase">
          <Select
            id="decision-phase"
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
