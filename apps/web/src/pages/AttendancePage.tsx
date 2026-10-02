/**
 * Attendance (spec sections 27 to 30).
 *
 * Two views: my own history, and — for a lead or administrator — who is working today.
 * The page opens with the reminder that signing in is not attendance, because that
 * distinction is the whole point of the module.
 */
import { useState } from 'react';
import { ExportButton } from '../components/ExportButton.js';
import { Avatar, FilterBar, PageHeader, Pagination } from '../components/ui/page.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Stat,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { useAuth } from '../features/auth/AuthProvider.js';
import { ATTENDANCE_TONE, formatDate, formatMinutes, formatTime, humanise } from '../lib/format.js';
import { useAttendanceHistory, useAttendanceToday, useTeamAttendance } from '../lib/queries.js';

export function AttendancePage() {
  const { can } = useAuth();
  const seesTeam = can('attendance:read-team') || can('attendance:read-all');
  const [view, setView] = useState<'mine' | 'team'>('mine');

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Signing in is authentication. Starting work is attendance — they are recorded separately."
        actions={<AttendanceExport />}
      />

      {seesTeam && (
        <div className="mb-3 flex gap-1.5">
          <Button
            size="sm"
            variant={view === 'mine' ? 'primary' : 'secondary'}
            onClick={() => setView('mine')}
          >
            My attendance
          </Button>
          <Button
            size="sm"
            variant={view === 'team' ? 'primary' : 'secondary'}
            onClick={() => setView('team')}
          >
            Today's team
          </Button>
        </div>
      )}

      {view === 'mine' ? <MyAttendance /> : <TeamAttendance />}
    </>
  );
}

function MyAttendance() {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const today = useAttendanceToday();
  const history = useAttendanceHistory({
    page,
    pageSize: 31,
    from: from === '' ? undefined : from,
    to: to === '' ? undefined : to,
  });

  const days = history.data?.data ?? [];
  const totalMinutes = days.reduce((sum, day) => sum + day.workMinutes, 0);
  const presentDays = days.filter(
    (day) => day.status === 'PRESENT' || day.status === 'LATE' || day.status === 'HALF_DAY',
  ).length;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Today"
          value={
            today.data?.isWorking === true
              ? formatMinutes(today.data.workMinutes)
              : today.data?.status == null
                ? 'Not started'
                : humanise(today.data.status)
          }
          hint={today.data?.isOnBreak === true ? 'On a break' : undefined}
        />
        <Stat label="Days in view" value={presentDays} />
        <Stat label="Time in view" value={formatMinutes(totalMinutes)} />
        <Stat
          label="Average day"
          value={presentDays === 0 ? '—' : formatMinutes(totalMinutes / presentDays)}
        />
      </div>

      <FilterBar>
        <Input
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="From date"
        />
        <span className="text-[13px] text-ink-faint">to</span>
        <Input
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
          className="w-40"
          aria-label="To date"
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {history.isLoading ? (
          <LoadingState />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : days.length === 0 ? (
          <EmptyState
            title="No attendance recorded"
            description="Press Start work in the header to begin a day."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>First start</Th>
                  <Th>Last end</Th>
                  <Th align="right">Work</Th>
                  <Th align="right">Breaks</Th>
                  <Th>Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.id} className="hover:bg-canvas">
                    <Td>
                      <span className="tabular font-medium">{formatDate(day.workDate)}</span>
                    </Td>
                    <Td>
                      <Badge tone={ATTENDANCE_TONE[day.status]}>{humanise(day.status)}</Badge>
                      {day.adjustedBy != null && (
                        <span className="block text-[11px] text-ink-faint">
                          Adjusted by {day.adjustedBy.fullName}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">{formatTime(day.firstStartedAt)}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-[13px]">{formatTime(day.lastEndedAt)}</span>
                    </Td>
                    <Td align="right">{formatMinutes(day.workMinutes)}</Td>
                    <Td align="right">
                      <span className="text-ink-faint">{formatMinutes(day.breakMinutes)}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-faint">
                        {day.sessions.length} session{day.sessions.length === 1 ? '' : 's'}
                        {day.sessions.some((session) => session.project != null) && (
                          <span className="block truncate">
                            {[
                              ...new Set(
                                day.sessions
                                  .map((session) => session.project?.code)
                                  .filter((code): code is string => code != null),
                              ),
                            ].join(', ')}
                          </span>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {history.data != null && <Pagination meta={history.data.meta} onPageChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

function TeamAttendance() {
  const [date, setDate] = useState('');
  const { data, isLoading, isError, error, refetch } = useTeamAttendance(
    { date: date === '' ? undefined : date },
    true,
  );

  const working = (data ?? []).filter((row) => row.isWorking).length;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Working now" value={working} />
        <Stat label="People in view" value={data?.length ?? 0} />
        <Stat label="On a break" value={(data ?? []).filter((row) => row.isOnBreak).length} />
        <Stat label="Not started" value={(data ?? []).filter((row) => row.status == null).length} />
      </div>

      <FilterBar>
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-40"
          aria-label="Date"
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data == null || data.length === 0 ? (
          <EmptyState
            title="Nobody to show"
            description="You see attendance for the people on the projects you lead."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Status</Th>
                <Th>Started</Th>
                <Th align="right">Worked</Th>
                <Th>Currently on</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.user.id} className="hover:bg-canvas">
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.user.fullName} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.user.fullName}</span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {row.user.designation ?? row.user.email}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    {row.status == null ? (
                      <span className="text-[12px] text-ink-faint">Not started</span>
                    ) : (
                      <Badge tone={ATTENDANCE_TONE[row.status]}>
                        {row.isOnBreak ? 'On break' : humanise(row.status)}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <span className="tabular text-[13px]">{formatTime(row.firstStartedAt)}</span>
                  </Td>
                  <Td align="right">{formatMinutes(row.workMinutes)}</Td>
                  <Td>
                    <span className="text-[12px] text-ink-soft">
                      {row.currentTask == null
                        ? '—'
                        : `${row.currentTask.reference} ${row.currentTask.name}`}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/**
 * A CSV of attendance days for a date range: your own, plus everyone you may see — the
 * server decides who that is.
 */
function AttendanceExport() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="date"
        aria-label="Export from"
        className="h-8 w-36"
        value={from}
        onChange={(event) => setFrom(event.target.value)}
      />
      <span className="text-[12px] text-ink-faint">to</span>
      <Input
        type="date"
        aria-label="Export to"
        className="h-8 w-36"
        value={to}
        onChange={(event) => setTo(event.target.value)}
      />
      <ExportButton path="/attendance/export.csv" query={{ from, to }} />
    </div>
  );
}
