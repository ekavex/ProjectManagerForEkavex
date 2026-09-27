/**
 * The application frame: navigation, the attendance widget, search and notifications.
 *
 * The attendance control sits in the header on every screen because starting and ending
 * work is the one action a person takes every day, and the spec is emphatic that it is a
 * separate act from signing in (spec section 27).
 */
import type { Notification } from '@ekavist/shared';
import { cn } from '../lib/cn.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Spinner } from '../components/ui/primitives.js';
import { useToast } from '../components/ui/overlays.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import { api } from '../lib/api.js';
import { formatMinutes, formatRelative, initials } from '../lib/format.js';
import { keys, useAttendanceToday, useNotifications, useSearch } from '../lib/queries.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Hidden unless the signed-in user holds this permission. */
  permission?: Parameters<ReturnType<typeof useAuth>['can']>[0];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes, or it covers the new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (user == null) return null;

  const navigation: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <IconGrid /> },
    { to: '/my-work', label: 'My work', icon: <IconCheck /> },
    { to: '/projects', label: 'Projects', icon: <IconFolder /> },
    { to: '/team', label: 'Team', icon: <IconUsers />, permission: 'user:read' },
    { to: '/attendance', label: 'Attendance', icon: <IconClock /> },
    { to: '/reports', label: 'Reports', icon: <IconChart /> },
    { to: '/notifications', label: 'Notifications', icon: <IconBell /> },
  ];

  const admin: NavItem[] = [
    { to: '/admin/users', label: 'People', icon: <IconUsers />, permission: 'user:create' },
    {
      to: '/admin/notifications',
      label: 'Notification rules',
      icon: <IconBell />,
      permission: 'org:notification-rules',
    },
    { to: '/admin/audit', label: 'Audit log', icon: <IconShield />, permission: 'audit:read' },
  ];

  const visibleAdmin = admin.filter((item) => item.permission == null || can(item.permission));

  return (
    <div className="min-h-screen lg:flex">
      {/* Backdrop for the mobile drawer. */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-[oklch(20%_0.02_255_/_0.4)] lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <div className="grid size-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-white">
            E
          </div>
          <span className="text-sm font-semibold tracking-tight">Ekavist</span>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto p-2">
          {navigation
            .filter((item) => item.permission == null || can(item.permission))
            .map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}

          {visibleAdmin.length > 0 && (
            <>
              <p className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                Administration
              </p>
              {visibleAdmin.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </>
          )}
        </nav>

        <UserMenu />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <button
            type="button"
            className="-ml-1 rounded p-1.5 text-ink-soft hover:bg-canvas lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            <IconMenu />
          </button>

          <GlobalSearch />
          <div className="flex-1" />
          <AttendanceWidget />
          <NotificationBell />
        </header>

        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
          isActive ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-canvas hover:text-ink',
        )
      }
    >
      <span className="shrink-0">{item.icon}</span>
      {item.label}
    </NavLink>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (user == null) return null;

  return (
    <div className="border-t border-line p-2">
      <Link
        to="/settings"
        className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-canvas"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
          {initials(user.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{user.fullName}</span>
          <span className="block truncate text-[11px] text-ink-faint">
            {user.designation ?? user.role.toLowerCase().replace(/_/g, ' ')}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => void signOut().then(() => navigate('/login'))}
        className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-[12px] text-ink-faint hover:bg-canvas hover:text-ink"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * Start work, take a break, end work.
 *
 * The button says what will happen, and the elapsed time updates as the day goes on so a
 * person can see their own hours without opening the attendance page.
 */
function AttendanceWidget() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useAttendanceToday();

  const act = useMutation({
    mutationFn: (path: string) => api.post(`/attendance/${path}`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.attendanceToday });
      void queryClient.invalidateQueries({ queryKey: keys.myDashboard });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'That did not work.');
    },
  });

  if (isLoading || data == null) {
    return <div className="hidden h-8 w-32 animate-pulse rounded-md bg-canvas sm:block" />;
  }

  if (!data.isWorking) {
    return (
      <Button
        size="sm"
        variant="primary"
        loading={act.isPending}
        onClick={() => act.mutate('start-work')}
      >
        Start work
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden items-center gap-1.5 rounded-md bg-canvas px-2.5 py-1.5 sm:inline-flex">
        <span
          className={cn('size-2 rounded-full', data.isOnBreak ? 'bg-warn' : 'bg-ok animate-pulse')}
          aria-hidden="true"
        />
        <span className="tabular text-[12px] font-medium text-ink">
          {formatMinutes(data.workMinutes)}
        </span>
        {data.isOnBreak && <span className="text-[11px] text-ink-faint">on break</span>}
      </span>

      {data.isOnBreak ? (
        <Button size="sm" loading={act.isPending} onClick={() => act.mutate('break/end')}>
          End break
        </Button>
      ) : (
        <Button size="sm" loading={act.isPending} onClick={() => act.mutate('break/start')}>
          Break
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        loading={act.isPending}
        onClick={() => act.mutate('end-work')}
      >
        End work
      </Button>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data } = useNotifications({ page: 1, pageSize: 8 });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md p-2 text-ink-soft hover:bg-canvas hover:text-ink"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            <Link to="/notifications" className="text-[12px] text-accent hover:underline">
              See all
            </Link>
          </div>
          <div className="scroll-thin max-h-80 overflow-y-auto">
            {data == null ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : data.data.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-ink-faint">
                Nothing yet. You will hear about task assignments, deadlines and mentions here.
              </p>
            ) : (
              data.data.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onOpen={() => {
                    if (notification.readAt == null) markRead.mutate(notification.id);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start gap-2">
        {notification.readAt == null && (
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        )}
        <div className={cn('min-w-0', notification.readAt != null && 'pl-3.5')}>
          <p className="truncate text-[13px] font-medium text-ink">{notification.title}</p>
          <p className="line-clamp-2 text-[12px] text-ink-faint">{notification.body}</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {formatRelative(notification.createdAt)}
          </p>
        </div>
      </div>
    </>
  );

  return notification.link != null ? (
    <Link
      to={notification.link}
      onClick={onOpen}
      className="block border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-canvas"
    >
      {body}
    </Link>
  ) : (
    <div className="border-b border-line px-3 py-2.5 last:border-b-0">{body}</div>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useSearch(term);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative w-full max-w-md" ref={containerRef}>
      <input
        type="search"
        value={term}
        placeholder="Search projects, tasks, people…"
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface"
      />

      {open && term.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
          {isFetching && data == null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : data == null || data.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-ink-faint">
              Nothing matched “{term}”.
            </p>
          ) : (
            <div className="scroll-thin max-h-80 overflow-y-auto py-1">
              {data.map((hit) => (
                <Link
                  key={`${hit.type}-${hit.id}`}
                  to={hit.link}
                  onClick={() => {
                    setOpen(false);
                    setTerm('');
                  }}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-canvas"
                >
                  <Badge tone="neutral">{hit.type.toLowerCase().replace(/_/g, ' ')}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{hit.title}</span>
                    {hit.subtitle != null && (
                      <span className="block truncate text-[11px] text-ink-faint">
                        {hit.subtitle}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- icons

const strokeProps = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

function IconGrid() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" {...strokeProps} />
      <rect x="14" y="3" width="7" height="7" rx="1.5" {...strokeProps} />
      <rect x="3" y="14" width="7" height="7" rx="1.5" {...strokeProps} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" {...strokeProps} />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12.5l4.5 4.5L20 6" {...strokeProps} />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        {...strokeProps}
      />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" {...strokeProps} />
      <path d="M3 19.5c0-3 2.7-5 6-5s6 2 6 5" {...strokeProps} />
      <path d="M16 5.5a3 3 0 0 1 0 6M17.5 14.8c2 .7 3.5 2.4 3.5 4.7" {...strokeProps} />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" {...strokeProps} />
      <path d="M12 7.5V12l3 2" {...strokeProps} />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...strokeProps} />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" {...strokeProps} />
      <path d="M10.5 19a2 2 0 0 0 3 0" {...strokeProps} />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" {...strokeProps} />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" {...strokeProps} />
    </svg>
  );
}
