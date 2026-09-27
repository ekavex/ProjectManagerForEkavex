/**
 * Deadline notification rules (spec section 41).
 *
 * The rules live in the database and the scheduler reads them, so changing "three days
 * before" here changes the behaviour without a deploy. A negative offset means days
 * *after* the due date, which is the overdue escalation ladder.
 */
import type { NotificationRule } from '@ekavist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../../components/ui/overlays.js';
import { PageHeader } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError, api } from '../../lib/api.js';
import { humanise } from '../../lib/format.js';
import { keys } from '../../lib/queries.js';

export function NotificationRulesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Map<string, Partial<NotificationRule>>>(new Map());

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.notificationRules,
    queryFn: async () => (await api.get<{ data: NotificationRule[] }>('/notifications/rules')).data,
    enabled: can('org:notification-rules'),
  });

  const save = useMutation({
    mutationFn: (rules: NotificationRule[]) =>
      api.patch('/notifications/rules', {
        rules: rules.map((rule) => ({
          type: rule.type,
          offsetDays: rule.offsetDays,
          enabled: rule.enabled,
          emailEnabled: rule.emailEnabled,
          notifyLead: rule.notifyLead,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notificationRules });
      setDraft(new Map());
      toast.success('Rules saved.');
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save the rules.'),
  });

  if (!can('org:notification-rules')) {
    return (
      <div className="card">
        <EmptyState
          title="Administrators only"
          description="Notification rules apply to the whole organisation."
        />
      </div>
    );
  }

  const merged = (data ?? []).map((rule) => ({ ...rule, ...(draft.get(rule.id) ?? {}) }));

  const update = (id: string, patch: Partial<NotificationRule>): void => {
    setDraft((previous) => new Map(previous).set(id, { ...(previous.get(id) ?? {}), ...patch }));
  };

  const describeOffset = (offsetDays: number): string => {
    if (offsetDays > 0) return `${offsetDays} day${offsetDays === 1 ? '' : 's'} before it is due`;
    if (offsetDays === 0) return 'On the due date';
    const days = Math.abs(offsetDays);
    return `${days} day${days === 1 ? '' : 's'} after it was due`;
  };

  return (
    <>
      <PageHeader
        title="Notification rules"
        subtitle="When Ekavist reminds people about deadlines, and who else hears about it."
        actions={
          draft.size > 0 ? (
            <div className="flex gap-2">
              <Button onClick={() => setDraft(new Map())}>Discard</Button>
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() => save.mutate(merged)}
              >
                Save changes
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : merged.length === 0 ? (
          <EmptyState title="No rules configured" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>When</Th>
                <Th align="center">On</Th>
                <Th align="center">Also email</Th>
                <Th align="center">Tell the lead</Th>
              </tr>
            </thead>
            <tbody>
              {merged.map((rule) => (
                <tr key={rule.id} className="hover:bg-canvas">
                  <Td>
                    <Badge tone="neutral">{humanise(rule.type)}</Badge>
                  </Td>
                  <Td>
                    <span className="text-[13px]">{describeOffset(rule.offsetDays)}</span>
                  </Td>
                  <Td align="center">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label={`Enable ${humanise(rule.type)} ${describeOffset(rule.offsetDays)}`}
                      onChange={(event) => update(rule.id, { enabled: event.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </Td>
                  <Td align="center">
                    <input
                      type="checkbox"
                      checked={rule.emailEnabled}
                      disabled={!rule.enabled}
                      aria-label={`Email for ${humanise(rule.type)}`}
                      onChange={(event) => update(rule.id, { emailEnabled: event.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </Td>
                  <Td align="center">
                    <input
                      type="checkbox"
                      checked={rule.notifyLead}
                      disabled={!rule.enabled}
                      aria-label={`Notify the lead for ${humanise(rule.type)}`}
                      onChange={(event) => update(rule.id, { notifyLead: event.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="card mt-4 px-4 py-3 text-[13px] text-ink-soft">
        <p className="mb-1 font-medium text-ink">How these are applied</p>
        <p>
          A scan runs once each morning in the organisation's timezone. Each rule produces at most
          one reminder per person, per task, per day, so a restart or a repeated run never sends the
          same reminder twice. Individuals can still turn any email off for themselves under
          Settings.
        </p>
      </div>
    </>
  );
}
