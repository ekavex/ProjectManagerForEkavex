/**
 * Project chat (spec sections 31 to 35).
 *
 * Search and the filters are handled by the server: the browser never holds the whole
 * history and never filters it client-side. Pinned messages have their own panel, because
 * the spec is explicit that the important things should be findable without scrolling.
 */
import type { Message, MessageFilter, ProjectDetail } from '@ekavist/shared';
import { MESSAGE_FILTERS } from '@ekavist/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/cn.js';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/ui/overlays.js';
import { Avatar, Pagination } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import { useAuth } from '../../features/auth/AuthProvider.js';
import { ApiError, api } from '../../lib/api.js';
import { formatRelative, humanise } from '../../lib/format.js';
import { useMembers, useMessages, usePinnedMessages } from '../../lib/queries.js';

const REACTIONS = ['👍', '🎉', '👀', '✅'];

export function ChatTab({ project }: { project: ProjectDetail }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MessageFilter>('ALL');
  const [userId, setUserId] = useState('');

  const { data: members } = useMembers(project.id);
  const { data: pinned } = usePinnedMessages(project.id);
  const { data, isLoading, isError, error, refetch } = useMessages(project.id, {
    page,
    pageSize: 25,
    search: search.trim() === '' ? undefined : search.trim(),
    filter,
    userId: userId === '' ? undefined : userId,
  });

  const canPost = project.capabilities.includes('chat:post');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search this conversation"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="w-56"
          />
          <Select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as MessageFilter);
              setPage(1);
            }}
            className="w-40"
            aria-label="Filter messages"
          >
            {MESSAGE_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === 'ALL' ? 'Everything' : humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label="Filter by person"
          >
            <option value="">Anyone</option>
            {(members ?? []).map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.fullName}
              </option>
            ))}
          </Select>
        </div>

        {canPost && <Composer project={project} />}

        <Card bodyClassName="p-0">
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : data == null || data.data.length === 0 ? (
            <EmptyState
              title={search.trim() !== '' ? 'Nothing matched' : 'No messages yet'}
              description={
                search.trim() !== ''
                  ? 'Try a different word, or clear the filter.'
                  : 'Discussion about this project lives here, and stays searchable.'
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-line)]">
                {data.data.map((message) => (
                  <MessageRow key={message.id} project={project} message={message} />
                ))}
              </ul>
              <Pagination meta={data.meta} onPageChange={setPage} />
            </>
          )}
        </Card>
      </div>

      <Card title="Pinned" description="The things worth finding again">
        {pinned == null || pinned.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-faint">
            Nothing pinned yet. Pin decisions, links and instructions.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pinned.map((message) => (
              <li key={message.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                <p className="text-[12px] font-medium text-ink">{message.author.fullName}</p>
                <p className="line-clamp-3 text-[12px] text-ink-soft">{message.body}</p>
                {message.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 block truncate text-[12px] text-accent hover:underline"
                  >
                    {attachment.name}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Composer({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/messages`, {
        body,
        links: link.trim() === '' ? [] : [{ url: link.trim() }],
      }),
    onSuccess: () => {
      setBody('');
      setLink('');
      setShowLink(false);
      void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'messages'] });
    },
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Your message was not sent.'),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (body.trim() === '' && link.trim() === '') return;
    send.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="card p-3">
      <Textarea
        rows={2}
        value={body}
        placeholder="Write a message…"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter makes a new line — what people expect from a chat.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit(event);
          }
        }}
      />

      {showLink && (
        <Input
          type="url"
          value={link}
          placeholder="https://… (Google Drive links are labelled automatically)"
          onChange={(event) => setLink(event.target.value)}
          className="mt-2"
        />
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setShowLink((value) => !value)}>
          {showLink ? 'Remove link' : 'Attach a link'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          loading={send.isPending}
          disabled={body.trim() === '' && link.trim() === ''}
        >
          Send
        </Button>
      </div>
    </form>
  );
}

function MessageRow({ project, message }: { project: ProjectDetail; message: Message }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'messages'] });
  };

  const react = useMutation({
    mutationFn: ({ emoji, remove }: { emoji: string; remove: boolean }) =>
      remove
        ? api.delete(`/projects/${project.id}/messages/${message.id}/reactions`, { emoji })
        : api.post(`/projects/${project.id}/messages/${message.id}/reactions`, { emoji }),
    onSuccess: invalidate,
  });

  const pin = useMutation({
    mutationFn: (pinned: boolean) =>
      pinned
        ? api.delete(`/projects/${project.id}/messages/${message.id}/pin`)
        : api.post(`/projects/${project.id}/messages/${message.id}/pin`),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'That did not work.'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${project.id}/messages/${message.id}`),
    onSuccess: invalidate,
    onError: (cause: unknown) =>
      toast.error(cause instanceof ApiError ? cause.message : 'Could not delete the message.'),
  });

  const isMine = message.author.id === user?.id;
  const canPost = project.capabilities.includes('chat:post');
  const canPin = project.capabilities.includes('chat:pin');

  return (
    <li className="group px-4 py-3">
      <div className="flex gap-2.5">
        <Avatar name={message.author.fullName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[12px]">
            <span className="font-medium text-ink">{message.author.fullName}</span>
            <span className="text-ink-faint">{formatRelative(message.createdAt)}</span>
            {message.editedAt != null && <span className="text-ink-faint">· edited</span>}
            {message.isPinned && <Badge tone="accent">Pinned</Badge>}
          </p>

          {message.body !== '' && (
            <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink">{message.body}</p>
          )}

          {message.attachments.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {message.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
                  >
                    <Badge tone="neutral">
                      {attachment.kind === 'GOOGLE_DRIVE' ? 'Drive' : humanise(attachment.kind)}
                    </Badge>
                    <span className="truncate">{attachment.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {message.reactions.map((reaction) => {
              const mine = user != null && reaction.userIds.includes(user.id);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  disabled={!canPost}
                  onClick={() => react.mutate({ emoji: reaction.emoji, remove: mine })}
                  className={cn(
                    'rounded-full border px-1.5 py-0.5 text-[11px]',
                    mine
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line-strong text-ink-soft hover:bg-canvas',
                  )}
                >
                  {reaction.emoji} {reaction.count}
                </button>
              );
            })}

            {canPost && (
              <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`React with ${emoji}`}
                    onClick={() => react.mutate({ emoji, remove: false })}
                    className="rounded px-1 text-[12px] hover:bg-canvas"
                  >
                    {emoji}
                  </button>
                ))}
                {canPin && (
                  <button
                    type="button"
                    onClick={() => pin.mutate(message.isPinned)}
                    className="rounded px-1.5 text-[11px] text-ink-faint hover:bg-canvas hover:text-ink"
                  >
                    {message.isPinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                {(isMine || project.capabilities.includes('chat:delete-any')) && (
                  <button
                    type="button"
                    onClick={() => remove.mutate()}
                    className="rounded px-1.5 text-[11px] text-ink-faint hover:bg-canvas hover:text-danger"
                  >
                    Delete
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
