/**
 * The calendar (spec section 85): task deadlines, milestones, phase dates, approved leave
 * and public holidays for everything the person can see, a month at a time. On a phone the
 * month grid is replaced by an agenda list, which is readable at that width.
 */
import type { CalendarEvent, CalendarEventKind } from '@ekavist/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/page.js';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
} from '../components/ui/primitives.js';
import { cn } from '../lib/cn.js';
import { formatDate } from '../lib/format.js';
import { useCalendar, useProjects } from '../lib/queries.js';

const KIND_STYLE: Record<CalendarEventKind, { label: string; chip: string; dot: string }> = {
  TASK_DUE: { label: 'Task due', chip: 'bg-accent-soft text-accent', dot: 'bg-accent' },
  MILESTONE: { label: 'Milestone', chip: 'bg-info-soft text-info', dot: 'bg-info' },
  PHASE_START: { label: 'Phase starts', chip: 'bg-canvas text-ink-soft', dot: 'bg-ink-faint' },
  PHASE_END: { label: 'Phase ends', chip: 'bg-canvas text-ink-soft', dot: 'bg-ink-faint' },
  LEAVE: { label: 'Leave', chip: 'bg-warn-soft text-[oklch(42%_0.11_70)]', dot: 'bg-warn' },
  HOLIDAY: { label: 'Holiday', chip: 'bg-ok-soft text-ok', dot: 'bg-ok' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month, day));

/** The six-week grid that contains a month, Monday first. */
function monthGrid(year: number, month: number): string[] {
  const first = utc(year, month, 1);
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => iso(utc(year, month, 1 - offset + index)));
}

export function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [mine, setMine] = useState(false);
  const [projectId, setProjectId] = useState('');
  const { data: projects } = useProjects({ page: 1, pageSize: 100 });

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const { data, isLoading, isError, error, refetch } = useCalendar({
    from: days[0],
    to: days[days.length - 1],
    mine: mine ? true : undefined,
    projectId: projectId === '' ? undefined : projectId,
  });

  // Multi-day events (leave) appear on every day they cover.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data ?? []) {
      const end = event.endDate ?? event.date;
      for (const day of days) {
        if (day < event.date || day > end) continue;
        map.set(day, [...(map.get(day) ?? []), event]);
      }
    }
    return map;
  }, [data, days]);

  const monthLabel = utc(cursor.year, cursor.month, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const today = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const inMonth = (day: string): boolean => Number(day.slice(5, 7)) - 1 === cursor.month;
  const shift = (delta: number): void => {
    const next = utc(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Deadlines, milestones, phase dates, leave and holidays."
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => shift(-1)} aria-label="Previous month">
              ←
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
            >
              Today
            </Button>
            <Button size="sm" onClick={() => shift(1)} aria-label="Next month">
              →
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-ink">{monthLabel}</h2>
        <span className="flex-1" />
        <Select
          aria-label="Project"
          className="h-8 w-56"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">All my projects</option>
          {(projects?.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} {project.name}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Only mine"
          checked={mine}
          onChange={(event) => setMine(event.target.checked)}
        />
      </div>

      {isLoading ? (
        <div className="card">
          <LoadingState />
        </div>
      ) : isError ? (
        <div className="card">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : (
        <>
          <div className="card hidden overflow-hidden md:block">
            <div className="grid grid-cols-7 border-b border-line bg-canvas">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const events = byDay.get(day) ?? [];
                const holiday = events.some((event) => event.kind === 'HOLIDAY');
                return (
                  <div
                    key={day}
                    className={cn(
                      'min-h-28 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0',
                      !inMonth(day) && 'bg-canvas/60',
                      holiday && 'bg-ok-soft/40',
                    )}
                  >
                    <p
                      className={cn(
                        'tabular mb-1 inline-grid size-6 place-items-center rounded-full text-[12px]',
                        day === today
                          ? 'bg-accent font-semibold text-white'
                          : inMonth(day)
                            ? 'text-ink'
                            : 'text-ink-faint',
                      )}
                    >
                      {Number(day.slice(8))}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {events.slice(0, 4).map((event) => (
                        <li key={event.id}>
                          <EventChip event={event} />
                        </li>
                      ))}
                      {events.length > 4 && (
                        <li className="px-1 text-[11px] text-ink-faint">
                          +{events.length - 4} more
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          <Agenda days={days.filter(inMonth)} byDay={byDay} />

          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-faint">
            {Object.entries(KIND_STYLE).map(([kind, style]) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', style.dot)} />
                {style.label}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EventChip({ event }: { event: CalendarEvent }) {
  const style = KIND_STYLE[event.kind];
  const label = (
    <span
      className={cn('block truncate rounded px-1 py-0.5 text-[11px] leading-tight', style.chip)}
      title={`${style.label}: ${event.title}${event.projectCode != null ? ` (${event.projectCode})` : ''}`}
    >
      {event.title}
    </span>
  );
  return event.link != null ? (
    <Link to={event.link} className="block hover:opacity-80">
      {label}
    </Link>
  ) : (
    label
  );
}

/** The narrow-screen view: only the days that have something on them. */
function Agenda({ days, byDay }: { days: string[]; byDay: Map<string, CalendarEvent[]> }) {
  const busy = days.filter((day) => (byDay.get(day) ?? []).length > 0);
  return (
    <Card className="md:hidden" bodyClassName="p-0">
      {busy.length === 0 ? (
        <EmptyState title="A clear month" description="Nothing is scheduled in this month." />
      ) : (
        <ul>
          {busy.map((day) => (
            <li key={day} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="mb-1.5 text-[12px] font-semibold text-ink">{formatDate(day)}</p>
              <ul className="flex flex-col gap-1">
                {(byDay.get(day) ?? []).map((event) => (
                  <li key={event.id}>
                    <EventChip event={event} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
