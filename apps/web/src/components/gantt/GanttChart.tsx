/**
 * The interactive Gantt (spec section 22).
 *
 * A fixed table of rows on the left, a scrolling timeline on the right, and an SVG layer
 * carrying the dependency arrows. Everything is drawn from live project data: phases as
 * bands, WBS items spanning their children, tasks as bars, milestones as diamonds.
 */
import type { GanttResponse, TaskStatus } from '@ekavist/shared';
import { cn } from '../../lib/cn.js';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateShort } from '../../lib/format.js';
import { Badge } from '../ui/primitives.js';
import {
  BAR_HEIGHT,
  DAY_WIDTH,
  ROW_HEIGHT,
  barGeometry,
  dependencyPaths,
  timelineColumns,
  visibleRows,
  xFor,
  type Granularity,
} from './geometry.js';

export function GanttChart({
  data,
  projectId,
  granularity,
  onGranularityChange,
}: {
  data: GanttResponse;
  projectId: string;
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const timelineRef = useRef<HTMLDivElement>(null);

  const dayWidth = DAY_WIDTH[granularity];
  const rows = useMemo(() => visibleRows(data.bars, collapsed), [data.bars, collapsed]);
  const columns = useMemo(
    () => timelineColumns(data.from, data.to, granularity),
    [data.from, data.to, granularity],
  );

  const rowIndexById = useMemo(() => new Map(rows.map((bar, index) => [bar.id, index])), [rows]);

  const arrows = useMemo(
    () => dependencyPaths(data.dependencies, rows, rowIndexById, data.from, dayWidth),
    [data.dependencies, rows, rowIndexById, data.from, dayWidth],
  );

  const totalWidth = columns.reduce((max, column) => Math.max(max, column.x + column.width), 0);
  const totalHeight = rows.length * ROW_HEIGHT;
  const todayX = xFor(data.today, data.from, dayWidth);

  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="text-[12px] text-ink-faint">
          {formatDateShort(data.from)} – {formatDateShort(data.to)} · {rows.length} rows ·{' '}
          {data.dependencies.length} dependencies
        </p>
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as Granularity[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onGranularityChange(value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium capitalize',
                granularity === value
                  ? 'bg-accent text-white'
                  : 'text-ink-soft hover:bg-canvas hover:text-ink',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* The row labels stay put while the timeline scrolls. */}
        <div className="w-64 shrink-0 border-r border-line sm:w-80">
          <div className="flex h-11 items-end border-b border-line px-3 pb-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
              Task
            </span>
          </div>
          <div>
            {rows.map((bar) => (
              <div
                key={bar.id}
                className="flex items-center gap-1.5 border-b border-line px-3"
                style={{ height: ROW_HEIGHT, paddingLeft: 12 + bar.depth * 14 }}
              >
                {bar.hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(bar.id)}
                    aria-label={
                      collapsed.has(bar.id) ? `Expand ${bar.label}` : `Collapse ${bar.label}`
                    }
                    className="-ml-1 rounded p-0.5 text-ink-faint hover:bg-canvas hover:text-ink"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      className={cn('transition-transform', !collapsed.has(bar.id) && 'rotate-90')}
                      aria-hidden="true"
                    >
                      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" fill="none" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-3.5" />
                )}

                {bar.code != null && (
                  <span className="tabular shrink-0 text-[11px] text-ink-faint">{bar.code}</span>
                )}

                {bar.kind === 'TASK' ? (
                  <Link
                    to={`/projects/${projectId}/tasks/${bar.id}`}
                    className="truncate text-[12px] text-ink hover:text-accent"
                    title={bar.label}
                  >
                    {bar.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      'truncate text-[12px]',
                      bar.kind === 'PHASE' ? 'font-semibold text-ink' : 'font-medium text-ink-soft',
                    )}
                    title={bar.label}
                  >
                    {bar.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* The timeline. */}
        <div ref={timelineRef} className="scroll-thin flex-1 overflow-x-auto">
          <div style={{ width: Math.max(totalWidth, 320) }}>
            <div className="relative h-11 border-b border-line">
              {columns.map((column) => (
                <div
                  key={`${column.x}-${column.label}`}
                  className={cn(
                    'absolute top-0 flex h-full items-end justify-center border-l border-line pb-1.5 text-[11px]',
                    column.emphasis ? 'bg-canvas text-ink-soft' : 'text-ink-faint',
                  )}
                  style={{ left: column.x, width: column.width }}
                >
                  {column.width > 22 ? column.label : ''}
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: Math.max(totalHeight, 80) }}>
              {/* Column guides. */}
              {columns.map((column) => (
                <div
                  key={`guide-${column.x}`}
                  className={cn(
                    'absolute top-0 bottom-0 border-l border-line',
                    column.emphasis && 'bg-canvas',
                  )}
                  style={{ left: column.x, width: column.width }}
                />
              ))}

              {/* Row separators. */}
              {rows.map((bar, index) => (
                <div
                  key={`row-${bar.id}`}
                  className="absolute right-0 left-0 border-b border-line"
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              ))}

              {/* Today. */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div
                  className="absolute top-0 bottom-0 z-10 w-px bg-danger"
                  style={{ left: todayX }}
                  aria-hidden="true"
                >
                  <span className="absolute -top-0.5 -left-1 size-2 rounded-full bg-danger" />
                </div>
              )}

              {/* Dependency arrows, beneath the bars so a bar is never obscured. */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={totalWidth}
                height={Math.max(totalHeight, 80)}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="gantt-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0 0L6 3L0 6z" fill="var(--color-ink-faint)" />
                  </marker>
                </defs>
                {arrows.map((arrow) => (
                  <path
                    key={arrow.id}
                    d={arrow.d}
                    fill="none"
                    stroke="var(--color-ink-faint)"
                    strokeWidth="1.2"
                    markerEnd="url(#gantt-arrow)"
                  />
                ))}
              </svg>

              {/* Bars. */}
              {rows.map((bar, index) => {
                const geometry = barGeometry(bar, index, data.from, dayWidth);
                if (geometry == null) return null;

                if (bar.kind === 'MILESTONE') {
                  return (
                    <div
                      key={bar.id}
                      className="absolute z-10"
                      style={{ left: geometry.x - 6, top: geometry.y + 1 }}
                      title={`${bar.label} · ${formatDateShort(bar.start)}`}
                    >
                      <div
                        className={cn(
                          'size-3 rotate-45',
                          bar.status === 'ACHIEVED'
                            ? 'bg-ok'
                            : bar.isOverdue
                              ? 'bg-danger'
                              : 'bg-accent',
                        )}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={bar.id}
                    className="absolute z-10"
                    style={{ left: geometry.x, top: geometry.y, width: geometry.width }}
                    title={`${bar.label} · ${formatDateShort(bar.start)} → ${formatDateShort(bar.end)} · ${bar.progress}%`}
                  >
                    <div
                      className={cn(
                        'relative overflow-hidden rounded',
                        bar.kind === 'PHASE'
                          ? 'bg-[oklch(90%_0.04_262)]'
                          : bar.kind === 'WBS'
                            ? 'bg-[oklch(92%_0.02_255)]'
                            : barTone(bar.status as TaskStatus, bar.isOverdue),
                      )}
                      style={{ height: bar.kind === 'TASK' ? BAR_HEIGHT : BAR_HEIGHT - 4 }}
                    >
                      <div
                        className={cn(
                          'h-full',
                          bar.kind === 'TASK' ? 'bg-[oklch(52%_0.17_262_/_0.55)]' : 'bg-accent/35',
                        )}
                        style={{ width: `${Math.min(100, bar.progress)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-[oklch(90%_0.04_262)]" /> Phase
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-[oklch(92%_0.02_255)]" /> WBS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-[oklch(88%_0.06_262)]" /> Task
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 bg-accent" /> Milestone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-px bg-danger" /> Today
        </span>
        {data.bars.some((bar) => bar.start == null) && (
          <Badge tone="neutral">
            {data.bars.filter((bar) => bar.start == null).length} item(s) have no dates and are not
            drawn
          </Badge>
        )}
      </div>
    </div>
  );
}

function barTone(status: TaskStatus, isOverdue: boolean): string {
  if (status === 'COMPLETED') return 'bg-[oklch(90%_0.07_155)]';
  if (status === 'CANCELLED') return 'bg-[oklch(93%_0_0)]';
  if (isOverdue || status === 'BLOCKED') return 'bg-[oklch(91%_0.06_25)]';
  return 'bg-[oklch(88%_0.06_262)]';
}
