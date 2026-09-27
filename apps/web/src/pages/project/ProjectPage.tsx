/**
 * The project shell: header, tabs and nested routes (spec section 80).
 *
 * Tabs a person cannot use are not shown. `project.capabilities` comes from the server,
 * which calculated it from the same permission matrix it enforces, so the navigation and
 * the API always agree about what this person may do.
 */
import type { Permission } from '@ekavist/shared';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { HealthDot } from '../DashboardPage.js';
import { PageHeader, Tabs, type TabDefinition } from '../../components/ui/page.js';
import { Badge, ErrorState, LoadingState, ProgressBar } from '../../components/ui/primitives.js';
import { formatDate, humanise, PROJECT_STATUS_TONE } from '../../lib/format.js';
import { useProject } from '../../lib/queries.js';
import { ChangeRequestsTab } from './ChangeRequestsTab.js';
import { ChatTab } from './ChatTab.js';
import { DocumentsTab } from './DocumentsTab.js';
import { GanttTab } from './GanttTab.js';
import { IssuesTab } from './IssuesTab.js';
import { MilestonesTab } from './MilestonesTab.js';
import { NotesTab } from './NotesTab.js';
import { OverviewTab } from './OverviewTab.js';
import { PhasesTab } from './PhasesTab.js';
import { RaciTab } from './RaciTab.js';
import { ReportsTab } from './ReportsTab.js';
import { RisksTab } from './RisksTab.js';
import { TaskDetailPanel } from './TaskDetailPanel.js';
import { TasksTab } from './TasksTab.js';
import { TeamTab } from './TeamTab.js';
import { WbsTab } from './WbsTab.js';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const { data: project, isLoading, isError, error, refetch } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="card">
        <LoadingState label="Loading the project…" />
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

  if (project == null) return <Navigate to="/projects" replace />;

  const can = (permission: Permission): boolean => project.capabilities.includes(permission);
  const base = `/projects/${projectId}`;

  const tabs: TabDefinition[] = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/phases`, label: 'Phases' },
    { to: `${base}/wbs`, label: 'WBS' },
    { to: `${base}/tasks`, label: 'Tasks' },
    { to: `${base}/gantt`, label: 'Gantt' },
    { to: `${base}/team`, label: 'Team' },
    { to: `${base}/milestones`, label: 'Milestones' },
    { to: `${base}/raci`, label: 'RACI' },
    ...(can('chat:read') ? [{ to: `${base}/chat`, label: 'Chat' }] : []),
    { to: `${base}/documents`, label: 'Documents' },
    { to: `${base}/notes`, label: 'Notes' },
    { to: `${base}/risks`, label: 'Risks' },
    { to: `${base}/issues`, label: 'Issues' },
    { to: `${base}/change-requests`, label: 'Changes' },
    { to: `${base}/reports`, label: 'Reports' },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/projects" className="hover:text-accent">
            Projects
          </Link>
        }
        title={project.name}
        subtitle={project.description ?? undefined}
        meta={
          <>
            <Badge tone="neutral">{project.code}</Badge>
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>{humanise(project.status)}</Badge>
            <HealthDot level={project.health} />
            <span className="text-[12px] text-ink-faint">
              {formatDate(project.startDate)} → {formatDate(project.plannedEndDate)}
            </span>
            {project.currentPhase != null && (
              <span className="text-[12px] text-ink-faint">
                Current phase: {project.currentPhase.name}
              </span>
            )}
          </>
        }
        actions={
          <div className="flex w-48 flex-col gap-1">
            <span className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Overall progress
            </span>
            <ProgressBar value={project.progress} showLabel />
          </div>
        }
      />

      {project.archivedAt != null && (
        <div className="mb-4 rounded-md border border-line-strong bg-canvas px-3 py-2.5 text-[13px] text-ink-soft">
          This project is archived and is read-only. Restore it from the overview to make changes
          again.
        </div>
      )}

      <Tabs tabs={tabs} />

      <Routes>
        <Route index element={<OverviewTab project={project} />} />
        <Route path="phases" element={<PhasesTab project={project} />} />
        <Route path="wbs" element={<WbsTab project={project} />} />
        <Route path="tasks" element={<TasksTab project={project} />} />
        <Route path="tasks/:taskId" element={<TaskDetailPanel project={project} />} />
        <Route path="gantt" element={<GanttTab project={project} />} />
        <Route path="team" element={<TeamTab project={project} />} />
        <Route path="milestones" element={<MilestonesTab project={project} />} />
        <Route path="raci" element={<RaciTab project={project} />} />
        <Route path="chat" element={<ChatTab project={project} />} />
        <Route path="documents" element={<DocumentsTab project={project} />} />
        <Route path="notes" element={<NotesTab project={project} />} />
        <Route path="risks" element={<RisksTab project={project} />} />
        <Route path="issues" element={<IssuesTab project={project} />} />
        <Route path="change-requests" element={<ChangeRequestsTab project={project} />} />
        <Route
          path="change-requests/:changeRequestId"
          element={<ChangeRequestsTab project={project} />}
        />
        <Route path="reports" element={<ReportsTab project={project} />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </>
  );
}
