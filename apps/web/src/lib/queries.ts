/**
 * Query keys and the data hooks every screen shares.
 *
 * Keys are built here rather than inline so an invalidation after a mutation cannot miss
 * a cache entry because two files spelled the key differently.
 */
import type {
  ActivityEntry,
  AttendanceDay,
  AttendanceToday,
  ChangeRequest,
  CompanyDashboard,
  DecisionLogEntry,
  Department,
  EmployeeDashboard,
  GanttResponse,
  Issue,
  LeadDashboard,
  Message,
  Milestone,
  MyWork,
  Notification,
  Paginated,
  PersonalNote,
  Phase,
  ProjectDashboard,
  ProjectDetail,
  ProjectDocument,
  ProjectHealth,
  ProjectMember,
  ProjectNote,
  ProjectSummary,
  RaciMatrix,
  Risk,
  SearchHit,
  SharedResource,
  TaskDetail,
  TaskSummary,
  TeamAttendanceRow,
  TimelineEntry,
  UserDetail,
  WbsNode,
} from '@ekavist/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from './api.js';

type QueryParams = Record<string, string | number | boolean | string[] | undefined | null>;

export const keys = {
  me: ['me'] as const,
  myDashboard: ['me', 'dashboard'] as const,
  myWork: ['me', 'work'] as const,
  myNotes: (params?: QueryParams) => ['me', 'notes', params ?? {}] as const,

  companyDashboard: ['dashboard', 'company'] as const,
  leadDashboard: ['dashboard', 'lead'] as const,

  users: (params?: QueryParams) => ['users', params ?? {}] as const,
  user: (id: string) => ['users', id] as const,
  departments: ['departments'] as const,

  projects: (params?: QueryParams) => ['projects', params ?? {}] as const,
  project: (id: string) => ['projects', id] as const,
  projectDashboard: (id: string) => ['projects', id, 'dashboard'] as const,
  projectHealth: (id: string) => ['projects', id, 'health'] as const,
  members: (id: string) => ['projects', id, 'members'] as const,
  phases: (id: string) => ['projects', id, 'phases'] as const,
  wbs: (id: string) => ['projects', id, 'wbs'] as const,
  tasks: (id: string, params?: QueryParams) => ['projects', id, 'tasks', params ?? {}] as const,
  task: (projectId: string, taskId: string) => ['projects', projectId, 'tasks', taskId] as const,
  taskComments: (projectId: string, taskId: string) =>
    ['projects', projectId, 'tasks', taskId, 'comments'] as const,
  dependencies: (id: string) => ['projects', id, 'dependencies'] as const,
  gantt: (id: string, params?: QueryParams) => ['projects', id, 'gantt', params ?? {}] as const,
  milestones: (id: string) => ['projects', id, 'milestones'] as const,
  raci: (id: string) => ['projects', id, 'raci'] as const,
  messages: (id: string, params?: QueryParams) =>
    ['projects', id, 'messages', params ?? {}] as const,
  pinned: (id: string) => ['projects', id, 'messages', 'pinned'] as const,
  resources: (id: string, params?: QueryParams) =>
    ['projects', id, 'resources', params ?? {}] as const,
  documents: (id: string, params?: QueryParams) =>
    ['projects', id, 'documents', params ?? {}] as const,
  projectNotes: (id: string, params?: QueryParams) =>
    ['projects', id, 'notes', params ?? {}] as const,
  decisions: (id: string) => ['projects', id, 'decisions'] as const,
  risks: (id: string, params?: QueryParams) => ['projects', id, 'risks', params ?? {}] as const,
  issues: (id: string, params?: QueryParams) => ['projects', id, 'issues', params ?? {}] as const,
  changeRequests: (id: string, params?: QueryParams) =>
    ['projects', id, 'change-requests', params ?? {}] as const,
  changeRequest: (projectId: string, id: string) =>
    ['projects', projectId, 'change-requests', id] as const,
  activity: (id: string, params?: QueryParams) =>
    ['projects', id, 'activity', params ?? {}] as const,
  timeline: (id: string) => ['projects', id, 'timeline'] as const,
  closure: (id: string) => ['projects', id, 'closure'] as const,
  dailyReport: (id: string, date?: string) => ['projects', id, 'reports', 'daily', date] as const,
  weeklyReport: (id: string, weekOf?: string) =>
    ['projects', id, 'reports', 'weekly', weekOf] as const,
  finalReport: (id: string) => ['projects', id, 'reports', 'final'] as const,

  attendanceToday: ['attendance', 'today'] as const,
  attendanceHistory: (params?: QueryParams) => ['attendance', 'history', params ?? {}] as const,
  attendanceTeam: (params?: QueryParams) => ['attendance', 'team', params ?? {}] as const,

  notifications: (params?: QueryParams) => ['notifications', params ?? {}] as const,
  notificationRules: ['notifications', 'rules'] as const,

  workload: (params?: QueryParams) => ['reports', 'workload', params ?? {}] as const,
  audit: (params?: QueryParams) => ['audit', params ?? {}] as const,
  search: (term: string) => ['search', term] as const,
};

