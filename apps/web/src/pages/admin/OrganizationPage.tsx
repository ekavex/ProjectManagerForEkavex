/**
 * Organisation settings (spec section 6.1): the working day that attendance is measured
 * against, the yearly leave allowance, and public holidays, which attendance, leave and
 * capacity planning all skip.
 */
import type { OrganizationSettings, UpdateOrganizationInput } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useConfirm, useToast } from '../../components/ui/overlays.js';
import { PageHeader } from '../../components/ui/page.js';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError, api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { keys, useHolidays, useOrganization } from '../../lib/queries.js';

export function OrganizationPage() {
  const { can } = useAuth();
  const { data, isLoading } = useOrganization();

  if (!can('org:settings')) {
    return (
      <div className="card">
        <EmptyState
          title="Administrators only"
          description="Organisation settings are managed by administrators."
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Organisation"
        subtitle="The working day, the leave allowance and public holidays."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading || data == null ? (
          <div className="card">
            <LoadingState />
          </div>
        ) : (
          <SettingsForm key={JSON.stringify(data)} settings={data} />
        )}
        <HolidaysCard />
      </div>
    </>
  );
}

function SettingsForm({ settings }: { settings: OrganizationSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const set = (patch: Partial<OrganizationSettings>): void => setForm({ ...form, ...patch });

  const save = useMutation({
    mutationFn: (input: UpdateOrganizationInput) => api.patch('/organization', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.organization });
      toast.success('Organisation settings saved.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the settings.'),
  });
  const fieldError = (path: string) =>
    save.error instanceof ApiError ? save.error.fieldError(path) : undefined;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate(form);
  };

  const number = (value: string): number => Number(value) || 0;

  return (
    <Card title="Settings">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation name" htmlFor="org-name" className="sm:col-span-2">
          <Input
            id="org-name"
            required
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field
          label="Time zone"
          htmlFor="org-timezone"
          hint="An IANA name, e.g. Asia/Kolkata."
          error={fieldError('timezone')}
        >
          <Input
            id="org-timezone"
            value={form.timezone}
            onChange={(event) => set({ timezone: event.target.value })}
          />
        </Field>
        <Field label="Working day starts" htmlFor="org-start" error={fieldError('workdayStart')}>
          <Input
            id="org-start"
            type="time"
            value={form.workdayStart}
            onChange={(event) => set({ workdayStart: event.target.value })}
          />
        </Field>
        <Field
          label="Late after"
          htmlFor="org-late"
          hint="Starting work later than this marks the day late."
          error={fieldError('lateAfter')}
        >
          <Input
            id="org-late"
            type="time"
            value={form.lateAfter}
            onChange={(event) => set({ lateAfter: event.target.value })}
          />
        </Field>
        <Field
          label="Full day (minutes)"
          htmlFor="org-full"
          hint="Also the hours per day used for capacity."
          error={fieldError('fullDayMinutes')}
        >
          <Input
            id="org-full"
            type="number"
            min={60}
            max={1440}
            value={form.fullDayMinutes}
            onChange={(event) => set({ fullDayMinutes: number(event.target.value) })}
          />
        </Field>
        <Field
          label="Half day below (minutes)"
          htmlFor="org-half"
          error={fieldError('halfDayMinutes')}
        >
          <Input
            id="org-half"
            type="number"
            min={30}
            max={720}
            value={form.halfDayMinutes}
            onChange={(event) => set({ halfDayMinutes: number(event.target.value) })}
          />
        </Field>
        <p className="text-[12px] font-semibold tracking-wide text-ink-faint uppercase sm:col-span-2">
          Leave allowance per year (days)
        </p>
        <Field label="Annual" htmlFor="org-annual">
          <Input
            id="org-annual"
            type="number"
            min={0}
            max={365}
            value={form.annualLeaveDays}
            onChange={(event) => set({ annualLeaveDays: number(event.target.value) })}
          />
        </Field>
        <Field label="Sick" htmlFor="org-sick">
          <Input
            id="org-sick"
            type="number"
            min={0}
            max={365}
            value={form.sickLeaveDays}
            onChange={(event) => set({ sickLeaveDays: number(event.target.value) })}
          />
        </Field>
        <Field label="Casual" htmlFor="org-casual">
          <Input
            id="org-casual"
            type="number"
            min={0}
            max={365}
            value={form.casualLeaveDays}
            onChange={(event) => set({ casualLeaveDays: number(event.target.value) })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

function HolidaysCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [year, setYear] = useState(new Date().getFullYear());
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const { data, isLoading } = useHolidays(year);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['organization', 'holidays'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  };

  const add = useMutation({
    mutationFn: () => api.post('/organization/holidays', { date, name: name.trim() }),
    onSuccess: () => {
      setDate('');
      setName('');
      invalidate();
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add the holiday.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organization/holidays/${id}`),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not remove the holiday.'),
  });

  return (
    <Card
      title="Public holidays"
      description="Skipped by attendance, leave and capacity."
      action={
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setYear(year - 1)}
            aria-label="Previous year"
          >
            ←
          </Button>
          <span className="tabular text-[13px] font-medium">{year}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setYear(year + 1)}
            aria-label="Next year"
          >
            →
          </Button>
        </div>
      }
      bodyClassName="p-0"
    >
      {isLoading ? (
        <LoadingState />
      ) : data == null || data.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-faint">
          No holidays recorded for {year}.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Holiday</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((holiday) => (
              <tr key={holiday.id}>
                <Td className="tabular w-36">{formatDate(holiday.date)}</Td>
                <Td>{holiday.name}</Td>
                <Td align="right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void confirm({
                        title: `Remove ${holiday.name}?`,
                        message: 'It will count as a working day again.',
                        confirmLabel: 'Remove',
                        tone: 'danger',
                      }).then((ok) => {
                        if (ok) remove.mutate(holiday.id);
                      });
                    }}
                  >
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <form
        className="grid gap-3 border-t border-line p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Date" htmlFor="holiday-date">
          <Input
            id="holiday-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="Name" htmlFor="holiday-name">
          <Input
            id="holiday-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Add
        </Button>
      </form>
    </Card>
  );
}
