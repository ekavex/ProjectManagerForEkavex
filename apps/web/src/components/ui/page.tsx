/** Page furniture: headers, tab bars, filter rows and pagination. */
import { cn } from '../../lib/cn.js';
import type { PageMeta } from '@ekavist/shared';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from './primitives.js';

export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small status chips shown beneath the title. */
  meta?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb != null && <div className="mb-1 text-[12px] text-ink-faint">{breadcrumb}</div>}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle != null && <p className="mt-0.5 text-[13px] text-ink-faint">{subtitle}</p>}
        {meta != null && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions != null && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export interface TabDefinition {
  to: string;
  label: string;
  /** Shown as a small count next to the label; omit rather than showing a zero. */
  count?: number;
  end?: boolean;
}

export function Tabs({ tabs }: { tabs: TabDefinition[] }) {
  return (
    <nav className="scroll-thin -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'relative -mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-faint hover:text-ink',
            )
          }
        >
          {tab.label}
          {tab.count != null && tab.count > 0 && (
            <span className="tabular ml-1.5 rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-ink-soft">
              {tab.count}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function Pagination({
  meta,
  onPageChange,
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
}) {
  if (meta.totalPages <= 1) return null;

  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="tabular text-[12px] text-ink-faint">
        {from}–{to} of {meta.total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          Previous
        </Button>
        <span className="tabular px-1 text-[12px] text-ink-soft">
          {meta.page} / {meta.totalPages}
        </span>
        <Button
          size="sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** A row of key/value facts, used on overview panels. */
export function FactList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const letters =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';

  return (
    <span
      title={name}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent',
        size === 'xs' && 'size-5 text-[9px]',
        size === 'sm' && 'size-6 text-[10px]',
        size === 'md' && 'size-8 text-[12px]',
        className,
      )}
    >
      {letters}
    </span>
  );
}

/** Overlapping avatars for an assignee list, with a "+2" when it overflows. */
export function AvatarGroup({ names, max = 3 }: { names: string[]; max?: number }) {
  if (names.length === 0) {
    return <span className="text-[12px] text-ink-faint">Unassigned</span>;
  }

  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((name) => (
        <Avatar key={name} name={name} size="sm" className="ring-2 ring-[var(--color-surface)]" />
      ))}
      {extra > 0 && (
        <span className="grid size-6 place-items-center rounded-full bg-canvas text-[10px] font-semibold text-ink-soft ring-2 ring-[var(--color-surface)]">
          +{extra}
        </span>
      )}
    </span>
  );
}
