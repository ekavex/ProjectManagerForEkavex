# Ekavist — Database Design

PostgreSQL 16. Authoritative source: `apps/api/prisma/schema.prisma`.
This document explains the _intent_ behind the schema; the schema file is the contract.

## 1. Conventions

- Primary keys are `cuid()` strings. They are opaque and safe to expose.
- Every table has `createdAt` / `updatedAt` (`timestamptz`).
- Soft deletion (`deletedAt`) is used **only** where history matters and a hard delete
  would orphan audit trails: `Project`, `Task`, `Message`, `Document`. Everything else is
  hard-deleted or status-flagged. Mixing both everywhere costs more than it earns.
- Human-facing identifiers (`Task.reference` = `T-102`, `Risk.reference` = `R-04`) are
  generated per project by a counter on `Project`, not by a global sequence.
- All enums live in Prisma **and** are re-exported from `packages/shared` so no string
  literal for a status is ever written twice (master prompt §13).

## 2. Entity groups

### 2.1 Organisation & people

```
Organization 1─* User
Organization 1─* Department          Department 1─* User
User *─1 User (manager, self-reference, nullable)
User 1─* UserSkill
Role (SUPER_ADMIN | PROJECT_LEAD | TEAM_MEMBER | VIEWER) is an enum on User
  → organisation-wide capability
RolePermission maps Role → Permission strings, seeded and editable by admin
```

`User.status` ∈ ACTIVE | INACTIVE | SUSPENDED. Only ACTIVE users may authenticate.
`User.timezone` is an IANA name; defaults to `Organization.timezone`.

**Why an enum for the org role and a table for permissions:** the four roles are a fixed
product concept (spec §6) but the capability set attached to them must be configurable by
an admin (spec §57), so the mapping is data.

### 2.2 Projects & membership

```
Project 1─* ProjectMember *─1 User
ProjectMember.projectRole ∈ LEAD | MEMBER | VIEWER   (project-scoped, distinct from org role)
Project.leadId → User        (required before status may become ACTIVE — business rule 1/2)
Project 1─* ProjectObjective
Project 1─* ProjectDeliverable
```

Unique constraint `(projectId, userId)` on `ProjectMember` prevents duplicate membership.
`Project.status` ∈ DRAFT | PLANNED | ACTIVE | ON_HOLD | AT_RISK | COMPLETED | CANCELLED | ARCHIVED.
Archived projects are read-only, enforced in the service layer (business rule 20).

### 2.3 Waterfall

```
Project 1─* Phase (ordered by `sequence`)
Phase 1─1? PhaseGate   (approvalRequired, approverId, status, decidedAt, decisionNote)
Phase 1─* PhaseDeliverable
```

A phase carries `plannedStart/plannedEnd` and `actualStart/actualEnd` so schedule variance
is measurable (spec §52) rather than inferred.

### 2.4 Work breakdown & tasks

```
Phase 1─* WbsItem
WbsItem *─1? WbsItem (parentId — arbitrary depth)
WbsItem.code  = materialised dotted path ("2.1.3"), unique per project
WbsItem 1─* Task
Task *─1 Project, *─1? Phase, *─1? WbsItem
Task 1─* TaskAssignment *─1 User      (assignee set; the primary assignee is flagged)
Task 1─* TaskDependency (predecessorId, successorId, type FINISH_TO_START)
Task 1─* TaskComment, 1─* TaskAttachment
Milestone *─1 Project, *─1? Phase, *─* Task (MilestoneTask join)
RaciAssignment (projectId, userId, role R|A|C|I, taskId? , wbsItemId?)
```

`WbsItem.code` is stored rather than computed on read because the Gantt and the reports
sort by it constantly; it is recomputed by the service whenever the tree is reordered.

Indexes that matter: `Task(projectId, status)`, `Task(projectId, dueDate)`,
`Task(assigneeId, dueDate)` via `TaskAssignment`, `TaskDependency(successorId)`.

### 2.5 Attendance

```
AttendanceDay (userId, workDate DATE, unique)  ── status, totals (denormalised minutes)
AttendanceDay 1─* WorkSession (startedAt, endedAt?, projectId?, taskId?)
WorkSession   1─* BreakSession (startedAt, endedAt?)
```

Totals on `AttendanceDay` are denormalised for dashboard speed and are recomputed by the
attendance service on every session/break close — never written from the client.
A partial unique index guarantees at most one _open_ work session per user.

### 2.6 Communication

```
Project 1─* Message
Message *─1? Message (parentId → a reply)
Message 1─* MessageAttachment  (file or link, incl. Google Drive)
Message 1─* MessageReaction    unique (messageId, userId, emoji)
Message 1─* MessageMention     → User
PinnedMessage (messageId unique, pinnedById, pinnedAt)
```

`Message.searchVector` is a generated `tsvector` with a GIN index; chat search is a SQL
query, never a client-side scan (spec §32, master prompt §24).

### 2.7 Documents, notes, decisions

```
Document (projectId, category, name, url, fileType, version, phaseId?, taskId?, addedById)
SharedResource is the same table filtered by `kind` ∈ DOCUMENT | LINK | GOOGLE_DRIVE
PersonalNote (userId — never joined into a project query)
ProjectNote  (projectId, authorId, visibility)
DecisionLog  (projectId, phaseId?, taskId?, decidedById, documentId?)
```

`PersonalNote` deliberately has **no** `projectId` column. It cannot be leaked through a
project include because the relation does not exist (business rule 12).

### 2.8 Governance

```
Risk   (projectId, probability, impact, severity GENERATED from the matrix, ownerId, status)
Issue  (projectId, priority, ownerId, status, resolution)
ChangeRequest (projectId, requesterId, status, impact fields, approverId, decidedAt)
```

`Risk.severity` is computed by the domain layer from probability × impact and persisted so
reports can filter on it; the service is the only writer.

### 2.9 Notifications, audit, activity

```
Notification (userId, type, title, body, entity ref, readAt?, channel state)
EmailNotification (notificationId?, to, template, status QUEUED|SENT|FAILED, error?, sentAt?)
NotificationRule (organizationId, type, offsetDays, enabled)
AuditLog (actorId, action, entityType, entityId, oldValue JSONB, newValue JSONB, ip, userAgent)
ActivityLog (projectId, actorId, verb, entityType, entityId, summary)
```

`EmailNotification.status` is only set to `SENT` after the transport resolves. A failure is
recorded with its error (master prompt §67).

`AuditLog` is append-only: no update or delete path exists in any service.

## 3. Referential rules

| Relation                                         | On delete                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Project → children (phases, tasks, messages, …)  | `Cascade` — deleting a project is an admin-only, explicitly-confirmed action |
| User → authored content (messages, notes, audit) | `Restrict` — users are deactivated, not deleted, so history survives         |
| Phase → Task                                     | `SetNull` — a task survives a phase being removed and becomes unphased       |
| WbsItem → child WbsItem                          | `Cascade`                                                                    |
| Task → TaskDependency                            | `Cascade`                                                                    |

## 4. Progress model

One authoritative implementation in `apps/api/src/domain/progress.ts`:

```
task.progress            author: the assignee, 0–100, forced to 100 when COMPLETED
wbsItem.progress         = Σ(task.progress × task.estimatedHours) / Σ(task.estimatedHours)
                           falling back to a simple mean when hours are absent,
                           then rolled up through child WBS items
phase.progress           = rollup of its root WBS items, else of its direct tasks
project.progress         = duration-weighted mean of phase progress
```

Stored progress on WBS/phase/project is a cache, refreshed on every task write inside the
same transaction. It is never the source of truth for correctness checks.
