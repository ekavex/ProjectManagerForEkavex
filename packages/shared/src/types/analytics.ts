/** Dashboard, health, report and import response shapes. */
import type { AttendanceStatus, HealthLevel, ProjectStatus } from '../enums.js';
import type {
  ActivityEntry,
  AttendanceToday,
  Message,
  Milestone,
  Notification,
  PersonalNote,
  ProjectSummary,
  TaskCounts,
  TaskSummary,
  UserSummary,
} from './core.js';

// ------------------------------------------------------------------ health

export interface HealthIndicator {
  key: 'SCHEDULE' | 'TASKS' | 'DEPENDENCIES' | 'PHASE_GATE' | 'OVERDUE' | 'RISKS' | 'ISSUES';
  label: string;
  level: HealthLevel;
  /** Plain-language reason, e.g. "4 tasks overdue". Never a bare score. */
  detail: string;
}

export interface ProjectHealth {
  overall: HealthLevel;
  indicators: HealthIndicator[];
}

export interface ScheduleMetrics {
  /** Percentage of the planned duration that has elapsed, clamped to 0..100. */
  plannedProgress: number;
  actualProgress: number;
  /** actual minus planned; negative means behind schedule. */
  variance: number;
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  forecastEndDate: string | null;
}

// --------------------------------------------------------- project dashboard

export interface PhaseProgressSlice {
  id: string;
  name: string;
  sequence: number;
  status: string;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
}

export interface MemberWorkload {
  user: UserSummary;
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  overdue: number;
  progress: number;
}

export interface ProjectDashboard {
  project: ProjectSummary;
  schedule: ScheduleMetrics;
  health: ProjectHealth;
  taskCounts: TaskCounts;
  phases: PhaseProgressSlice[];
  upcomingDeadlines: TaskSummary[];
  overdueTasks: TaskSummary[];
  blockedTasks: TaskSummary[];
  milestones: Milestone[];
  workload: MemberWorkload[];
  openRisks: { id: string; reference: string; title: string; severity: string }[];
  openIssues: { id: string; reference: string; title: string; priority: string }[];
  recentActivity: ActivityEntry[];
  recentMessages: Message[];
  keyDocuments: { id: string; name: string; url: string; category: string }[];
}

// ------------------------------------------------------- employee dashboard

export interface EmployeeDashboard {
  attendance: AttendanceToday;
  counts: {
    todayTasks: number;
    completedToday: number;
    inProgress: number;
    overdue: number;
    upcoming: number;
  };
  todayTasks: TaskSummary[];
  upcomingTasks: TaskSummary[];
  overdueTasks: TaskSummary[];
  projects: ProjectSummary[];
  /** Completion rate across all of the user's non-cancelled tasks. */
  myProgress: number;
  notes: PersonalNote[];
  notifications: Notification[];
  recentActivity: ActivityEntry[];
}

// ----------------------------------------------------------- lead dashboard

export interface LeadDashboard {
  projects: ProjectSummary[];
  totals: TaskCounts;
  attentionItems: {
    projectId: string;
    projectName: string;
    kind: 'OVERDUE' | 'BLOCKED' | 'PHASE_DUE' | 'GATE_PENDING' | 'DUE_TODAY';
    detail: string;
    count: number;
  }[];
  workload: MemberWorkload[];
  upcomingDeadlines: TaskSummary[];
  teamAttendance: TeamAttendanceRow[];
  recentActivity: ActivityEntry[];
}

// -------------------------------------------------------- company dashboard

export interface CompanyDashboard {
  projects: {
    active: number;
    onSchedule: number;
    attentionRequired: number;
    delayed: number;
    byStatus: Record<ProjectStatus, number>;
  };
  people: {
    total: number;
    active: number;
    workingToday: number;
    onBreak: number;
  };
  tasks: TaskCounts;
  projectProgress: {
    id: string;
    code: string;
    name: string;
    progress: number;
    health: HealthLevel;
  }[];
  upcomingMilestones: Milestone[];
  topRisks: {
    id: string;
    reference: string;
    title: string;
    severity: string;
    projectName: string;
  }[];
  openIssues: {
    id: string;
    reference: string;
    title: string;
    priority: string;
    projectName: string;
  }[];
  recentActivity: ActivityEntry[];
}