/** A collection endpoint that answers `{ data: [...] }` rather than a page. */
interface Collection<T> {
  data: T[];
}

// --------------------------------------------------------------- dashboards

export const useEmployeeDashboard = (): UseQueryResult<EmployeeDashboard> =>
  useQuery({
    queryKey: keys.myDashboard,
    queryFn: () => api.get<EmployeeDashboard>('/me/dashboard'),
  });

export const useMyWork = (): UseQueryResult<MyWork> =>
  useQuery({ queryKey: keys.myWork, queryFn: () => api.get<MyWork>('/me/work') });

export const useCompanyDashboard = (enabled: boolean): UseQueryResult<CompanyDashboard> =>
  useQuery({
    queryKey: keys.companyDashboard,
    queryFn: () => api.get<CompanyDashboard>('/dashboard/company'),
    enabled,
  });

export const useLeadDashboard = (enabled: boolean): UseQueryResult<LeadDashboard> =>
  useQuery({
    queryKey: keys.leadDashboard,
    queryFn: () => api.get<LeadDashboard>('/dashboard/lead'),
    enabled,
  });

// ------------------------------------------------------------------ people

export const useUsers = (params: QueryParams): UseQueryResult<Paginated<UserDetail>> =>
  useQuery({
    queryKey: keys.users(params),
    queryFn: () => api.get<Paginated<UserDetail>>('/users', params),
  });

export const useUser = (id: string): UseQueryResult<UserDetail> =>
  useQuery({ queryKey: keys.user(id), queryFn: () => api.get<UserDetail>(`/users/${id}`) });

export const useDepartments = (): UseQueryResult<Department[]> =>
  useQuery({
    queryKey: keys.departments,
    queryFn: async () => (await api.get<Collection<Department>>('/departments')).data,
  });

// ---------------------------------------------------------------- projects

export const useProjects = (params: QueryParams): UseQueryResult<Paginated<ProjectSummary>> =>
  useQuery({
    queryKey: keys.projects(params),
    queryFn: () => api.get<Paginated<ProjectSummary>>('/projects', params),
  });

export const useProject = (id: string): UseQueryResult<ProjectDetail> =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
  });

export const useProjectDashboard = (id: string): UseQueryResult<ProjectDashboard> =>
  useQuery({
    queryKey: keys.projectDashboard(id),
    queryFn: () => api.get<ProjectDashboard>(`/projects/${id}/dashboard`),
  });

export const useProjectHealth = (id: string): UseQueryResult<ProjectHealth> =>
  useQuery({
    queryKey: keys.projectHealth(id),
    queryFn: () => api.get<ProjectHealth>(`/projects/${id}/health`),
  });

export const useMembers = (id: string): UseQueryResult<ProjectMember[]> =>
  useQuery({
    queryKey: keys.members(id),
    queryFn: async () => (await api.get<Collection<ProjectMember>>(`/projects/${id}/members`)).data,
  });

export const usePhases = (id: string): UseQueryResult<Phase[]> =>
  useQuery({
    queryKey: keys.phases(id),
    queryFn: async () => (await api.get<Collection<Phase>>(`/projects/${id}/phases`)).data,
  });

export const useWbs = (id: string): UseQueryResult<WbsNode[]> =>
  useQuery({
    queryKey: keys.wbs(id),
    queryFn: async () => (await api.get<Collection<WbsNode>>(`/projects/${id}/wbs`)).data,
  });

export const useTasks = (id: string, params: QueryParams): UseQueryResult<Paginated<TaskSummary>> =>
  useQuery({
    queryKey: keys.tasks(id, params),
    queryFn: () => api.get<Paginated<TaskSummary>>(`/projects/${id}/tasks`, params),
  });

export const useTask = (projectId: string, taskId: string): UseQueryResult<TaskDetail> =>
  useQuery({
    queryKey: keys.task(projectId, taskId),
    queryFn: () => api.get<TaskDetail>(`/projects/${projectId}/tasks/${taskId}`),
    enabled: taskId !== '',
  });

export const useGantt = (id: string, params: QueryParams): UseQueryResult<GanttResponse> =>
  useQuery({
    queryKey: keys.gantt(id, params),
    queryFn: () => api.get<GanttResponse>(`/projects/${id}/gantt`, params),
  });

export const useMilestones = (id: string): UseQueryResult<Milestone[]> =>
  useQuery({
    queryKey: keys.milestones(id),
    queryFn: async () => (await api.get<Collection<Milestone>>(`/projects/${id}/milestones`)).data,
  });

export const useRaci = (id: string): UseQueryResult<RaciMatrix> =>
  useQuery({ queryKey: keys.raci(id), queryFn: () => api.get<RaciMatrix>(`/projects/${id}/raci`) });

// --------------------------------------------------------- project content

export const useMessages = (id: string, params: QueryParams): UseQueryResult<Paginated<Message>> =>
  useQuery({
    queryKey: keys.messages(id, params),
    queryFn: () => api.get<Paginated<Message>>(`/projects/${id}/messages`, params),
  });

