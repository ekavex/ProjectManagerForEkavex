import type { ProjectDetail } from '@ekavist/shared';
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
