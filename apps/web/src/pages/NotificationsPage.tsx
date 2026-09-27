import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, Pagination } from '../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../components/ui/primitives.js';
import { api } from '../lib/api.js';
import { formatRelative, humanise } from '../lib/format.js';
import { useNotifications } from '../lib/queries.js';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError, error, refetch } = useNotifications({
    page,
    pageSize: 30,
    unreadOnly: unreadOnly ? true : undefined,
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Task assignments, deadlines, mentions and approvals."
        actions={
          (data?.unreadCount ?? 0) > 0 ? (
            <Button loading={markAll.isPending} onClick={() => markAll.mutate()}>
              Mark all as read
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
            className="size-4 accent-[var(--color-accent)]"
          />
          Unread only
        </label>
        {data != null && (
          <span className="text-[12px] text-ink-faint">
            {data.unreadCount} unread of {data.meta.total}
          </span>
        )}
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.data.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
            description="You will hear about task assignments, approaching deadlines, mentions and approvals."
          />
        ) : (
          <>
            <ul className="divide-y divide-[var(--color-line)]">
              {data.data.map((notification) => {
                const content = (
                  <span className="flex items-start gap-3">
                    <span
                      className={
                        notification.readAt == null
                          ? 'mt-1.5 size-2 shrink-0 rounded-full bg-accent'
                          : 'mt-1.5 size-2 shrink-0 rounded-full bg-transparent'
                      }
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-ink">
                          {notification.title}
                        </span>
                        <Badge tone="neutral">{humanise(notification.type)}</Badge>
                        {notification.project != null && (
                          <Badge tone="accent">{notification.project.code}</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-ink-soft">
                        {notification.body}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {formatRelative(notification.createdAt)}
                      </span>
                    </span>
                  </span>
                );

                return (
                  <li key={notification.id}>
                    {notification.link != null ? (
                      <Link
                        to={notification.link}
                        onClick={() => {
                          if (notification.readAt == null) markOne.mutate(notification.id);
                        }}
                        className="block px-4 py-3 hover:bg-canvas"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
