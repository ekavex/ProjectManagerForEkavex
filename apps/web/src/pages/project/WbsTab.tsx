/**
 * The Work Breakdown Structure (spec section 15).
 *
 * Codes are assigned by the server and recomputed whenever the tree changes, so adding an
 * item in the middle renumbers everything below it without anyone editing a code by hand.
 */
import type { CreateWbsItemInput, ProjectDetail, WbsNode } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  ProgressBar,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { keys, useMembers, usePhases, useWbs } from '../../lib/queries.js';

export function WbsTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<{ parentId?: string; phaseId?: string } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const { data: tree, isLoading, isError, error, refetch } = useWbs(project.id);
  const canManage = project.capabilities.includes('wbs:create');

  const remove = useMutation({
    mutationFn: (wbsId: string) => api.delete(`/projects/${project.id}/wbs/${wbsId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('Removed. Any tasks beneath it stay in the project without a WBS item.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove that item.'),
  });

  const move = useMutation({
    mutationFn: ({
      wbsId,
      position,
    }: {
      wbsId: string;
      position: number;
      parentId: string | null;
    }) =>
      api.post(`/projects/${project.id}/wbs/${wbsId}/move`, {
        parentId: null,
        position,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.wbs(project.id) }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not move that item.'),
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

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: WbsNode, depth: number, index: number, siblings: number) => (
    <li key={node.id}>
      <div
        className="flex items-center gap-2 border-b border-line py-2"
        style={{ paddingLeft: depth * 20 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
            className="rounded p-0.5 text-ink-faint hover:bg-canvas hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              className={collapsed.has(node.id) ? '' : 'rotate-90'}
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" fill="none" />
            </svg>
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="tabular w-14 shrink-0 text-[12px] font-medium text-ink-faint">
          {node.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {node.name}
        </span>

        <span className="hidden w-32 shrink-0 truncate text-[12px] text-ink-faint sm:block">
          {node.owner?.fullName ?? '—'}
        </span>
        <span className="tabular hidden w-24 shrink-0 text-[12px] text-ink-faint md:block">
          {formatDate(node.plannedEnd)}
        </span>
        <span className="tabular hidden w-16 shrink-0 text-right text-[12px] text-ink-faint sm:block">
          {node.taskCount} task{node.taskCount === 1 ? '' : 's'}
        </span>
        <ProgressBar value={node.progress} showLabel className="w-28 shrink-0" />

        {canManage && (
          <span className="flex shrink-0 gap-0.5">
            {depth === 0 && (
              <>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label="Move up"
                  className="rounded px-1 text-ink-faint hover:bg-canvas disabled:opacity-30"
                  onClick={() =>
                    move.mutate({ wbsId: node.id, position: index - 1, parentId: null })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === siblings - 1}
                  aria-label="Move down"
                  className="rounded px-1 text-ink-faint hover:bg-canvas disabled:opacity-30"
                  onClick={() =>
                    move.mutate({ wbsId: node.id, position: index + 1, parentId: null })
                  }
                >
                  ↓
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={`Add a child under ${node.name}`}
              className="rounded px-1.5 text-ink-faint hover:bg-canvas hover:text-accent"
              onClick={() => setAdding({ parentId: node.id })}
            >
              +
            </button>
            <button
              type="button"
              aria-label={`Remove ${node.name}`}
              className="rounded px-1.5 text-ink-faint hover:bg-canvas hover:text-danger"
              onClick={() => {
                void confirm({
                  title: `Remove ${node.code} ${node.name}?`,
                  message:
                    'Everything beneath it is removed too. Tasks stay in the project but lose their WBS item.',
                  confirmLabel: 'Remove',
                }).then((ok) => {
                  if (ok) remove.mutate(node.id);
                });
              }}
            >
              ×
            </button>
          </span>
        )}
      </div>

      {!collapsed.has(node.id) && node.children.length > 0 && (
        <ul>
          {node.children.map((child, childIndex) =>
            renderNode(child, depth + 1, childIndex, node.children.length),
          )}
        </ul>
      )}
    </li>
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-faint">
          Break the work down until each item is small enough to own. Codes are assigned
          automatically.
        </p>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setAdding({})}>
            Add item
          </Button>
        )}
      </div>

      <Card bodyClassName="p-0">
        {tree == null || tree.length === 0 ? (
          <EmptyState
            title="No work breakdown yet"
            description="Start with the top-level pieces of work, then break each one down."
            action={
              canManage ? (
                <Button variant="primary" size="sm" onClick={() => setAdding({})}>
                  Add the first item
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="px-3 py-1">
            {tree.map((node, index) => renderNode(node, 0, index, tree.length))}
          </ul>
        )}
      </Card>

      <WbsModal
        project={project}
        defaults={adding ?? {}}
        open={adding != null}
        onClose={() => setAdding(null)}
      />
    </>
  );
}

function WbsModal({
  project,
  defaults,
  open,
  onClose,
}: {
  project: ProjectDetail;
  defaults: { parentId?: string; phaseId?: string };
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: phases } = usePhases(project.id);
  const { data: members } = useMembers(project.id);

  const [form, setForm] = useState<Partial<CreateWbsItemInput>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = open ? (defaults.parentId ?? 'root') : null;
  if (key != null && key !== loadedFor) {
    setLoadedFor(key);
    setForm({ parentId: defaults.parentId, phaseId: defaults.phaseId });
  }

  const create = useMutation({
    mutationFn: (input: Partial<CreateWbsItemInput>) =>
      api.post(`/projects/${project.id}/wbs`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
      toast.success('WBS item added.');
      setLoadedFor(null);
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the item.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate(form);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setLoadedFor(null);
        onClose();
      }}
      title={defaults.parentId != null ? 'Add a child item' : 'Add a WBS item'}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="wbs-form" loading={create.isPending}>
            Add
          </Button>
        </>
      }
    >
      <form id="wbs-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="wbs-name" required>
          <Input
            id="wbs-name"
            required
            autoFocus
            value={form.name ?? ''}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="wbs-description">
          <Textarea
            id="wbs-description"
            rows={2}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        {defaults.parentId == null && (
          <Field
            label="Phase"
            htmlFor="wbs-phase"
            hint="A child item always belongs to the same phase as its parent."
          >
            <Select
              id="wbs-phase"
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
        )}

        <Field label="Owner" htmlFor="wbs-owner">
          <Select
            id="wbs-owner"
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Planned start" htmlFor="wbs-start">
            <Input
              id="wbs-start"
              type="date"
              value={form.plannedStart ?? ''}
              onChange={(event) => setForm({ ...form, plannedStart: event.target.value })}
            />
          </Field>
          <Field label="Planned end" htmlFor="wbs-end">
            <Input
              id="wbs-end"
              type="date"
              value={form.plannedEnd ?? ''}
              onChange={(event) => setForm({ ...form, plannedEnd: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Deliverable" htmlFor="wbs-deliverable">
          <Input
            id="wbs-deliverable"
            value={form.deliverable ?? ''}
            onChange={(event) => setForm({ ...form, deliverable: event.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
