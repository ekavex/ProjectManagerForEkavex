import type { ProjectDetail, ProjectRole } from '@ekavist/shared';
import { PROJECT_ROLES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import { Avatar } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  ProgressBar,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise } from '../../lib/format.js';
import { keys, useMembers, useUsers } from '../../lib/queries.js';

export function TeamTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const { data: members, isLoading, isError, error, refetch } = useMembers(project.id);
  const canManage = project.capabilities.includes('member:add');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.members(project.id) });
    void queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
  };

  const update = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: Record<string, unknown> }) =>
      api.patch(`/projects/${project.id}/members/${userId}`, body),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update that member.'),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${project.id}/members/${userId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Removed from the project. Their tasks stay, unassigned.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove that member.'),
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
      <Card
        title="Project team"
        description="A viewer sees the project read-only, and only sees the chat if you allow it."
        action={
          canManage ? (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add member
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {members == null || members.length === 0 ? (
          <EmptyState title="Nobody on this project yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Responsibility</Th>
                <Th align="right">Tasks</Th>
                <Th className="w-36">Progress</Th>
                <Th>Joined</Th>
                {canManage && <Th />}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isLead = project.lead?.id === member.user.id;
                return (
                  <tr key={member.id} className="hover:bg-canvas">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={member.user.fullName} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {member.user.fullName}
                          </span>
                          <span className="block truncate text-[11px] text-ink-faint">
                            {member.user.designation ?? member.user.email}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      {canManage && !isLead ? (
                        <Select
                          value={member.projectRole}
                          className="h-8 w-28"
                          aria-label={`Role for ${member.user.fullName}`}
                          onChange={(event) =>
                            update.mutate({
                              userId: member.user.id,
                              body: { projectRole: event.target.value as ProjectRole },
                            })
                          }
                        >
                          {PROJECT_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {humanise(role)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={isLead ? 'accent' : 'neutral'}>
                          {isLead ? 'Project lead' : humanise(member.projectRole)}
                        </Badge>
                      )}
                      {member.projectRole === 'VIEWER' && (
                        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
                          <input
                            type="checkbox"
                            checked={member.canReadChat}
                            disabled={!canManage}
                            onChange={(event) =>
                              update.mutate({
                                userId: member.user.id,
                                body: { canReadChat: event.target.checked },
                              })
                            }
                            className="size-3.5 accent-[var(--color-accent)]"
                          />
                          Can read chat
                        </label>
                      )}
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {member.responsibility ?? '—'}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="text-[13px]">
                        {member.completedTasks}/{member.assignedTasks}
                      </span>
                    </Td>
                    <Td>
                      <ProgressBar value={member.progress} showLabel />
                    </Td>
                    <Td>
                      <span className="tabular text-[12px] text-ink-faint">
                        {formatDate(member.joinedAt.slice(0, 10))}
                      </span>
                    </Td>
                    {canManage && (
                      <Td align="right">
                        {!isLead && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void confirm({
                                title: `Remove ${member.user.fullName}?`,
                                message:
                                  'Their task assignments are cleared. The tasks themselves stay in the project so the work is not lost.',
                                confirmLabel: 'Remove',
                              }).then((ok) => {
                                if (ok) remove.mutate(member.user.id);
                              });
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <AddMemberModal project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddMemberModal({
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
  // 100 is the server's maximum page size; asking for more is rejected outright and the
  // dropdown would silently stay empty.
  const { data: users, error: usersError } = useUsers({
    page: 1,
    pageSize: 100,
    status: 'ACTIVE',
  });
  const { data: members } = useMembers(project.id);

  const [userId, setUserId] = useState('');
  const [projectRole, setProjectRole] = useState<ProjectRole>('MEMBER');

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/members`, { userId, projectRole }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(project.id) });
      void queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
      toast.success('Added to the project.');
      setUserId('');
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add that person.'),
  });

  const existing = new Set((members ?? []).map((member) => member.user.id));
  const candidates = (users?.data ?? []).filter((user) => !existing.has(user.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add someone to the project"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={userId === ''}
            onClick={() => add.mutate()}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Person" htmlFor="member-user" required>
          <Select
            id="member-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Choose someone…</option>
            {candidates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} — {user.designation ?? humanise(user.role)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Project role"
          htmlFor="member-role"
          hint="A member can update their own tasks and post in chat. A viewer can only read."
        >
          <Select
            id="member-role"
            value={projectRole}
            onChange={(event) => setProjectRole(event.target.value as ProjectRole)}
          >
            {PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {humanise(role)}
              </option>
            ))}
          </Select>
        </Field>

        {usersError != null ? (
          <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-[13px] text-danger">
            The list of people could not be loaded, so there is nothing to choose from. Close this
            and try again.
          </p>
        ) : (
          candidates.length === 0 && (
            <p className="text-[13px] text-ink-faint">
              Everyone active is already on this project.
            </p>
          )
        )}
      </div>
    </Modal>
  );
}