export const usePinnedMessages = (id: string): UseQueryResult<Message[]> =>
  useQuery({
    queryKey: keys.pinned(id),
    queryFn: async () =>
      (await api.get<Collection<Message>>(`/projects/${id}/messages/pinned`)).data,
  });

export const useResources = (
  id: string,
  params: QueryParams,
): UseQueryResult<Paginated<SharedResource>> =>
  useQuery({
    queryKey: keys.resources(id, params),
    queryFn: () => api.get<Paginated<SharedResource>>(`/projects/${id}/resources`, params),
  });

export const useDocuments = (
  id: string,
  params: QueryParams,
): UseQueryResult<Paginated<ProjectDocument>> =>
  useQuery({
    queryKey: keys.documents(id, params),
    queryFn: () => api.get<Paginated<ProjectDocument>>(`/projects/${id}/documents`, params),
  });

export const useProjectNotes = (
  id: string,
  params: QueryParams,
): UseQueryResult<Paginated<ProjectNote>> =>
  useQuery({
    queryKey: keys.projectNotes(id, params),
    queryFn: () => api.get<Paginated<ProjectNote>>(`/projects/${id}/notes`, params),
  });

export const usePersonalNotes = (params: QueryParams): UseQueryResult<Paginated<PersonalNote>> =>
  useQuery({
    queryKey: keys.myNotes(params),
    queryFn: () => api.get<Paginated<PersonalNote>>('/me/notes', params),
  });

export const useDecisions = (id: string): UseQueryResult<DecisionLogEntry[]> =>
  useQuery({
    queryKey: keys.decisions(id),
    queryFn: async () =>
      (await api.get<Collection<DecisionLogEntry>>(`/projects/${id}/decisions`)).data,
  });

export const useRisks = (id: string, params: QueryParams): UseQueryResult<Paginated<Risk>> =>
  useQuery({
    queryKey: keys.risks(id, params),
    queryFn: () => api.get<Paginated<Risk>>(`/projects/${id}/risks`, params),
  });

export const useIssues = (id: string, params: QueryParams): UseQueryResult<Paginated<Issue>> =>
  useQuery({
    queryKey: keys.issues(id, params),
    queryFn: () => api.get<Paginated<Issue>>(`/projects/${id}/issues`, params),
  });

export const useChangeRequests = (
  id: string,
  params: QueryParams,
): UseQueryResult<Paginated<ChangeRequest>> =>
  useQuery({
    queryKey: keys.changeRequests(id, params),
    queryFn: () => api.get<Paginated<ChangeRequest>>(`/projects/${id}/change-requests`, params),
  });

export const useActivity = (
  id: string,
  params: QueryParams,
): UseQueryResult<Paginated<ActivityEntry>> =>
  useQuery({
    queryKey: keys.activity(id, params),
    queryFn: () => api.get<Paginated<ActivityEntry>>(`/projects/${id}/activity`, params),
  });

export const useTimeline = (id: string): UseQueryResult<TimelineEntry[]> =>
  useQuery({
    queryKey: keys.timeline(id),
    queryFn: async () =>
      (await api.get<Collection<TimelineEntry>>(`/projects/${id}/timeline`)).data,
  });

// -------------------------------------------------------------- attendance

export const useAttendanceToday = (): UseQueryResult<AttendanceToday> =>
  useQuery({
    queryKey: keys.attendanceToday,
    queryFn: () => api.get<AttendanceToday>('/attendance/today'),
    // The header shows a running total, so it is refreshed while the page is open.
    refetchInterval: 60_000,
  });

export const useAttendanceHistory = (
  params: QueryParams,
): UseQueryResult<Paginated<AttendanceDay>> =>
  useQuery({
    queryKey: keys.attendanceHistory(params),
    queryFn: () => api.get<Paginated<AttendanceDay>>('/attendance/history', params),
  });

export const useTeamAttendance = (
  params: QueryParams,
  enabled: boolean,
): UseQueryResult<TeamAttendanceRow[]> =>
  useQuery({
    queryKey: keys.attendanceTeam(params),
    queryFn: async () =>
      (await api.get<Collection<TeamAttendanceRow>>('/attendance/team', params)).data,
    enabled,
  });

// ----------------------------------------------------------- notifications

export interface NotificationPage extends Paginated<Notification> {
  unreadCount: number;
}

export const useNotifications = (params: QueryParams): UseQueryResult<NotificationPage> =>
  useQuery({
    queryKey: keys.notifications(params),
    queryFn: () => api.get<NotificationPage>('/notifications', params),
  });

// ----------------------------------------------------------------- search

export const useSearch = (term: string): UseQueryResult<SearchHit[]> =>
  useQuery({
    queryKey: keys.search(term),
    queryFn: async () => (await api.get<Collection<SearchHit>>('/search', { q: term })).data,
    // Two characters is the server's minimum; below that there is nothing to ask for.
    enabled: term.trim().length >= 2,
  });
