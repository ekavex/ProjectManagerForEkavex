/**
 * Response shapes returned by the API.
 *
 * These are the contract between `apps/api` and `apps/web`. Service functions declare
 * these as their return type, so removing a field breaks the API build, and the web app
 * breaks at compile time rather than rendering `undefined`.
 *
 * Dates: `string` fields named `*Date` / `*On` carry `YYYY-MM-DD`; everything else that
 * represents a moment carries an ISO-8601 instant in UTC.
 */
import type {
  AttendanceStatus,
  ChangeRequestStatus,
  DependencyType,
  DocumentCategory,
  HealthLevel,
  IssueStatus,
  MilestoneStatus,
  NoteVisibility,
  NotificationType,
  OrgRole,
  PhaseGateStatus,
  PhaseStatus,
  Priority,
  ProjectRole,
  ProjectStatus,
  RaciRole,
  ResourceKind,
  RiskLevel,
  RiskStatus,
  TaskStatus,
  UserStatus,
} from '../enums.js';
import type { Permission } from '../permissions.js';

// ----------------------------------------------------------------- people

/** The smallest safe representation of a person; used wherever a name is displayed. */
export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  designation: string | null;
}

export interface UserDetail extends UserSummary {
  phone: string | null;
  role: OrgRole;
  status: UserStatus;
  department: { id: string; name: string } | null;
  manager: UserSummary | null;
  joiningDate: string | null;
  timezone: string;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  head: UserSummary | null;
  memberCount: number;
}

/** `GET /auth/me`. */
export interface CurrentUser extends UserDetail {
  permissions: Permission[];
  organization: {
    id: string;
    name: string;
    timezone: string;
    workdayStart: string;
    lateAfter: string;
  };
  notificationPreferences: Record<string, boolean>;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: CurrentUser;
}

// --------------------------------------------------------------- projects

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  priority: Priority;
  progress: number;
  startDate: string;
  plannedEndDate: string;
  actualEndDate: string | null;
  lead: UserSummary | null;
  currentPhase: { id: string; name: string; sequence: number } | null;
  memberCount: number;
  taskCounts: TaskCounts;
  health: HealthLevel;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  category: string | null;
  client: string | null;
  department: { id: string; name: string } | null;
  budget: number | null;
  location: string | null;
  externalStakeholder: string | null;
  logoUrl: string | null;
  objectives: string[];
  deliverables: string[];
  createdBy: UserSummary | null;
  createdAt: string;
  archivedAt: string | null;
  /** What the calling user may do here, so the UI need not re-derive the rules. */
  capabilities: Permission[];
}

export interface TaskCounts {
  total: number;
  notStarted: number;
  inProgress: number;
  blocked: number;
  underReview: number;
  completed: number;
  cancelled: number;
  overdue: number;
  dueToday: number;
}

export interface ProjectMember {
  id: string;
  user: UserSummary;
  projectRole: ProjectRole;
  responsibility: string | null;
  canReadChat: boolean;
  allocationPercent: number;
  assignedTasks: number;
  completedTasks: number;
  progress: number;
  joinedAt: string;
}

// --------------------------------------------------------------- waterfall

export interface PhaseGate {
  approvalRequired: boolean;
  status: PhaseGateStatus;
  approver: UserSummary | null;
  submittedBy: UserSummary | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface Phase {
  id: string;
  sequence: number;
  name: string;
  description: string | null;
  owner: UserSummary | null;
  status: PhaseStatus;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  deliverables: string[];
  gate: PhaseGate;
  taskCounts: TaskCounts;
  /** False when a preceding gate has not been approved (spec section 5). */
  canStart: boolean;
  blockedReason: string | null;
}

export interface WbsNode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  phaseId: string | null;
  parentId: string | null;
  owner: UserSummary | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  deliverable: string | null;
  progress: number;
  taskCount: number;
  children: WbsNode[];
}

// ------------------------------------------------------------------- tasks

export interface TaskSummary {
  id: string;
  reference: string;
  name: string;
  status: TaskStatus;
  priority: Priority;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  daysUntilDue: number | null;
  assignees: UserSummary[];
  phase: { id: string; name: string } | null;
  wbs: { id: string; code: string } | null;
  project: { id: string; code: string; name: string };
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  accountable: UserSummary | null;
  estimatedHours: number | null;
  actualHours: number | null;
  predecessors: TaskLink[];
  successors: TaskLink[];
  /** Predecessors that are not finished, i.e. why starting this task is discouraged. */
  blockingPredecessors: TaskLink[];
  commentCount: number;
  attachments: Attachment[];
  createdBy: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskLink {
  dependencyId: string;
  type: DependencyType;
  lagDays: number;
  task: { id: string; reference: string; name: string; status: TaskStatus; dueDate: string | null };
}

export interface TaskComment {
  id: string;
  author: UserSummary;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  kind: ResourceKind;
  name: string;
  url: string;
  sizeBytes: number | null;
  mimeType: string | null;
  addedBy: UserSummary | null;
  createdAt: string;
}

export interface Milestone {
  id: string;
  name: string;
  description: string | null;
  date: string;
  status: MilestoneStatus;
  owner: UserSummary | null;
  phase: { id: string; name: string } | null;
  tasks: { id: string; reference: string; name: string; status: TaskStatus }[];
}

export interface RaciCell {
  userId: string;
  role: RaciRole;
}

export interface RaciMatrix {
  members: UserSummary[];
  rows: {
    kind: 'TASK' | 'WBS';
    id: string;
    label: string;
    reference: string;
    cells: RaciCell[];
  }[];
}

// ------------------------------------------------------------------- gantt

export interface GanttBar {
  id: string;
  kind: 'PHASE' | 'WBS' | 'TASK' | 'MILESTONE';
  parentId: string | null;
  code: string | null;
  label: string;
  ownerName: string | null;
  start: string | null;
  end: string | null;
  durationDays: number | null;
  progress: number;
  status: string;
  isOverdue: boolean;
  depth: number;
  hasChildren: boolean;
}

export interface GanttDependency {
  id: string;
  type: DependencyType;
  fromId: string;
  toId: string;
  lagDays: number;
}

export interface GanttResponse {
  /** Inclusive window actually covered, widened to whole weeks or months as needed. */
  from: string;
  to: string;
  granularity: 'day' | 'week' | 'month';
  today: string;
  bars: GanttBar[];
  dependencies: GanttDependency[];
}

// --------------------------------------------------------------- attendance

export interface BreakSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  reason: string | null;
  minutes: number;
}

