import type { CreateProjectInput, ProjectStatus, UserDetail } from '@ekavist/shared';
import { PROJECT_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HealthDot } from './DashboardPage.js';
import { Avatar, FilterBar, PageHeader, Pagination } from '../components/ui/page.js';
import { Modal, useToast } from '../components/ui/overlays.js';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  ProgressBar,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui/primitives.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import { ApiError, api } from '../lib/api.js';
import { formatDate, humanise, PROJECT_STATUS_TONE } from '../lib/format.js';
import { useProjects, useUsers } from '../lib/queries.js';

export function ProjectsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, error, refetch } = useProjects({
    page,
    pageSize: 20,
    search: search.trim() === '' ? undefined : search.trim(),
    status: status === '' ? undefined : status,
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Every project you have access to."
        actions={
          can('project:create') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New project
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <Input
          type="search"
          placeholder="Search by name, code or client"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ProjectStatus | '');
            setPage(1);
          }}
          className="w-44"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <div className="card">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title={search.trim() !== '' || status !== '' ? 'Nothing matched' : 'No projects yet'}
            description={
              search.trim() !== '' || status !== ''
                ? 'Try a different search term or clear the status filter.'
                : can('project:create')
                  ? 'Create the first project to start planning work.'
                  : 'When you are added to a project it will appear here.'
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Lead</Th>
                  <Th>Phase</Th>
                  <Th>Status</Th>
                  <Th>Health</Th>
                  <Th align="right">Tasks</Th>
                  <Th>Target</Th>
                  <Th className="w-36">Progress</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((project) => (
                  <tr key={project.id} className="hover:bg-canvas">
                    <Td>
                      <Link to={`/projects/${project.id}`} className="group flex flex-col">
                        <span className="font-medium text-ink group-hover:text-accent">
                          {project.name}
                        </span>
                        <span className="text-[11px] text-ink-faint">{project.code}</span>
                      </Link>
                    </Td>
                    <Td>
                      {project.lead == null ? (
                        <span className="text-[12px] text-ink-faint">Unassigned</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Avatar name={project.lead.fullName} size="sm" />
                          <span className="text-[13px]">{project.lead.fullName}</span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {project.currentPhase?.name ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={PROJECT_STATUS_TONE[project.status]}>
                        {humanise(project.status)}
                      </Badge>
                    </Td>
                    <Td>
                      <HealthDot level={project.health} />
                    </Td>
                    <Td align="right">
                      <span className="text-[13px]">
                        {project.taskCounts.completed}/{project.taskCounts.total}
                      </span>
                      {project.taskCounts.overdue > 0 && (
                        <span className="block text-[11px] font-medium text-danger">
                          {project.taskCounts.overdue} overdue
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">
                        {formatDate(project.plannedEndDate)}
                      </span>
                    </Td>
                    <Td>
                      <ProgressBar value={project.progress} showLabel />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </div>

      <CreateProjectModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: users } = useUsers({ page: 1, pageSize: 100, status: 'ACTIVE' });

  const [form, setForm] = useState<Partial<CreateProjectInput>>({
    priority: 'MEDIUM',
    useDefaultPhases: true,
  });
  const [error, setError] = useState<ApiError | null>(null);

  const create = useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<{ id: string }>('/projects', input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created.');
      onClose();
      navigate(`/projects/${project.id}`);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof ApiError ? cause : null);
      if (!(cause instanceof ApiError)) toast.error('Could not create the project.');
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    create.mutate(form as CreateProjectInput);
  };

  const candidates: UserDetail[] = users?.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="A project needs a lead before it can become active."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="create-project" type="submit" loading={create.isPending}>
            Create project
          </Button>
        </>
      }
    >
      <form id="create-project" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger sm:col-span-2"
            role="alert"
          >
            {error.message}
          </div>
        )}

        <Field label="Project name" htmlFor="name" required error={error?.fieldError('name')}>
          <Input
            id="name"
            required
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field
          label="Project code"
          htmlFor="code"
          required
          hint="Short handle used in references, e.g. EKV-01."
          error={error?.fieldError('code')}
        >
          <Input
            id="code"
            required
            value={form.code ?? ''}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field
          label="Project lead"
          htmlFor="leadId"
          required
          error={error?.fieldError('leadId')}
          className="sm:col-span-2"
        >
          <Select
            id="leadId"
            required
            value={form.leadId ?? ''}
            onChange={(event) => setForm({ ...form, leadId: event.target.value })}
          >
            <option value="">Choose a person…</option>
            {candidates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} — {user.designation ?? humanise(user.role)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Start date"
          htmlFor="startDate"
          required
          error={error?.fieldError('startDate')}
        >
          <Input
            id="startDate"
            type="date"
            required
            value={form.startDate ?? ''}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </Field>

        <Field
          label="Planned completion"
          htmlFor="plannedEndDate"
          required
          error={error?.fieldError('plannedEndDate')}
        >
          <Input
            id="plannedEndDate"
            type="date"
            required
            value={form.plannedEndDate ?? ''}
            onChange={(event) => setForm({ ...form, plannedEndDate: event.target.value })}
          />
        </Field>

        <Field label="Priority" htmlFor="priority">
          <Select
            id="priority"
            value={form.priority ?? 'MEDIUM'}
            onChange={(event) =>
              setForm({ ...form, priority: event.target.value as CreateProjectInput['priority'] })
            }
          >
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Client or department" htmlFor="client">
          <Input
            id="client"
            value={form.client ?? ''}
            onChange={(event) => setForm({ ...form, client: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <Textarea
            id="description"
            rows={3}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <label className="flex items-start gap-2.5 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.useDefaultPhases !== false}
            onChange={(event) => setForm({ ...form, useDefaultPhases: event.target.checked })}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm text-ink">Create the eight Waterfall phases</span>
            <span className="block text-[12px] text-ink-faint">
              Initiation, Requirements, Planning, Design, Execution, Testing, Deployment and
              Closure. You can rename, reorder or remove them afterwards.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
