/**
 * Leave (spec section 86): request time off, see the balance, and — for managers and
 * leave administrators — decide what others have asked for. Each request shows the open
 * tasks that fall due while the person is away, so the impact on the schedule is visible
 * before anyone says yes.
 */
import type { CreateLeaveInput, LeaveRequest, LeaveStatus, LeaveType } from '@ekavist/shared';
import { LEAVE_TYPES } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal, useConfirm, useToast } from '../components/ui/overlays.js';
import { Avatar, PageHeader, Pagination } from '../components/ui/page.js';
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
  Stat,
  Textarea,
} from '../components/ui/primitives.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import { ApiError, api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { formatDate, formatRelative, humanise } from '../lib/format.js';
import { useLeave, useLeaveBalance } from '../lib/queries.js';

const STATUS_TONE: Record<LeaveStatus, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

type Scope = 'mine' | 'review' | 'all';

export function LeavePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = (params.get('tab') as Scope | null) ?? 'mine';
  const [requesting, setRequesting] = useState(false);

  const tabs: { key: Scope; label: string }[] = [
    { key: 'mine', label: 'My leave' },
    { key: 'review', label: 'To review' },
    ...(can('leave:manage') ? [{ key: 'all' as const, label: 'Everyone' }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Time off, your balance, and the requests waiting on you."
        actions={
          <Button variant="primary" onClick={() => setRequesting(true)}>
            Request leave
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={scope === tab.key}
            onClick={() => setParams(tab.key === 'mine' ? {} : { tab: tab.key })}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium',
              scope === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {scope === 'mine' && <BalanceRow />}
      <RequestList key={scope} scope={scope} />

      <RequestModal open={requesting} onClose={() => setRequesting(false)} />
    </>
  );
}

function BalanceRow() {
  const year = new Date().getFullYear();
  const { data } = useLeaveBalance({ year });
  if (data == null) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {data.rows.map((row) => (
        <Stat
          key={row.type}
          label={`${humanise(row.type)} ${year}`}
          value={row.remaining == null ? `${row.used} used` : `${row.remaining} left`}
          hint={
            row.allowance == null
              ? row.pending > 0
                ? `${row.pending} pending`
                : 'Not counted against an allowance'
              : `${row.used} used · ${row.pending} pending of ${row.allowance}`
          }
          tone={row.remaining != null && row.remaining <= 0 ? 'warn' : undefined}
        />
      ))}
    </div>
  );
}

function RequestList({ scope }: { scope: Scope }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LeaveStatus | ''>(scope === 'review' ? 'PENDING' : '');
  const { data, isLoading, isError, error, refetch } = useLeave({
    scope,
    page,
    pageSize: 20,
    status: status === '' ? undefined : status,
  });

  return (
    <Card
      title={scope === 'mine' ? 'My requests' : scope === 'review' ? 'Waiting on you' : 'All leave'}
      action={
        <Select
          aria-label="Filter by status"
          className="h-8 w-36"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as LeaveStatus | '');
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </Select>
      }
      bodyClassName="p-0"
    >
      {isLoading ? (
        <LoadingState />
      ) : isError || data == null ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          title={scope === 'review' ? 'Nothing to decide' : 'No leave here'}
          description={
            scope === 'review'
              ? 'Requests from people you manage will appear here.'
              : 'Requested and approved leave will be listed here.'
          }
        />
      ) : (
        <>
          <ul>
            {data.data.map((request) => (
              <RequestItem key={request.id} request={request} showPerson={scope !== 'mine'} />
            ))}
          </ul>
          <Pagination meta={data.meta} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

function RequestItem({ request, showPerson }: { request: LeaveRequest; showPerson: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [note, setNote] = useState('');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['leave'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api.post(`/leave/${request.id}/decide`, {
        approve,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      }),
    onSuccess: (_data, approve) => {
      invalidate();
      toast.success(approve ? 'Leave approved.' : 'Leave declined.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not record the decision.'),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/leave/${request.id}/cancel`),
    onSuccess: () => {
      invalidate();
      toast.success('Request withdrawn.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not withdraw the request.'),
  });

  const mine = request.user.id === user?.id;
  const today = new Date().toISOString().slice(0, 10);
  const cancellable =
    mine &&
    (request.status === 'PENDING' || (request.status === 'APPROVED' && request.startDate > today));

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {showPerson && (
          <span className="flex items-center gap-2">
            <Avatar name={request.user.fullName} size="sm" />
            <span className="text-[13px] font-medium text-ink">{request.user.fullName}</span>
          </span>
        )}
        <Badge tone="neutral">{humanise(request.type)}</Badge>
        <span className="text-[13px] text-ink">
          {formatDate(request.startDate)}
          {request.endDate !== request.startDate && ` – ${formatDate(request.endDate)}`}
        </span>
        <span className="tabular text-[12px] text-ink-faint">
          {request.days} day{request.days === 1 ? '' : 's'}
          {request.halfDay && ' (half day)'}
        </span>
        <span className="flex-1" />
        <Badge tone={STATUS_TONE[request.status]}>{humanise(request.status)}</Badge>
      </div>

      {request.reason != null && (
        <p className="mt-1.5 text-[13px] text-ink-soft">{request.reason}</p>
      )}
      {request.approver != null && request.decidedAt != null && (
        <p className="mt-1 text-[12px] text-ink-faint">
          {humanise(request.status)} by {request.approver.fullName}{' '}
          {formatRelative(request.decidedAt)}
          {request.decisionNote != null && `: ${request.decisionNote}`}
        </p>
      )}

      {request.affectedTasks.length > 0 && (
        <div className="mt-2 rounded-md border border-warn bg-warn-soft px-3 py-2 text-[12px]">
          <p className="font-medium text-[oklch(42%_0.11_70)]">
            {request.affectedTasks.length} open task
            {request.affectedTasks.length === 1 ? ' falls' : 's fall'} due during this leave:
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {request.affectedTasks.map((task) => (
              <li key={task.id}>
                <Link
                  to={`/projects/${task.projectId}/tasks/${task.id}`}
                  className="text-accent hover:underline"
                >
                  {task.reference} {task.name}
                </Link>{' '}
                <span className="text-ink-faint">({formatDate(task.dueDate)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {request.canDecide && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input
            aria-label="Note to the requester"
            placeholder="Note (optional)"
            className="max-w-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            loading={decide.isPending && decide.variables}
            onClick={() => decide.mutate(true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            loading={decide.isPending && !decide.variables}
            onClick={() => decide.mutate(false)}
          >
            Decline
          </Button>
        </div>
      )}

      {cancellable && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            loading={cancel.isPending}
            onClick={() => {
              void confirm({
                title: 'Withdraw this request?',
                message:
                  request.status === 'APPROVED'
                    ? 'The approved days return to your balance and come off the calendar.'
                    : 'Nobody will need to decide it any more.',
                confirmLabel: 'Withdraw',
              }).then((ok) => {
                if (ok) cancel.mutate();
              });
            }}
          >
            Withdraw
          </Button>
        </div>
      )}
    </li>
  );
}

function RequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Partial<CreateLeaveInput>>({ type: 'ANNUAL', halfDay: false });
  const [error, setError] = useState<ApiError | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<LeaveRequest>('/leave', {
        ...form,
        endDate: form.halfDay === true ? form.startDate : form.endDate,
      }),
    onSuccess: (request) => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      toast.success(
        request.affectedTasks.length > 0
          ? `Requested. ${request.affectedTasks.length} of your tasks fall due while you are away.`
          : 'Requested. Your manager has been told.',
      );
      setForm({ type: 'ANNUAL', halfDay: false });
      onClose();
    },
    onError: (cause: unknown) => setError(cause instanceof ApiError ? cause : null),
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
      title="Request leave"
      description="Weekends and public holidays are not counted."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="leave-form" loading={create.isPending}>
            Send request
          </Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {error != null && (
          <div
            className="rounded-md border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger sm:col-span-2"
            role="alert"
          >
            {error.message}
          </div>
        )}
        <Field label="Type" htmlFor="leave-type" className="sm:col-span-2">
          <Select
            id="leave-type"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value as LeaveType })}
          >
            {LEAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanise(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="First day"
          htmlFor="leave-start"
          required
          error={error?.fieldError('startDate')}
        >
          <Input
            id="leave-start"
            type="date"
            required
            value={form.startDate ?? ''}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </Field>
        <Field label="Last day" htmlFor="leave-end" required error={error?.fieldError('endDate')}>
          <Input
            id="leave-end"
            type="date"
            required={form.halfDay !== true}
            disabled={form.halfDay === true}
            value={form.halfDay === true ? (form.startDate ?? '') : (form.endDate ?? '')}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label="Half a day"
            description="Counts as 0.5 days; the rest of the day stays open for work."
            checked={form.halfDay === true}
            onChange={(event) => setForm({ ...form, halfDay: event.target.checked })}
          />
        </div>
        <Field label="Reason" htmlFor="leave-reason" className="sm:col-span-2">
          <Textarea
            id="leave-reason"
            rows={3}
            value={form.reason ?? ''}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
