import type { CreateTaskInput, ProjectDetail, TaskStatus } from '@ekavist/shared';
import { PRIORITIES, TASK_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { TaskTable } from '../../components/TaskTable.js';
import { Modal, useToast } from '../../components/ui/overlays.js';
import { FilterBar, Pagination } from '../../components/ui/page.js';
import {
  Button,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { humanise } from '../../lib/format.js';
import { useMembers, usePhases, useTasks, useWbs } from '../../lib/queries.js';

export function TasksTab({ project }: { project: ProjectDetail }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [assigneeId, setAssigneeId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data: members } = useMembers(project.id);
  const { data, isLoading, isError, error, refetch } = useTasks(project.id, {
    page,
    pageSize: 25,
    search: search.trim() === '' ? undefined : search.trim(),
    status: status === '' ? undefined : status,
    assigneeId: assigneeId === '' ? undefined : assigneeId,
    overdueOnly: overdueOnly ? true : undefined,
  });

  const canCreate = project.capabilities.includes('task:create');

  return (
    <>
      <FilterBar>
        <Input
          type="search"
          placeholder="Search tasks"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-56"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as TaskStatus | '');
            setPage(1);
          }}
          className="w-40"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {TASK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
        <Select
          value={assigneeId}
          onChange={(event) => {
            setAssigneeId(event.target.value);
            setPage(1);
          }}
          className="w-48"
          aria-label="Filter by assignee"
        >
          <option value="">Anyone</option>
          {(members ?? []).map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.fullName}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked);
              setPage(1);
            }}
            className="size-4 accent-[var(--color-accent)]"
          />
          Overdue only
        </label>

        <span className="flex-1" />
        {canCreate && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            New task
          </Button>
        )}
      </FilterBar>

      <div className="card">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null ? null : (
          <>
            <TaskTable
              tasks={data.data}
              emptyTitle="No tasks match"
              emptyDescription={
                canCreate
                  ? 'Create a task, or clear the filters to see everything.'
                  : 'Clear the filters to see everything.'
              }
            />
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </div>

      <TaskModal project={project} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function TaskModal({
  project,
  open,
  onClose,
  defaults,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  defaults?: Partial<CreateTaskInput>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: members } = useMembers(project.id);
  const { data: phases } = usePhases(project.id);
  const { data: wbs } = useWbs(project.id);

  const [form, setForm] = useState<Partial<CreateTaskInput>>({
    priority: 'MEDIUM',
    status: 'NOT_STARTED',
    assigneeIds: [],
    ...defaults,
  });
  const [error, setError] = useState<ApiError | null>(null);

  const create = useMutation({
    mutationFn: (input: Partial<CreateTaskInput>) =>
      api.post(`/projects/${project.id}/tasks`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Task created.');
      setForm({ priority: 'MEDIUM', status: 'NOT_STARTED', assigneeIds: [] });
      onClose();
    },
    onError: (cause: unknown) => {
      setError(cause instanceof ApiError ? cause : null);
      if (!(cause instanceof ApiError)) toast.error('Could not create the task.');
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    create.mutate(form);
  };

  // Flattening the tree gives a selectable list without losing the hierarchy in the label.
  const wbsOptions: { id: string; label: string }[] = [];
  const walk = (nodes: typeof wbs, depth = 0): void => {
    for (const node of nodes ?? []) {
      wbsOptions.push({ id: node.id, label: `${'— '.repeat(depth)}${node.code} ${node.name}` });
      walk(node.children, depth + 1);
    }
  };
  walk(wbs);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="task-form" loading={create.isPending}>
            Create task
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger sm:col-span-2"
            role="alert"
          >
            {error.message}
          </div>
        )}

        <Field label="Task name" htmlFor="task-name" required className="sm:col-span-2">
          <Input
            id="task-name"
            required
            autoFocus
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="task-description" className="sm:col-span-2">
          <Textarea
            id="task-description"
            rows={3}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <Field label="Phase" htmlFor="task-phase">
          <Select
            id="task-phase"
            value={form.phaseId ?? ''}
            onChange={(event) =>
              setForm({ ...form, phaseId: event.target.value || undefined, wbsItemId: undefined })
            }
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
          label="WBS item"
          htmlFor="task-wbs"
          hint="Choosing a WBS item sets the phase to match."
        >
          <Select
            id="task-wbs"
            value={form.wbsItemId ?? ''}
            onChange={(event) => setForm({ ...form, wbsItemId: event.target.value || undefined })}
          >
            <option value="">No WBS item</option>
            {wbsOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Assignees"
          htmlFor="task-assignees"
          hint="Only people on this project can be assigned."
          className="sm:col-span-2"
        >
          <div className="flex flex-wrap gap-1.5">
            {(members ?? []).map((member) => {
              const selected = (form.assigneeIds ?? []).includes(member.user.id);
              return (
                <button
                  key={member.user.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      assigneeIds: selected
                        ? (form.assigneeIds ?? []).filter((id) => id !== member.user.id)
                        : [...(form.assigneeIds ?? []), member.user.id],
                    })
                  }
                  className={
                    selected
                      ? 'rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium text-white'
                      : 'rounded-full border border-line-strong px-2.5 py-1 text-[12px] text-ink-soft hover:bg-canvas'
                  }
                >
                  {member.user.fullName}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Start date" htmlFor="task-start">
          <Input
            id="task-start"
            type="date"
            value={form.startDate ?? ''}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </Field>

        <Field label="Due date" htmlFor="task-due" error={error?.fieldError('dueDate')}>
          <Input
            id="task-due"
            type="date"
            value={form.dueDate ?? ''}
            onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
          />
        </Field>

        <Field label="Priority" htmlFor="task-priority">
          <Select
            id="task-priority"
            value={form.priority ?? 'MEDIUM'}
            onChange={(event) =>
              setForm({ ...form, priority: event.target.value as CreateTaskInput['priority'] })
            }
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Estimated hours"
          htmlFor="task-hours"
          hint="Used to weight progress, so a long task counts for more than a short one."
        >
          <Input
            id="task-hours"
            type="number"
            min={0}
            step={0.5}
            value={form.estimatedHours ?? ''}
            onChange={(event) =>
              setForm({
                ...form,
                estimatedHours: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
        </Field>
      </form>
    </Modal>
  );
}