export interface WorkSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  project: { id: string; code: string; name: string } | null;
  task: { id: string; reference: string; name: string } | null;
  note: string | null;
  breaks: BreakSession[];
}

export interface AttendanceDay {
  id: string;
  workDate: string;
  user: UserSummary;
  status: AttendanceStatus;
  firstStartedAt: string | null;
  lastEndedAt: string | null;
  workMinutes: number;
  breakMinutes: number;
  sessions: WorkSession[];
  adjustedBy: UserSummary | null;
  adjustmentReason: string | null;
}

/** `GET /attendance/today` — drives the header widget. */
export interface AttendanceToday {
  workDate: string;
  status: AttendanceStatus | null;
  isWorking: boolean;
  isOnBreak: boolean;
  openSession: WorkSession | null;
  workMinutes: number;
  breakMinutes: number;
}

// -------------------------------------------------------------------- chat

export interface MessageReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  projectId: string;
  parentId: string | null;
  author: UserSummary;
  body: string;
  attachments: Attachment[];
  mentions: UserSummary[];
  reactions: MessageReactionGroup[];
  replyCount: number;
  isPinned: boolean;
  pinnedBy: UserSummary | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface SharedResource {
  id: string;
  kind: ResourceKind;
  name: string;
  url: string;
  addedBy: UserSummary | null;
  source: 'DOCUMENT' | 'MESSAGE' | 'TASK';
  phase: { id: string; name: string } | null;
  task: { id: string; reference: string } | null;
  createdAt: string;
}

// --------------------------------------------------- documents, notes, log

export interface ProjectDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  url: string;
  fileType: string | null;
  version: string | null;
  description: string | null;
  phase: { id: string; name: string } | null;
  task: { id: string; reference: string } | null;
  addedBy: UserSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNote {
  id: string;
  title: string;
  body: string;
  visibility: NoteVisibility;
  pinned: boolean;
  phase: { id: string; name: string } | null;
  author: UserSummary;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionLogEntry {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  reason: string | null;
  decidedOn: string;
  decisionMaker: UserSummary | null;
  phase: { id: string; name: string } | null;
  task: { id: string; reference: string } | null;
  document: { id: string; name: string; url: string } | null;
  createdAt: string;
}

// -------------------------------------------------------------- governance

export interface Risk {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  probability: RiskLevel;
  impact: RiskLevel;
  severity: RiskLevel;
  severityScore: number;
  owner: UserSummary | null;
  mitigation: string | null;
  contingency: string | null;
  status: RiskStatus;
  dueDate: string | null;
  phase: { id: string; name: string } | null;
  task: { id: string; reference: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  priority: Priority;
  owner: UserSummary | null;
  identifiedOn: string;
  targetResolution: string | null;
  status: IssueStatus;
  resolution: string | null;
  phase: { id: string; name: string } | null;
  task: { id: string; reference: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRequestImpact {
  scopeImpact: string | null;
  scheduleImpactDays: number;
  effortImpactHours: number;
  resourceImpact: string | null;
  costImpact: number | null;
  riskImpact: string | null;
  affectedTasks: { id: string; reference: string; name: string }[];
  analysedBy: UserSummary | null;
  analysedAt: string | null;
}

export interface ChangeRequest {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  reason: string | null;
  status: ChangeRequestStatus;
  requester: UserSummary;
  requestedOn: string;
  phase: { id: string; name: string } | null;
  impact: ChangeRequestImpact | null;
  approver: UserSummary | null;
  decidedAt: string | null;
  decisionNote: string | null;
  scheduleImpactApplied: boolean;
  createdAt: string;
}

// ----------------------------------------------------------- notifications

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string } | null;
  entityType: string | null;
  entityId: string | null;
  /** Ready-made SPA route for the "open" action. */
  link: string | null;
}

export interface NotificationRule {
  id: string;
  type: NotificationType;
  offsetDays: number;
  enabled: boolean;
  emailEnabled: boolean;
  notifyLead: boolean;
}

// ------------------------------------------------------- audit and activity

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  actor: UserSummary | null;
  verb: string;
  summary: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface TimelineEntry {
  date: string;
  events: { id: string; summary: string; at: string }[];
}

// ------------------------------------------------------------------ search

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  projectId: string | null;
  link: string;
}
