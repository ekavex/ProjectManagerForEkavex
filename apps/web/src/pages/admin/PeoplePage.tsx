/**
 * People administration (spec section 9).
 *
 * Accounts are deactivated, never deleted: their tasks, messages and audit entries are
 * part of the project record. A new account is created without a password and the person
 * sets their own through an emailed link, so an administrator never knows it.
 */
import type { CreateUserInput, OrgRole, UserDetail, UserStatus } from '@ekavist/shared';
import { ORG_ROLES, USER_STATUSES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal, useConfirm, useToast } from '../../components/ui/overlays.js';
import { Avatar, FilterBar, PageHeader, Pagination } from '../../components/ui/page.js';
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
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate, humanise } from '../../lib/format.js';
import { useDepartments, useUsers } from '../../lib/queries.js';

export function PeoplePage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDetail | null>(null);

  const { data, isLoading, isError, error, refetch } = useUsers({
    page,
    pageSize: 30,
    search: search.trim() === '' ? undefined : search.trim(),
    status: status === '' ? undefined : status,
  });

  const setUserStatus = useMutation({
    mutationFn: ({ user, next }: { user: UserDetail; next: UserStatus }) =>
      next === 'ACTIVE'
        ? api.post(`/users/${user.id}/activate`)
        : api.patch(`/users/${user.id}`, { status: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Account updated.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the account.'),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      api.patch(`/users/${userId}`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not change the role.'),
  });

  if (!can('user:create')) {
    return (
      <div className="card">
        <EmptyState
          title="Administrators only"
          description="Managing accounts is restricted to organisation administrators."
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Create accounts, set roles, and deactivate people who have left."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add a person
          </Button>
        }
      />

      <FilterBar>
        <Input
          type="search"
          placeholder="Search by name or email"
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
            setStatus(event.target.value as UserStatus | '');
            setPage(1);
          }}
          className="w-40"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {USER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState title="Nobody matched" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Department</Th>
                  <Th>Joined</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr key={user.id} className="hover:bg-canvas">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={user.fullName} size="sm" />
                        <span className="min-w-0">
                          <button
                            type="button"
                            className="block truncate text-left font-medium hover:text-accent"
                            onClick={() => setEditing(user)}
                          >
                            {user.fullName}
                          </button>
                          <span className="block truncate text-[11px] text-ink-faint">
                            {user.email}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Select
                        value={user.role}
                        className="h-8 w-36"
                        aria-label={`Role for ${user.fullName}`}
                        onChange={(event) =>
                          setRole.mutate({ userId: user.id, role: event.target.value as OrgRole })
                        }
                      >
                        {ORG_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {humanise(role)}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-ink-soft">
                        {user.department?.name ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">{formatDate(user.joiningDate)}</span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={user.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                          {humanise(user.status)}
                        </Badge>
                        {user.twoFactorEnabled && <Badge tone="info">2FA</Badge>}
                      </span>
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                        Edit
                      </Button>
                      {user.status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void confirm({
                              title: `Deactivate ${user.fullName}?`,
                              message:
                                'They lose access immediately. Their work, messages and history stay in the system. If they lead an active project, assign a new lead first.',
                              confirmLabel: 'Deactivate',
                            }).then((ok) => {
                              if (ok) setUserStatus.mutate({ user, next: 'INACTIVE' });
                            });
                          }}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setUserStatus.mutate({ user, next: 'ACTIVE' })}
                        >
                          Reactivate
                        </Button>
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

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      {editing != null && (
        <EditUserModal key={editing.id} user={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/**
 * Everything about a person an administrator may change after creating the account. The
 * manager matters beyond the org chart: they approve that person's leave.
 */
function EditUserModal({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: departments } = useDepartments();
  const { data: people } = useUsers({ page: 1, pageSize: 100, status: 'ACTIVE' });
  const [form, setForm] = useState({
    designation: user.designation ?? '',
    phone: user.phone ?? '',
    departmentId: user.department?.id ?? '',
    managerId: user.manager?.id ?? '',
    joiningDate: user.joiningDate ?? '',
    timezone: user.timezone,
    skills: user.skills.join(', '),
  });
  const [error, setError] = useState<ApiError | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/users/${user.id}`, {
        ...(form.designation.trim() !== '' ? { designation: form.designation.trim() } : {}),
        ...(form.phone.trim() !== '' ? { phone: form.phone.trim() } : {}),
        departmentId: form.departmentId === '' ? null : form.departmentId,
        managerId: form.managerId === '' ? null : form.managerId,
        ...(form.joiningDate !== '' ? { joiningDate: form.joiningDate } : {}),
        timezone: form.timezone,
        skills: form.skills
          .split(',')
          .map((skill) => skill.trim())
          .filter((skill) => skill !== ''),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Saved.');
      onClose();
    },
    onError: (cause: unknown) => setError(cause instanceof ApiError ? cause : null),
  });

  const resetTwoFactor = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/two-factor/reset`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${user.fullName} can now sign in with their password alone.`);
      onClose();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not reset two-factor.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={user.fullName}
      description={user.email}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-user" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-user"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger sm:col-span-2"
            role="alert"
          >
            {error.message}
          </div>
        )}
        <Field label="Designation" htmlFor="edit-designation">
          <Input
            id="edit-designation"
            value={form.designation}
            onChange={(event) => setForm({ ...form, designation: event.target.value })}
          />
        </Field>
        <Field label="Phone" htmlFor="edit-phone" error={error?.fieldError('phone')}>
          <Input
            id="edit-phone"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </Field>
        <Field label="Department" htmlFor="edit-department">
          <Select
            id="edit-department"
            value={form.departmentId}
            onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
          >
            <option value="">None</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Manager" htmlFor="edit-manager" hint="Approves this person's leave.">
          <Select
            id="edit-manager"
            value={form.managerId}
            onChange={(event) => setForm({ ...form, managerId: event.target.value })}
          >
            <option value="">None</option>
            {(people?.data ?? [])
              .filter((person) => person.id !== user.id)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Joining date" htmlFor="edit-joined">
          <Input
            id="edit-joined"
            type="date"
            value={form.joiningDate}
            onChange={(event) => setForm({ ...form, joiningDate: event.target.value })}
          />
        </Field>
        <Field label="Time zone" htmlFor="edit-timezone" error={error?.fieldError('timezone')}>
          <Input
            id="edit-timezone"
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </Field>
        <Field
          label="Skills"
          htmlFor="edit-skills"
          hint="Separate with commas."
          className="sm:col-span-2"
        >
          <Input
            id="edit-skills"
            value={form.skills}
            onChange={(event) => setForm({ ...form, skills: event.target.value })}
          />
        </Field>
      </form>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[13px] text-ink-soft">
          Two-factor sign-in is{' '}
          <span className="font-medium text-ink">{user.twoFactorEnabled ? 'on' : 'off'}</span>.
        </p>
        {user.twoFactorEnabled && (
          <Button
            size="sm"
            variant="danger"
            loading={resetTwoFactor.isPending}
            onClick={() => {
              void confirm({
                title: 'Reset two-factor sign-in?',
                message: `Only do this when ${user.fullName} has lost both their phone and their recovery codes. They can then sign in with their password alone until they set it up again.`,
                confirmLabel: 'Reset',
                tone: 'danger',
              }).then((ok) => {
                if (ok) resetTwoFactor.mutate();
              });
            }}
          >
            Reset two-factor
          </Button>
        )}
      </div>
    </Modal>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: departments } = useDepartments();

  const [form, setForm] = useState<Partial<CreateUserInput>>({ role: 'TEAM_MEMBER', skills: [] });
  const [sendInvite, setSendInvite] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ invitationSent: boolean }>('/users', {
        ...form,
        ...(sendInvite ? {} : { password }),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(
        result.invitationSent
          ? 'Account created. An invitation to set a password has been queued.'
          : 'Account created.',
      );
      setForm({ role: 'TEAM_MEMBER', skills: [] });
      setPassword('');
      onClose();
    },
    onError: (cause: unknown) => {
      setError(cause instanceof ApiError ? cause : null);
      if (!(cause instanceof ApiError)) toast.error('Could not create the account.');
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a person"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" loading={create.isPending}>
            Create account
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger sm:col-span-2"
            role="alert"
          >
            {error.message}
          </div>
        )}

        <Field label="Full name" htmlFor="user-name" required>
          <Input
            id="user-name"
            required
            autoFocus
            value={form.fullName ?? ''}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          />
        </Field>

        <Field label="Email" htmlFor="user-email" required error={error?.fieldError('email')}>
          <Input
            id="user-email"
            type="email"
            required
            value={form.email ?? ''}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>

        <Field label="Designation" htmlFor="user-designation">
          <Input
            id="user-designation"
            placeholder="Software Engineer"
            value={form.designation ?? ''}
            onChange={(event) => setForm({ ...form, designation: event.target.value })}
          />
        </Field>

        <Field label="Organisation role" htmlFor="user-role">
          <Select
            id="user-role"
            value={form.role ?? 'TEAM_MEMBER'}
            onChange={(event) => setForm({ ...form, role: event.target.value as OrgRole })}
          >
            {ORG_ROLES.map((role) => (
              <option key={role} value={role}>
                {humanise(role)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Department" htmlFor="user-department">
          <Select
            id="user-department"
            value={form.departmentId ?? ''}
            onChange={(event) =>
              setForm({ ...form, departmentId: event.target.value || undefined })
            }
          >
            <option value="">No department</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Joining date" htmlFor="user-joining">
          <Input
            id="user-joining"
            type="date"
            value={form.joiningDate ?? ''}
            onChange={(event) => setForm({ ...form, joiningDate: event.target.value })}
          />
        </Field>

        <div className="sm:col-span-2">
          <Checkbox
            label="Email an invitation so they choose their own password"
            description="Recommended. Nobody else ever knows the password."
            checked={sendInvite}
            onChange={(event) => setSendInvite(event.target.checked)}
          />
        </div>

        {!sendInvite && (
          <Field
            label="Temporary password"
            htmlFor="user-password"
            required
            hint="At least 10 characters. Ask them to change it after signing in."
            className="sm:col-span-2"
          >
            <Input
              id="user-password"
              type="text"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
