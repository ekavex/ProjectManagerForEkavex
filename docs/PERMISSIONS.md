# Ekavist — Permissions

## 1. Two independent axes

1. **Organisation role** on `User.role`: `SUPER_ADMIN`, `PROJECT_LEAD`, `TEAM_MEMBER`, `VIEWER`.
   Grants organisation-wide capability (create users, create projects, read all attendance).
2. **Project role** on `ProjectMember.projectRole`: `LEAD`, `MEMBER`, `VIEWER`.
   Grants capability _inside one project_.

A user whose organisation role is `PROJECT_LEAD` has no rights on a project they do not
lead. `SUPER_ADMIN` bypasses project membership for reads, and for writes except where a
rule says otherwise (it cannot post a chat message as another user, for instance).

## 2. Permission strings

Format `{resource}:{action}`. The full list is seeded into `RolePermission`.

```
user:read user:create user:update user:deactivate
department:manage
org:settings org:notification-rules audit:read
project:create project:read project:update project:archive project:delete
member:add member:remove member:update
phase:create phase:update phase:delete phase:approve
wbs:create wbs:update wbs:delete
task:create task:update task:delete task:assign
task:update-own-progress task:comment task:attach
dependency:manage milestone:manage raci:manage
chat:read chat:post chat:pin chat:delete-any
document:read document:create document:update document:delete
note:project-read note:project-write
decision:manage risk:manage issue:manage
change-request:create change-request:decide
report:read report:export
attendance:read-own attendance:read-team attendance:read-all
import:run project:close
leave:manage role:manage
```

## 3. Organisation-role matrix

| Permission group                             | SUPER_ADMIN | PROJECT_LEAD | TEAM_MEMBER | VIEWER |
| -------------------------------------------- | :---------: | :----------: | :---------: | :----: |
| user:_, department:manage, org:_, audit:read |     yes     |      no      |     no      |   no   |
| project:create, project:delete               |     yes     |      no      |     no      |   no   |
| project:read across all projects             |     yes     |      no      |     no      |   no   |
| leave:manage, role:manage                    |     yes     |      no      |     no      |   no   |
| attendance:read-all                          |     yes     |      no      |     no      |   no   |
| attendance:read-team                         |     yes     | own projects |     no      |   no   |
| attendance:read-own                          |     yes     |     yes      |     yes     |  yes   |
| report:read across all projects              |     yes     |      no      |     no      |   no   |

Everything else is decided by the project role.

## 4. Project-role matrix

| Permission                                         |     LEAD     |    MEMBER    |    VIEWER    |
| -------------------------------------------------- | :----------: | :----------: | :----------: |
| project:read                                       |     yes      |     yes      |     yes      |
| project:update, project:archive, project:close     |     yes      |      no      |      no      |
| member:add, member:remove, member:update           |     yes      |      no      |      no      |
| phase:create, phase:update, phase:delete           |     yes      |      no      |      no      |
| phase:approve                                      | yes (note 1) |      no      |      no      |
| wbs:create, wbs:update, wbs:delete                 |     yes      |      no      |      no      |
| task:create, task:update, task:delete, task:assign |     yes      |      no      |      no      |
| task:update-own-progress                           |     yes      | yes (note 2) |      no      |
| task:comment, task:attach                          |     yes      |     yes      |      no      |
| dependency:manage, milestone:manage, raci:manage   |     yes      |      no      |      no      |
| chat:read                                          |     yes      |     yes      | yes (note 3) |
| chat:post                                          |     yes      |     yes      |      no      |
| chat:pin                                           |     yes      | yes (note 4) |      no      |
| chat:delete-any                                    |     yes      |      no      |      no      |
| document:read                                      |     yes      |     yes      |     yes      |
| document:create, document:update                   |     yes      |     yes      |      no      |
| document:delete                                    |     yes      |      no      |      no      |
| note:project-read                                  |     yes      |     yes      |     yes      |
| note:project-write                                 |     yes      |     yes      |      no      |
| decision:manage, risk:manage, issue:manage         |     yes      |      no      |      no      |
| change-request:create                              |     yes      |     yes      |      no      |
| change-request:decide                              | yes (note 1) |      no      |      no      |
| report:read                                        |     yes      |     yes      |     yes      |
| report:export                                      |     yes      |      no      |     yes      |
| import:run                                         |     yes      |      no      |      no      |

**Note 1.** Only when the phase gate names them as approver, or they are the project lead
and no explicit approver is set. A gate whose approver is also the submitter must be
approved by a `SUPER_ADMIN` instead.

**Note 2.** Only on a task they are assigned to, and only the status, progress and
actual-hours fields.

**Note 3.** A viewer sees the channel only when `ProjectMember.canReadChat` is set
(spec section 6.4, "view selected chat channels if allowed").

**Note 4.** Members may pin, and may unpin only what they pinned. Leads may unpin anything.

## 5. Always-private data

| Data                                        | Rule                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PersonalNote`                              | Readable and writable only by its `userId`. The table has no project relation, so it cannot be reached through a project include. |
| Password hash, reset tokens, refresh tokens | Never selected into any DTO. Prisma select lists on `User` are explicit; selecting the whole row is banned.                       |
| Another user's attendance                   | Requires `attendance:read-team` plus a shared project, or `attendance:read-all`.                                                  |
| Audit log                                   | `audit:read` only.                                                                                                                |

## 6. Enforcement

- `requireAuth` attaches `req.actor` with id, organisation role and permission set.
- `requirePermission("user:create")` performs the organisation-level check.
- `requireProjectPermission("task:create")` loads the caller's `ProjectMember` row for
  `req.params.id`, merges organisation and project grants, and answers `404` when the
  caller cannot see the project at all, so the API never confirms that an id exists.
- Services call `assertCanMutateProject(project)`, which additionally rejects writes to an
  `ARCHIVED` project for everyone including admins, except the unarchive operation.
- Object-level ownership (editing your own comment or note) is checked in the service
  after the row is loaded, because the owner is not known at middleware time.

## 7. Verification

`apps/api/tests/permissions/` walks the full matrix: for every endpoint and every role it
asserts the expected status code. An endpoint with no matrix entry fails the suite.

## Additions after the first release

- **Administrators always hold every permission.** `loadOrgPermissions` returns the whole
  vocabulary for `SUPER_ADMIN` regardless of stored rows, so permissions added later (such
  as the two below) reach existing administrators, and nobody can lock themselves out of
  the role editor. Their row is shown as read-only in Administration → Roles.
- **`role:manage`** — edit the organisation-wide grants of the other roles
  (`PUT /organization/roles/:role`). Project-scoped rights still come from the person's
  role in each project and are not edited there.
- **`leave:manage`** — see and decide anyone's leave. Without it, a person may decide the
  requests of the people whose `managerId` is theirs, and nobody decides their own.
- **Organisation settings and holidays** use the existing `org:settings`.
- **Project lessons learned** use `project:close`; they may be added while the project is
  live or completed, not once it is archived or cancelled.
- **Project exports** (`GET /projects/:id/export/:dataset`) need `report:export`. The
  workload and attendance CSVs are scoped exactly like their screens.
- **Capacity** (`GET /reports/capacity`) needs `report:read`, `attendance:read-team` or
  `attendance:read-all`; leads see the members of projects they lead, administrators and
  `attendance:read-all` holders see everyone.