export interface TeamAttendanceRow {
  user: UserSummary;
  status: AttendanceStatus | null;
  isWorking: boolean;
  isOnBreak: boolean;
  firstStartedAt: string | null;
  workMinutes: number;
  currentTask: { id: string; reference: string; name: string } | null;
}

// ----------------------------------------------------------------- my work

export interface MyWork {
  today: TaskSummary[];
  upcoming: TaskSummary[];
  overdue: TaskSummary[];
  completed: TaskSummary[];
  projects: ProjectSummary[];
}

// ------------------------------------------------------------------ reports

export interface DailyReport {
  date: string;
  project: { id: string; code: string; name: string };
  completed: TaskSummary[];
  started: TaskSummary[];
  overdue: TaskSummary[];
  blocked: TaskSummary[];
  activity: { user: UserSummary; updates: number; workMinutes: number }[];
  generatedAt: string;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  project: { id: string; code: string; name: string };
  schedule: ScheduleMetrics;
  completed: TaskSummary[];
  overdue: TaskSummary[];
  blocked: TaskSummary[];
  phases: PhaseProgressSlice[];
  risks: { id: string; reference: string; title: string; severity: string; status: string }[];
  issues: { id: string; reference: string; title: string; priority: string; status: string }[];
  nextWeek: TaskSummary[];
  generatedAt: string;
}

export interface FinalProjectReport {
  project: {
    id: string;
    code: string;
    name: string;
    status: ProjectStatus;
    lead: UserSummary | null;
  };
  duration: {
    plannedStart: string;
    plannedEnd: string;
    actualStart: string | null;
    actualEnd: string | null;
    plannedDays: number;
    actualDays: number | null;
    varianceDays: number | null;
  };
  tasks: {
    planned: number;
    completed: number;
    cancelled: number;
    delayed: number;
    completionRate: number;
  };
  phases: PhaseProgressSlice[];
  deliverables: { name: string; delivered: boolean }[];
  decisions: { reference: string; title: string; decidedOn: string; by: string | null }[];
  changeRequests: {
    reference: string;
    title: string;
    status: string;
    scheduleImpactDays: number;
  }[];
  risks: { reference: string; title: string; severity: string; status: string }[];
  issues: { reference: string; title: string; priority: string; status: string }[];
  lessons: { category: string; note: string; author: string | null }[];
  handoverNote: string | null;
  generatedAt: string;
}

export interface WorkloadReport {
  rows: (MemberWorkload & { projects: number; estimatedHours: number; actualHours: number })[];
  generatedAt: string;
}

// ------------------------------------------------------------------- import

export interface ImportIssue {
  row: number;
  column: string | null;
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  wbsCode: string | null;
  phaseName: string | null;
  taskName: string | null;
  ownerEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string | null;
  progress: number | null;
  predecessor: string | null;
  valid: boolean;
}

export interface ImportPreview {
  jobId: string;
  checksum: string;
  sheets: string[];
  detectedColumns: string[];
  rows: ImportPreviewRow[];
  issues: ImportIssue[];
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
    phasesToCreate: string[];
    wbsToCreate: number;
    tasksToCreate: number;
    unknownUsers: string[];
  };
  /** False whenever any ERROR issue is present: confirming is refused. */
  canConfirm: boolean;
}

export interface ImportResult {
  jobId: string;
  phasesCreated: number;
  wbsCreated: number;
  tasksCreated: number;
  dependenciesCreated: number;
  milestonesCreated: number;
  usersCreated: number;
}

// ------------------------------------------------------------------ closure

export interface ClosureChecklist {
  items: {
    key: string;
    label: string;
    satisfied: boolean;
    detail: string;
  }[];
  canClose: boolean;
}
