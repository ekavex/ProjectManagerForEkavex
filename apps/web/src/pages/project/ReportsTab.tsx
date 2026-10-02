/**
 * Project reports (spec section 47).
 *
 * Daily, weekly and final, all generated from the project's own data at the moment they
 * are opened. Nothing here is stored or cached, so a report can never disagree with the
 * dashboard beside it.
 */
import type { DailyReport, FinalProjectReport, ProjectDetail, WeeklyReport } from '@ekavist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TaskList } from '../../components/TaskTable.js';
import { FactList } from '../../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  ProgressBar,
  Stat,
  Table,
  Td,
  Th,
} from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime, formatMinutes, humanise } from '../../lib/format.js';
import { keys } from '../../lib/queries.js';

type ReportKind = 'daily' | 'weekly' | 'final';

export function ReportsTab({ project }: { project: ProjectDetail }) {
  const [kind, setKind] = useState<ReportKind>('weekly');
  const [date, setDate] = useState('');

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['daily', 'weekly', 'final'] as ReportKind[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={kind === value ? 'primary' : 'secondary'}
            onClick={() => setKind(value)}
          >
            {value === 'final' ? 'Project completion' : `${humanise(value)} report`}
          </Button>
        ))}

        {kind !== 'final' && (
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-44"
            aria-label={kind === 'daily' ? 'Report date' : 'Any date in the week'}
          />
        )}

        <span className="flex-1" />
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {kind === 'daily' && <Daily project={project} date={date} />}
      {kind === 'weekly' && <Weekly project={project} weekOf={date} />}
      {kind === 'final' && <Final project={project} />}
    </>
  );
}

