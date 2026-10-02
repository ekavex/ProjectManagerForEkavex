/**
 * Capacity over the coming weeks (spec section 84): for each person, the working hours
 * they have after holidays and approved leave, set against the remaining estimated hours
 * of their open tasks. Answers "who is overloaded" and "who has room next month".
 */
import type { CapacityWeek } from '@ekavist/shared';
import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { formatDateShort } from '../lib/format.js';
import { useCapacity } from '../lib/queries.js';
import { Avatar } from './ui/page.js';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Table,
  Td,
  Th,
} from './ui/primitives.js';

function cellTone(week: CapacityWeek): string {
  if (week.utilisation == null) return 'bg-canvas text-ink-faint';
  if (week.utilisation > 110) return 'bg-danger-soft text-danger';
  if (week.utilisation > 85) return 'bg-warn-soft text-[oklch(42%_0.11_70)]';
  if (week.utilisation >= 40) return 'bg-ok-soft text-ok';
  return 'text-ink-soft';
}

export function CapacityCard() {
  const [weeks, setWeeks] = useState(6);
  const { data, isLoading, isError, error, refetch } = useCapacity({ weeks });

  return (
    <Card
      title="Capacity"
      description="Planned hours of open, estimated work against the hours each person has, week by week."
      action={
        <Select
          aria-label="Weeks ahead"
          className="h-8 w-32"
          value={weeks}
          onChange={(event) => setWeeks(Number(event.target.value))}
        >
          {[4, 6, 8, 12].map((value) => (
            <option key={value} value={value}>
              {value} weeks
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
      ) : data.rows.length === 0 ? (
        <EmptyState title="Nobody to plan for" description="People on your projects appear here." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th align="right">Allocation</Th>
                {data.rows[0]?.weeks.map((week) => (
                  <Th key={week.weekStart} align="center">
                    {formatDateShort(week.weekStart)}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.user.id}>
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.user.fullName} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.user.fullName}</span>
                        <span className="block text-[11px] text-ink-faint">
                          {row.projects} project{row.projects === 1 ? '' : 's'}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td align="right">
                    <span className={row.allocationPercent > 100 ? 'text-danger' : undefined}>
                      {row.allocationPercent}%
                    </span>
                  </Td>
                  {row.weeks.map((week) => (
                    <Td key={week.weekStart} align="center" className="p-1">
                      <span
                        className={cn(
                          'tabular block rounded px-1.5 py-1 text-[12px]',
                          cellTone(week),
                        )}
                        title={`${week.plannedHours} h planned of ${week.capacityHours} h available${
                          week.leaveDays > 0 ? `; ${week.leaveDays} day(s) of leave` : ''
                        }`}
                      >
                        {week.utilisation == null ? 'Away' : `${week.utilisation}%`}
                        <span className="block text-[10px] opacity-75">
                          {week.plannedHours}/{week.capacityHours} h
                        </span>
                      </span>
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
            Over 110% is overloaded, 85–110% is full, under 40% has room. Tasks without an estimate
            or a due date are not counted; draft projects are left out.
          </p>
        </>
      )}
    </Card>
  );
}
