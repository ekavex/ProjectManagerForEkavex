/**
 * The issue register (spec section 45).
 *
 * An issue is a problem that has already happened, which is what separates it from a risk.
 */
import { ExportButton } from '../../components/ExportButton.js';
import type { CreateIssueInput, IssueStatus, Priority, ProjectDetail } from '@ekavist/shared';
import { ISSUE_STATUSES, PRIORITIES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useToast } from '../../components/ui/overlays.js';
import { FilterBar, Pagination } from '../../components/ui/page.js';
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
import { formatDate, humanise, ISSUE_STATUS_TONE, PRIORITY_TONE } from '../../lib/format.js';
import { useIssues, useMembers, usePhases } from '../../lib/queries.js';

export function IssuesTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<IssueStatus | ''>('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, error, refetch } = useIssues(project.id, {
    page,
    pageSize: 25,
    status: status === '' ? undefined : status,
  });

  const canManage = project.capabilities.includes('issue:manage');

  const update = useMutation({
    mutationFn: ({ issueId, body }: { issueId: string; body: Record<string, unknown> }) =>
      api.patch(`/projects/${project.id}/issues/${issueId}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', project.id] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the issue.'),
  });

  return (
    <>
      <FilterBar>
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as IssueStatus | '');
            setPage(1);
          }}
          className="w-44"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        {project.capabilities.includes('report:export') && (
          <ExportButton path={`/projects/${project.id}/export/issues`} />
        )}
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            Raise an issue
          </Button>
        )}
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title="No issues recorded"
            description="Issues are problems that have already happened and need resolving."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Issue</Th>
                  <Th>Priority</Th>
                  <Th>Owner</Th>
                  <Th>Identified</Th>
                  <Th>Target</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((issue) => (
                  <tr key={issue.id} className="hover:bg-canvas">
                    <Td>
                      <span className="flex items-center gap-2">
                        <Badge tone="neutral">{issue.reference}</Badge>
                        <span className="font-medium">{issue.title}</span>
                      </span>
                      {issue.resolution != null && (
                        <span className="mt-0.5 block text-[12px] text-ink-faint">
                          Resolution: {issue.resolution}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={PRIORITY_TONE[issue.priority]}>{humanise(issue.priority)}</Badge>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {issue.owner?.fullName ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">{formatDate(issue.identifiedOn)}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">
                        {formatDate(issue.targetResolution)}
                      </span>
                    </Td>
                    <Td>
                      {canManage ? (
                        <Select
                          value={issue.status}
                          className="h-8 w-32"
                          aria-label={`Status for ${issue.reference}`}
                          onChange={(event) =>
                            update.mutate({
                              issueId: issue.id,
                              body: { status: event.target.value },
                            })
                          }
                        >
                          {ISSUE_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {humanise(value)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={ISSUE_STATUS_TONE[issue.status]}>
                          {humanise(issue.status)}
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <IssueModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function IssueModal({
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
  const [form, setForm] = useState<Partial<CreateIssueInput>>({
    priority: 'MEDIUM',
    status: 'OPEN',
    identifiedOn: new Date().toISOString().slice(0, 10),
  });

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/issues`, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Issue raised.');
      setForm({
        priority: 'MEDIUM',
        status: 'OPEN',
        identifiedOn: new Date().toISOString().slice(0, 10),
      });
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not raise the issue.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise an issue"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="issue-form" loading={create.isPending}>
            Raise
          </Button>
        </>
      }
    >
      <form id="issue-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Issue" htmlFor="issue-title" required>
          <Input
            id="issue-title"
            required
            autoFocus
            value={form.title ?? ''}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="issue-description">
          <Textarea
            id="issue-description"
            rows={3}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="issue-priority">
            <Select
              id="issue-priority"
              value={form.priority ?? 'MEDIUM'}
              onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="issue-owner">
            <Select
              id="issue-owner"
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Identified on" htmlFor="issue-identified">
            <Input
              id="issue-identified"
              type="date"
              value={form.identifiedOn ?? ''}
              onChange={(event) => setForm({ ...form, identifiedOn: event.target.value })}
            />
          </Field>
          <Field label="Target resolution" htmlFor="issue-target">
            <Input
              id="issue-target"
              type="date"
              value={form.targetResolution ?? ''}
              onChange={(event) => setForm({ ...form, targetResolution: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Phase" htmlFor="issue-phase">
          <Select
            id="issue-phase"
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