function Daily({ project, date }: { project: ProjectDetail; date: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.dailyReport(project.id, date === '' ? undefined : date),
    queryFn: () =>
      api.get<DailyReport>(
        `/projects/${project.id}/reports/daily`,
        date === '' ? undefined : { date },
      ),
  });

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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-faint">
        {formatDate(data.date)} · generated {formatDateTime(data.generatedAt)}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Completed" value={data.completed.length} tone="ok" />
        <Stat label="Started" value={data.started.length} />
        <Stat
          label="Overdue"
          value={data.overdue.length}
          tone={data.overdue.length > 0 ? 'danger' : 'ok'}
        />
        <Stat
          label="Blocked"
          value={data.blocked.length}
          tone={data.blocked.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Completed today">
          <TaskList tasks={data.completed} emptyMessage="Nothing was completed today." />
        </Card>
        <Card title="Started today">
          <TaskList tasks={data.started} emptyMessage="Nothing was started today." />
        </Card>
        <Card title="Overdue">
          <TaskList tasks={data.overdue} emptyMessage="Nothing is overdue." />
        </Card>
        <Card title="Blocked">
          <TaskList tasks={data.blocked} emptyMessage="Nothing is blocked." />
        </Card>
      </div>

      <Card title="Team activity">
        {data.activity.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-faint">
            No recorded activity for this day.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th align="right">Updates</Th>
                <Th align="right">Time recorded</Th>
              </tr>
            </thead>
            <tbody>
              {data.activity.map((row) => (
                <tr key={row.user.id}>
                  <Td>{row.user.fullName}</Td>
                  <Td align="right">{row.updates}</Td>
                  <Td align="right">{formatMinutes(row.workMinutes)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Weekly({ project, weekOf }: { project: ProjectDetail; weekOf: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.weeklyReport(project.id, weekOf === '' ? undefined : weekOf),
    queryFn: () =>
      api.get<WeeklyReport>(
        `/projects/${project.id}/reports/weekly`,
        weekOf === '' ? undefined : { weekOf },
      ),
  });

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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-faint">
        {formatDate(data.weekStart)} – {formatDate(data.weekEnd)} · generated{' '}
        {formatDateTime(data.generatedAt)}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Actual progress"
          value={`${data.schedule.actualProgress}%`}
          hint={`Plan says ${data.schedule.plannedProgress}%`}
          tone={data.schedule.variance < -10 ? 'warn' : 'ok'}
        />
        <Stat label="Completed this week" value={data.completed.length} />
        <Stat
          label="Overdue"
          value={data.overdue.length}
          tone={data.overdue.length > 0 ? 'danger' : 'ok'}
        />
        <Stat label="Due next week" value={data.nextWeek.length} />
      </div>

      <Card title="Phase progress">
        <ul className="flex flex-col gap-2.5">
          {data.phases.map((phase) => (
            <li key={phase.id} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-[13px]">{phase.name}</span>
              <Badge tone="neutral">{humanise(phase.status)}</Badge>
              <ProgressBar value={phase.progress} showLabel className="flex-1" />
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Completed this week">
          <TaskList tasks={data.completed} emptyMessage="Nothing was completed this week." />
        </Card>
        <Card title="Next week">
          <TaskList tasks={data.nextWeek} emptyMessage="Nothing is due next week." />
        </Card>
        <Card title="Open risks">
          {data.risks.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">No open risks.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.risks.map((risk) => (
                <li key={risk.id} className="flex items-center gap-2 text-[13px]">
                  <Badge tone="neutral">{risk.reference}</Badge>
                  <span className="min-w-0 flex-1 truncate">{risk.title}</span>
                  <Badge tone="warn">{humanise(risk.severity)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Open issues">
          {data.issues.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">No open issues.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.issues.map((issue) => (
                <li key={issue.id} className="flex items-center gap-2 text-[13px]">
                  <Badge tone="neutral">{issue.reference}</Badge>
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                  <Badge tone="info">{humanise(issue.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Final({ project }: { project: ProjectDetail }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.finalReport(project.id),
    queryFn: () => api.get<FinalProjectReport>(`/projects/${project.id}/reports/final`),
  });

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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-faint">
        Generated {formatDateTime(data.generatedAt)} from the project's own records.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Task completion"
          value={`${data.tasks.completionRate}%`}
          hint={`${data.tasks.completed} of ${data.tasks.planned}`}
        />
        <Stat
          label="Delayed tasks"
          value={data.tasks.delayed}
          tone={data.tasks.delayed > 0 ? 'warn' : 'ok'}
        />
        <Stat label="Planned duration" value={`${data.duration.plannedDays}d`} />
        <Stat
          label="Schedule variance"
          value={
            data.duration.varianceDays == null
              ? '—'
              : `${data.duration.varianceDays > 0 ? '+' : ''}${data.duration.varianceDays}d`
          }
          tone={
            data.duration.varianceDays != null && data.duration.varianceDays > 0 ? 'danger' : 'ok'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Duration">
          <FactList
            items={[
              { label: 'Planned start', value: formatDate(data.duration.plannedStart) },
              { label: 'Planned end', value: formatDate(data.duration.plannedEnd) },
              { label: 'Actual start', value: formatDate(data.duration.actualStart) },
              { label: 'Actual end', value: formatDate(data.duration.actualEnd) },
            ]}
          />
        </Card>

        <Card title="Deliverables">
          {data.deliverables.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              No deliverables were recorded for this project.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.deliverables.map((deliverable) => (
                <li key={deliverable.name} className="flex items-center gap-2 text-[13px]">
                  <Badge tone={deliverable.delivered ? 'ok' : 'warn'}>
                    {deliverable.delivered ? 'Delivered' : 'Not filed'}
                  </Badge>
                  <span>{deliverable.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Decisions">
          {data.decisions.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">No decisions recorded.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {data.decisions.map((decision) => (
                <li key={decision.reference} className="flex items-start gap-2">
                  <Badge tone="neutral">{decision.reference}</Badge>
                  <span className="min-w-0">
                    <span className="block">{decision.title}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {formatDate(decision.decidedOn)}
                      {decision.by != null && ` · ${decision.by}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Change requests">
          {data.changeRequests.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              No change requests were raised.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {data.changeRequests.map((request) => (
                <li key={request.reference} className="flex items-center gap-2">
                  <Badge tone="neutral">{request.reference}</Badge>
                  <span className="min-w-0 flex-1 truncate">{request.title}</span>
                  <Badge tone={request.status === 'APPROVED' ? 'ok' : 'neutral'}>
                    {humanise(request.status)}
                  </Badge>
                  {request.scheduleImpactDays !== 0 && (
                    <span className="tabular text-[11px] text-ink-faint">
                      {request.scheduleImpactDays > 0 ? '+' : ''}
                      {request.scheduleImpactDays}d
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Lessons learned" className="lg:col-span-2">
          {data.lessons.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              No lessons recorded yet. The project lead adds them on the Closure tab.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px]">
              {data.lessons.map((lesson, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Badge tone="neutral">{humanise(lesson.category)}</Badge>
                  <span className="min-w-0">
                    <span className="block">{lesson.note}</span>
                    {lesson.author != null && (
                      <span className="block text-[11px] text-ink-faint">{lesson.author}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.handoverNote != null && (
          <Card title="Handover" className="lg:col-span-2">
            <p className="text-[13px] whitespace-pre-wrap text-ink-soft">{data.handoverNote}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
