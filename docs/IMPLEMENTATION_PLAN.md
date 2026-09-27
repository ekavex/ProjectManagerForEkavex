# Ekavist — Implementation Plan

Phases are built **vertically**: database → service → API → UI → permissions → tests,
then the next phase. A phase is not left until its tests, lint, typecheck and build pass.

| #   | Phase                     | Contents                                                                                                                             | Exit criteria                                                                  |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0   | Repository & architecture | Workspaces, TS config, lint, format, docs, docker-compose for Postgres                                                               | `npm install`, `npm run typecheck`, `npm run lint`, `npm run build` all clean  |
| 1   | Foundation                | Prisma schema, migrations, env config, logger, error model, Express app, health route, test harness                                  | Migration applies to a real DB; health endpoint covered by an integration test |
| 2   | Auth & users              | Argon2 hashing, login/refresh/logout, password reset, user CRUD, departments, RBAC policy layer, protected routes, SPA shell + login | Permission matrix tested per role; disabled account rejected                   |
| 3   | Projects                  | Project CRUD, status lifecycle, members, project roles, objectives, deliverables                                                     | A member cannot read a project they are not on (tested)                        |
| 4   | Waterfall engine          | Phases with default template, phase status, phase gates, approval / rejection / rework                                               | Next phase cannot start while a gate blocks it (tested)                        |
| 5   | WBS & tasks               | Recursive WBS with auto numbering, tasks, comments, attachments, centralised progress rollup                                         | Completing a task forces 100%; parent progress recomputes                      |
| 6   | Dependencies & Gantt      | Finish-to-Start dependencies, cycle rejection, predecessor warnings, Gantt API + interactive chart                                   | `A→B→C→A` rejected; Gantt renders live data with dependency arrows             |
| 7   | Dashboards                | Company, project, project-lead and employee dashboards, work distribution, project health                                            | Every number traced to a query; zero hardcoded values                          |
| 8   | Attendance                | Work sessions, breaks, daily attendance, overlap prevention, history                                                                 | Duplicate open session rejected; break time excluded from work duration        |
| 9   | Notifications             | Event → notification engine, in-app feed, email templates, deadline/overdue scheduler, lead escalation                               | Scheduler produces exactly one reminder per rule per task per day              |
| 10  | Project chat              | Messages, replies, reactions, mentions, pinning, attachments and links, Socket.IO delivery                                           | Non-member cannot read or post (tested)                                        |
| 11  | Documents & Drive links   | Categorised documents, external/Drive links, shared resource library                                                                 | Link metadata stored; no fake "Drive connected" state                          |
| 12  | Notes & decision log      | Personal notes (private), project notes, decision log                                                                                | Personal notes never returned by any project endpoint (tested)                 |
| 13  | Risks & issues            | Risk register with severity matrix, issue register                                                                                   | Severity derived, not hand-entered                                             |
| 14  | Change requests           | Request → impact analysis → review → decision, plan update on approval                                                               | Rejected CR leaves the plan untouched                                          |
| 15  | Reports                   | Daily, weekly and final project reports from live data; Excel import pipeline                                                        | Import rejects invalid rows before writing anything                            |
| 16  | Audit & activity          | Audit log with before/after, project activity feed and timeline                                                                      | Every mutating service writes exactly one audit row                            |
| 17  | Security                  | Rate limiting, helmet, CSRF for cookie flows, upload rules, IDOR sweep                                                               | Security checklist in `TEST_STRATEGY.md` fully ticked                          |
| 18  | Testing                   | Fill unit/integration/permission gaps, Playwright E2E for critical flows                                                             | All suites green                                                               |
| 19  | Performance               | Indexes, pagination everywhere, N+1 sweep, chat and Gantt load tests                                                                 | No endpoint returns an unbounded collection                                    |
| 20  | Production readiness      | `.env.example`, README, build, seed separation, backup notes                                                                         | A clean clone runs from the README alone                                       |

## Deviation from the master prompt's ordering

None in substance. Phase 16 (audit) is _implemented incrementally from Phase 3 onward_
rather than bolted on at the end, because retrofitting audit calls into finished services
is exactly the kind of duplication §46 warns about. Phase 16 remains as the point where
the log is verified for completeness and the feed UI is built.
