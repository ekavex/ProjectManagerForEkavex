/**
 * The audit log (spec sections 54 and 89).
 *
 * Append-only: who did what, when, and what the value was before and after. There is no
 * edit or delete here by design — a log that can be changed is not evidence.
 */
import type { AuditEntry, Paginated } from '@ekavist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar, FilterBar, PageHeader, Pagination } from '../../components/ui/page.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { keys } from '../../lib/queries.js';

export function AuditPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = {
    page,
    pageSize: 50,
    action: action.trim() === '' ? undefined : action.trim(),
    from: from === '' ? undefined : from,
    to: to === '' ? undefined : to,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.audit(params),
    queryFn: () => api.get<Paginated<AuditEntry>>('/audit', params),
    enabled: can('audit:read'),
  });

  if (!can('audit:read')) {
    return (
      <div className="card">
        <EmptyState
          title="Administrators only"
          description="The audit log contains organisation-wide activity."
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every important action, with the value before and after. Append-only."
      />

      <FilterBar>
        <Input
          type="search"
          placeholder="Filter by action, e.g. task.status"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <Input
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="From"
        />
        <span className="text-[13px] text-ink-faint">to</span>
        <Input
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="To"
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState title="Nothing recorded for this filter" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Change</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((entry) => {
                  const isOpen = expanded === entry.id;
                  const hasDetail = entry.oldValue != null || entry.newValue != null;

                  return (
                    <tr key={entry.id} className="hover:bg-canvas">
                      <Td>
                        <span className="tabular text-[12px] whitespace-nowrap">
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        {entry.actor == null ? (
                          <span className="text-[12px] text-ink-faint">System</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Avatar name={entry.actor.fullName} size="xs" />
                            <span className="truncate text-[13px]">{entry.actor.fullName}</span>
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone="neutral">{entry.action}</Badge>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-ink-soft">
                          {entry.entityType}
                          <span className="block truncate text-[11px] text-ink-faint">
                            {entry.entityId}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        {!hasDetail ? (
                          <span className="text-[12px] text-ink-faint">—</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpanded(isOpen ? null : entry.id)}
                              className="text-[12px] text-accent hover:underline"
                            >
                              {isOpen ? 'Hide' : 'Show'}
                            </button>
                            {isOpen && (
                              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                                <pre className="scroll-thin max-h-40 overflow-auto rounded bg-canvas p-2 text-[11px] text-ink-soft">
                                  {JSON.stringify(entry.oldValue ?? null, null, 1)}
                                </pre>
                                <pre className="scroll-thin max-h-40 overflow-auto rounded bg-canvas p-2 text-[11px] text-ink">
                                  {JSON.stringify(entry.newValue ?? null, null, 1)}
                                </pre>
                              </div>
                            )}
                          </>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
