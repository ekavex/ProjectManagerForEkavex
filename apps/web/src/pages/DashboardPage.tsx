/**
 * The landing page.
 *
 * Which dashboard a person sees follows from what they do: an administrator opens the
 * company view, a project lead their portfolio, everyone else their own work. The
 * employee dashboard is always available beneath, because a lead is also someone with
 * tasks of their own (spec sections 25, 43 and 50).
 */
import type { HealthLevel } from '@ekavist/shared';
import { Link } from 'react-router-dom';
import { TaskList } from '../components/TaskTable.js';
import { Avatar, PageHeader } from '../components/ui/page.js';
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
} from '../components/ui/primitives.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import {
  ATTENDANCE_TONE,
  formatMinutes,
  formatRelative,
  HEALTH_TONE,
  humanise,
} from '../lib/format.js';
import { useCompanyDashboard, useEmployeeDashboard, useLeadDashboard } from '../lib/queries.js';

export function DashboardPage() {
  const { user, can } = useAuth();
  const isAdmin = can('project:create');
  const employee = useEmployeeDashboard();

  return (
    <>
      <PageHeader
        title={`Good ${partOfDay()}, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        subtitle="Everything that needs you today, in one place."
      />

      {isAdmin && <CompanySection />}
      <LeadSection />

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-ink">My work</h2>

        {employee.isLoading ? (
          <div className="card">
            <LoadingState />
          </div>
        ) : employee.isError ? (
          <div className="card">
            <ErrorState error={employee.error} onRetry={() => void employee.refetch()} />
          </div>
        ) : employee.data != null ? (
          <EmployeeSection data={employee.data} />
        ) : null}
      </section>
    </>
  );
}

function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// ------------------------------------------------------------------ company

function CompanySection() {
  const { data, isLoading, isError, error, refetch } = useCompanyDashboard(true);

  if (isLoading) {
    return (
      <div className="card mb-6">
        <LoadingState label="Loading the company view…" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="card mb-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data == null) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-ink">Across the company</h2>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Active projects"
          value={data.projects.active}
          hint={`${data.projects.onSchedule} on schedule`}
        />
        <Stat
          label="Needing attention"
          value={data.projects.attentionRequired + data.projects.delayed}
          tone={data.projects.delayed > 0 ? 'danger' : undefined}
          hint={`${data.projects.delayed} delayed`}
        />
        <Stat
          label="Working today"
          value={data.people.workingToday}
          hint={`of ${data.people.active} active people`}
        />
        <Stat
          label="Overdue tasks"
          value={data.tasks.overdue}
          tone={data.tasks.overdue > 0 ? 'danger' : 'ok'}
          hint={`${data.tasks.blocked} blocked`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Project progress" className="lg:col-span-2">
          {data.projectProgress.length === 0 ? (
            <EmptyState title="No active projects" description="Create a project to get started." />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.projectProgress.map((project) => (
                <li key={project.id} className="flex items-center gap-3">
                  <Link
                    to={`/projects/${project.id}`}
                    className="w-48 shrink-0 truncate text-[13px] font-medium text-ink hover:text-accent"
                  >
                    {project.name}
                  </Link>
                  <ProgressBar value={project.progress} showLabel className="flex-1" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Attention" description="Highest-severity risks and open issues">
          {data.topRisks.length === 0 && data.openIssues.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              No open high-severity risks or issues.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data.topRisks.slice(0, 4).map((risk) => (
                <li key={risk.id} className="flex items-start gap-2">
                  <Badge tone="danger">{risk.reference}</Badge>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{risk.title}</span>
                    <span className="block text-[11px] text-ink-faint">{risk.projectName}</span>
                  </span>
                </li>
              ))}
              {data.openIssues.slice(0, 4).map((issue) => (
                <li key={issue.id} className="flex items-start gap-2">
                  <Badge tone="warn">{issue.reference}</Badge>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{issue.title}</span>
                    <span className="block text-[11px] text-ink-faint">{issue.projectName}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------- lead

function LeadSection() {
  const { data, isLoading } = useLeadDashboard(true);

  // A person who leads nothing simply does not see this section.
  if (isLoading || data == null || data.projects.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-ink">Projects I lead</h2>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Needs a decision" className="lg:col-span-1">
          {data.attentionItems.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              Nothing is overdue, blocked or waiting on you.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.attentionItems.slice(0, 8).map((item, index) => (
                <li key={`${item.projectId}-${item.kind}-${index}`}>
                  <Link
                    to={`/projects/${item.projectId}`}
                    className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-canvas"
                  >
                    <Badge
                      tone={item.kind === 'OVERDUE' || item.kind === 'BLOCKED' ? 'danger' : 'warn'}
                    >
                      {item.count}
                    </Badge>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{item.detail}</span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {item.projectName}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Team workload" description="Tasks per person across my projects">
          {data.workload.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">No tasks assigned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data.workload.slice(0, 6).map((row) => (
                <li key={row.user.id} className="flex items-center gap-2.5">
                  <Avatar name={row.user.fullName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{row.user.fullName}</span>
                    <span className="tabular block text-[11px] text-ink-faint">
                      {row.completed}/{row.total} done
                      {row.overdue > 0 && (
                        <span className="ml-1 font-medium text-danger">
                          · {row.overdue} overdue
                        </span>
                      )}
                    </span>
                  </span>
                  <ProgressBar value={row.progress} className="w-20" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Who is working today">
          {data.teamAttendance.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              Nobody has started work yet today.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.teamAttendance.slice(0, 8).map((row) => (
                <li key={row.user.id} className="flex items-center gap-2.5">
                  <Avatar name={row.user.fullName} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {row.user.fullName}
                  </span>
                  {row.status == null ? (
                    <span className="text-[11px] text-ink-faint">Not started</span>
                  ) : (
                    <Badge tone={ATTENDANCE_TONE[row.status]}>
                      {row.isOnBreak ? 'On break' : humanise(row.status)}
                    </Badge>
                  )}
                  <span className="tabular w-12 text-right text-[11px] text-ink-faint">
                    {formatMinutes(row.workMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- employee

function EmployeeSection({
  data,
}: {
  data: NonNullable<ReturnType<typeof useEmployeeDashboard>['data']>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Attendance"
          value={
            data.attendance.isWorking
              ? formatMinutes(data.attendance.workMinutes)
              : data.attendance.status == null
                ? 'Not started'
                : humanise(data.attendance.status)
          }
          hint={
            data.attendance.isOnBreak
              ? 'On a break'
              : data.attendance.isWorking
                ? 'Working now'
                : 'Press Start work when you begin'
          }
        />
        <Stat label="Due today" value={data.counts.todayTasks} />
        <Stat label="In progress" value={data.counts.inProgress} />
        <Stat
          label="Overdue"
          value={data.counts.overdue}
          tone={data.counts.overdue > 0 ? 'danger' : 'ok'}
        />
        <Stat label="Coming up" value={data.counts.upcoming} hint="Next two weeks" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card
          title="Today"
          className="lg:col-span-2"
          action={
            <Link to="/my-work" className="text-[12px] text-accent hover:underline">
              My work
            </Link>
          }
        >
          <TaskList
            tasks={data.todayTasks}
            showProject
            emptyMessage="Nothing is due today. Check what is coming up next."
          />
          {data.overdueTasks.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 text-[12px] font-semibold tracking-wide text-danger uppercase">
                Overdue
              </h3>
              <TaskList tasks={data.overdueTasks} showProject emptyMessage="" />
            </>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          <Card title="My projects">
            {data.projects.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-faint">
                You are not on any project yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.projects.slice(0, 6).map((project) => (
                  <li key={project.id}>
                    <Link to={`/projects/${project.id}`} className="group block">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink group-hover:text-accent">
                          {project.name}
                        </span>
                        <HealthDot level={project.health} />
                      </span>
                      <ProgressBar value={project.progress} showLabel className="mt-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent activity">
            {data.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-faint">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.recentActivity.slice(0, 6).map((entry) => (
                  <li key={entry.id} className="text-[12px]">
                    <span className="text-ink">{entry.summary}</span>
                    <span className="ml-1 text-ink-faint">{formatRelative(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {data.notes.length > 0 && (
        <Card
          title="My notes"
          className="mt-3"
          action={
            <Link to="/my-work" className="text-[12px] text-accent hover:underline">
              All notes
            </Link>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>Note</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.notes.map((note) => (
                <tr key={note.id}>
                  <Td>
                    <span className="font-medium">{note.title}</span>
                    <span className="block truncate text-[12px] text-ink-faint">{note.body}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-ink-faint">
                      {formatRelative(note.updatedAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

export function HealthDot({ level }: { level: HealthLevel }) {
  return (
    <Badge tone={HEALTH_TONE[level]}>
      {level === 'OK' ? 'On track' : level === 'ATTENTION' ? 'Attention' : 'Critical'}
    </Badge>
  );
}
