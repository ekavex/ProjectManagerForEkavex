import type { EarnedValueMetrics, ProjectDetail, WorkstreamRow } from '@ekavist/shared';
import { Link } from 'react-router-dom';
import { TaskList } from '../../components/TaskTable.js';
import { Avatar, FactList } from '../../components/ui/page.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  ProgressBar,
  Stat,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import {
  formatDate,
  formatRelative,
  HEALTH_TONE,
  humanise,
  PHASE_STATUS_TONE,
  progressTone,
} from '../../lib/format.js';
import { useProjectDashboard } from '../../lib/queries.js';

export function OverviewTab({ project }: { project: ProjectDetail }) {
  const { data, isLoading, isError, error, refetch } = useProjectDashboard(project.id);

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data == null) return null;

  const { schedule, taskCounts, health } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Progress"
          value={`${project.progress}%`}
          hint={
            schedule.variance >= 0
              ? `${schedule.variance}% ahead of plan`
              : `${Math.abs(schedule.variance)}% behind plan`
          }
          tone={schedule.variance <= -25 ? 'danger' : schedule.variance <= -10 ? 'warn' : 'ok'}
        />
        <Stat
          label="Tasks"
          value={`${taskCounts.completed}/${taskCounts.total}`}
          hint={`${taskCounts.inProgress} in progress`}
        />
        <Stat
          label="Overdue"
          value={taskCounts.overdue}
          tone={taskCounts.overdue > 0 ? 'danger' : 'ok'}
        />
        <Stat
          label="Blocked"
          value={taskCounts.blocked}
          tone={taskCounts.blocked > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Days remaining"
          value={schedule.remainingDays}
          hint={`of ${schedule.totalDays} planned`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card title="Phase progress">
            {data.phases.length === 0 ? (
              <EmptyState
                title="No phases yet"
                description="Add the Waterfall phases to plan this project."
                action={
                  <Link
                    to={`/projects/${project.id}/phases`}
                    className="text-[13px] text-accent hover:underline"
                  >
                    Go to phases
                  </Link>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.phases.map((phase) => (
                  <li key={phase.id} className="flex items-center gap-3">
                    <span className="tabular w-5 shrink-0 text-[12px] text-ink-faint">
                      {phase.sequence}
                    </span>
                    <span className="w-32 shrink-0 truncate text-[13px] font-medium text-ink">
                      {phase.name}
                    </span>
                    <Badge tone={PHASE_STATUS_TONE[phase.status as never] ?? 'neutral'}>
                      {humanise(phase.status)}
                    </Badge>
                    <ProgressBar value={phase.progress} showLabel className="flex-1" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card
              title="Upcoming deadlines"
              action={
                <Link
                  to={`/projects/${project.id}/tasks`}
                  className="text-[12px] text-accent hover:underline"
                >
                  All tasks
                </Link>
              }
            >
              <TaskList
                tasks={data.upcomingDeadlines}
                emptyMessage="Nothing is due in the next two weeks."
              />
            </Card>

            <Card title="Overdue and blocked">
              <TaskList
                tasks={[...data.overdueTasks, ...data.blockedTasks]}
                emptyMessage="Nothing is overdue or blocked."
              />
            </Card>
          </div>

          <WorkstreamCard rows={data.workstreams} />

          <Card title="Recent activity">
            {data.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-faint">
                Activity will appear here as the team works.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-2 text-[13px]">
                    <span className="tabular shrink-0 text-[11px] text-ink-faint">
                      {formatRelative(entry.createdAt)}
                    </span>
                    <span className="text-ink">{entry.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Health" description="Measured from the project's own data">
            <ul className="flex flex-col gap-2.5">
              {health.indicators.map((indicator) => (
                <li key={indicator.key} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">
                      {indicator.label}
                    </span>
                    <span className="block text-[12px] text-ink-faint">{indicator.detail}</span>
                  </span>
                  <Badge tone={HEALTH_TONE[indicator.level]}>
                    {indicator.level === 'OK' ? 'OK' : humanise(indicator.level)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <EarnedValueCard metrics={data.earnedValue} />

          <Card title="Details">
            <FactList
              columns={1}
              items={[
                { label: 'Lead', value: project.lead?.fullName ?? 'Unassigned' },
                { label: 'Client', value: project.client ?? '—' },
                { label: 'Department', value: project.department?.name ?? '—' },
                { label: 'Priority', value: humanise(project.priority) },
                { label: 'Start', value: formatDate(project.startDate) },
                { label: 'Target', value: formatDate(project.plannedEndDate) },
                {
                  label: 'Forecast',
                  value:
                    schedule.forecastEndDate == null
                      ? 'Not enough progress to forecast'
                      : formatDate(schedule.forecastEndDate),
                },
                { label: 'Created by', value: project.createdBy?.fullName ?? '—' },
              ]}
            />
          </Card>

          {project.objectives.length > 0 && (
            <Card title="Objectives">
              <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-ink-soft">
                {project.objectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ul>
            </Card>
          )}

          {project.deliverables.length > 0 && (
            <Card title="Deliverables">
              <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-ink-soft">
                {project.deliverables.map((deliverable) => (
                  <li key={deliverable}>{deliverable}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Team">
            {data.workload.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-ink-faint">No tasks assigned yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.workload.map((row) => (
                  <li key={row.user.id} className="flex items-center gap-2.5">
                    <Avatar name={row.user.fullName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">
                        {row.user.fullName}
                      </span>
                      <span className="tabular block text-[11px] text-ink-faint">
                        {row.completed}/{row.total} done
                      </span>
                    </span>
                    <ProgressBar
                      value={row.progress}
                      className="w-16"
                      tone={progressTone(row.progress)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Task counts per phase, the workstream view of spec section 49. */
function WorkstreamCard({ rows }: { rows: WorkstreamRow[] }) {
  const used = rows.filter((row) => row.total > 0);
  return (
    <Card title="Workstreams" description="Tasks in each phase" bodyClassName="p-0">
      {used.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No tasks planned yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Workstream</Th>
              <Th align="right">Total</Th>
              <Th align="right">Done</Th>
              <Th align="right">Doing</Th>
              <Th align="right">To do</Th>
              <Th align="right">Blocked</Th>
              <Th align="right">Overdue</Th>
              <Th align="right">Progress</Th>
            </tr>
          </thead>
          <tbody>
            {used.map((row) => (
              <tr key={row.id ?? 'none'}>
                <Td className="font-medium">{row.name}</Td>
                <Td align="right">{row.total}</Td>
                <Td align="right">{row.completed}</Td>
                <Td align="right">{row.inProgress}</Td>
                <Td align="right">{row.notStarted}</Td>
                <Td align="right">{row.blocked}</Td>
                <Td align="right" className={row.overdue > 0 ? 'text-danger' : undefined}>
                  {row.overdue}
                </Td>
                <Td align="right">
                  <span className="flex items-center justify-end gap-2">
                    <ProgressBar
                      value={row.progress}
                      tone={progressTone(row.progress)}
                      className="w-14"
                    />
                    <span className="w-9">{row.progress}%</span>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Earned value in hours (spec sections 52 and 53). Each figure carries a plain-language
 * reading, because an SPI of 0.82 means nothing to most people until it says "behind".
 */
function EarnedValueCard({ metrics }: { metrics: EarnedValueMetrics }) {
  if (metrics.budgetAtCompletion === 0) {
    return (
      <Card title="Earned value" description="Needs task estimates">
        <p className="text-[13px] text-ink-faint">
          Add estimated hours to tasks to see schedule and cost performance.
        </p>
      </Card>
    );
  }

  const ratio = (value: number | null) => (value == null ? '—' : value.toFixed(2));
  const reading = (value: number | null, ahead: string, behind: string) =>
    value == null ? 'Not enough data yet' : value >= 1 ? ahead : behind;
  const tone = (value: number | null) =>
    value == null ? 'neutral' : value >= 0.95 ? 'ok' : value >= 0.8 ? 'warn' : 'danger';

  return (
    <Card title="Earned value" description={`In hours, as of ${formatDate(metrics.asOf)}`}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">SPI</p>
          <p className="tabular text-xl font-semibold text-ink">{ratio(metrics.spi)}</p>
          <Badge tone={tone(metrics.spi)}>
            {reading(metrics.spi, 'On or ahead of schedule', 'Behind schedule')}
          </Badge>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">CPI</p>
          <p className="tabular text-xl font-semibold text-ink">{ratio(metrics.cpi)}</p>
          <Badge tone={tone(metrics.cpi)}>
            {reading(metrics.cpi, 'Within effort', 'Over effort')}
          </Badge>
        </div>
      </div>
      <FactList
        columns={1}
        items={[
          { label: 'Planned value', value: `${metrics.plannedValue} h` },
          { label: 'Earned value', value: `${metrics.earnedValue} h` },
          { label: 'Actual hours', value: `${metrics.actualCost} h` },
          { label: 'Budget at completion', value: `${metrics.budgetAtCompletion} h` },
          {
            label: 'Estimate at completion',
            value: metrics.estimateAtCompletion == null ? '—' : `${metrics.estimateAtCompletion} h`,
          },
        ]}
      />
      {metrics.tasksWithoutEstimate > 0 && (
        <p className="mt-3 text-[12px] text-ink-faint">
          {metrics.tasksWithoutEstimate} open task
          {metrics.tasksWithoutEstimate === 1 ? ' has' : 's have'} no estimate and are not counted.
        </p>
      )}
    </Card>
  );
}
