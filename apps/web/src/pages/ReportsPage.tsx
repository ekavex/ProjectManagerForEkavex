/**
 * Cross-project reporting (spec sections 48 and 49).
 *
 * Work distribution across people, so an uneven load is visible before it becomes a
 * missed deadline.
 */
import { useQuery } from '@tanstack/react-query';
import type { WorkloadReport } from '@ekavist/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, FilterBar, PageHeader } from '../components/ui/page.js';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  ProgressBar,
  Select,
  Stat,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { api } from '../lib/api.js';
import { formatHours } from '../lib/format.js';
import { keys, useProjects } from '../lib/queries.js';

export function ReportsPage() {
  const [projectId, setProjectId] = useState('');
  const { data: projects } = useProjects({ page: 1, pageSize: 100 });

  const params = projectId === '' ? {} : { projectId };
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.workload(params),
    queryFn: () => api.get<WorkloadReport>('/reports/workload', params),
  });

  const rows = data?.rows ?? [];
  const totals = rows.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      completed: sum.completed + row.completed,
      overdue: sum.overdue + row.overdue,
    }),
    { total: 0, completed: 0, overdue: 0 },
  );

  // The spread between the busiest and quietest person is the number a lead acts on.
  const busiest = rows[0]?.total ?? 0;
  const quietest = rows.length > 0 ? (rows[rows.length - 1]?.total ?? 0) : 0;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Work distribution across people and projects. Per-project reports live on each project."
      />

      <FilterBar>
        <Select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="w-64"
          aria-label="Filter by project"
        >
          <option value="">Every project I can see</option>
          {(projects?.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} — {project.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tasks assigned" value={totals.total} />
        <Stat label="Completed" value={totals.completed} tone="ok" />
        <Stat label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? 'danger' : 'ok'} />
        <Stat
          label="Busiest vs quietest"
          value={rows.length < 2 ? '—' : `${busiest} vs ${quietest}`}
          hint={
            rows.length >= 2 && busiest > quietest * 2
              ? 'The load looks uneven'
              : 'Reasonably balanced'
          }
          tone={rows.length >= 2 && busiest > quietest * 2 ? 'warn' : undefined}
        />
      </div>

      <Card title="Work distribution" bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No assigned work"
            description="Once tasks are assigned, the distribution appears here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th align="right">Projects</Th>
                <Th align="right">Total</Th>
                <Th align="right">Done</Th>
                <Th align="right">Doing</Th>
                <Th align="right">To do</Th>
                <Th align="right">Blocked</Th>
                <Th align="right">Overdue</Th>
                <Th align="right">Estimated</Th>
                <Th align="right">Actual</Th>
                <Th className="w-32">Progress</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user.id} className="hover:bg-canvas">
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.user.fullName} size="sm" />
                      <span className="truncate font-medium">{row.user.fullName}</span>
                    </span>
                  </Td>
                  <Td align="right">{row.projects}</Td>
                  <Td align="right">{row.total}</Td>
                  <Td align="right">{row.completed}</Td>
                  <Td align="right">{row.inProgress}</Td>
                  <Td align="right">{row.notStarted}</Td>
                  <Td align="right">
                    <span className={row.blocked > 0 ? 'font-medium text-warn' : undefined}>
                      {row.blocked}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className={row.overdue > 0 ? 'font-medium text-danger' : undefined}>
                      {row.overdue}
                    </span>
                  </Td>
                  <Td align="right">{formatHours(row.estimatedHours)}</Td>
                  <Td align="right">{formatHours(row.actualHours)}</Td>
                  <Td>
                    <ProgressBar value={row.progress} showLabel />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-4 text-[12px] text-ink-faint">
        Daily, weekly and project-completion reports are on each project, under{' '}
        <Link to="/projects" className="text-accent hover:underline">
          Projects
        </Link>{' '}
        → Reports.
      </p>
    </>
  );
}
