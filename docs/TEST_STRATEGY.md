# Ekavist — Test Strategy

## 1. Levels

| Level       | Tool                               | Scope                                                                                                                                                         | Location                     |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Unit        | Vitest                             | Pure domain functions: progress rollup, overdue detection, dependency cycle detection, risk severity, schedule variance, WBS renumbering, timezone conversion | `apps/api/tests/unit`        |
| Integration | Vitest + Supertest + real Postgres | Route to service to database                                                                                                                                  | `apps/api/tests/integration` |
| Permission  | Vitest + Supertest                 | Every endpoint against every role                                                                                                                             | `apps/api/tests/permissions` |
| Component   | Vitest + Testing Library           | UI logic with real branching: Gantt geometry, chat filters, forms                                                                                             | `apps/web/src`               |
| E2E         | Playwright                         | Critical journeys against a running stack                                                                                                                     | `e2e/`                       |

Integration tests run against a real PostgreSQL database (`ekavist_test`), never a mock or
SQLite, because the schema depends on Postgres features: `tsvector` search, partial unique
indexes, and recursive CTEs.

## 2. Required end-to-end journeys (spec section 74)

1. Admin logs in, creates a user, creates a project, assigns a project lead.
2. Lead adds a member, creates phases, builds a WBS, creates and assigns a task.
3. Lead creates a Finish-to-Start dependency; the app rejects a cycle.
4. Member logs in, starts work, sees the task, updates progress, completes it, ends work.
5. Overdue detection: a past-due task is reported overdue and the lead is notified.
6. Phase gate: the next phase cannot start until the gate is approved.
7. Chat: send, reply, react, attach a link, pin, search, filter.
8. Attendance: start, break, end; a second concurrent start is rejected.
9. Viewer reads permitted data and is refused on every write.
10. Gantt renders real tasks with dependency arrows and reflects a date change.

## 3. Rules

- No test is skipped or disabled to make a build pass. A broken test is fixed, or the
  feature is marked incomplete in `PROGRESS.md`.
- Every fixed bug gets a regression test at the lowest level that reproduces it.
- Permission tests assert the status code, not merely the absence of data, so a route
  that answers `200 []` where it should answer `403` still fails.
- Fixtures are built through the service layer wherever practical, so a test cannot set up
  a state the application itself would refuse to create.

## 4. Security checklist, verified in Phase 17

- [ ] Every `/projects/:id/**` route refuses a non-member with 403 or 404
- [ ] No endpoint accepts an id that reaches another project's row (IDOR)
- [ ] Password hashes, tokens and secrets absent from every response body and log line
- [ ] Rate limits on login, password reset and message posting
- [ ] Refresh-token rotation revokes the whole family when a rotated token is reused
- [ ] Uploads: extension and MIME allow-list, size cap, stored outside the web root
- [ ] `helmet` headers present, CORS restricted to `APP_URL`
- [ ] Refresh and logout cookies are `SameSite=Strict`; state-changing routes authenticate
      with the bearer token rather than the cookie
- [ ] All user text renders as text; `dangerouslySetInnerHTML` appears nowhere
- [ ] Prisma parameterises every query; the raw queries for chat search and WBS recursion
      use tagged templates with bound parameters

---

## 5. What the checklist looks like now

The security checklist above is no longer a list of intentions: every line is an
executable test in `apps/api/tests/integration/security.test.ts`, and the permission
matrix in `apps/api/tests/permissions/matrix.test.ts` covers every project endpoint
against every role.

- [x] Every `/projects/:id/**` route refuses a non-member — 404 for an outsider, so the
      API never confirms that an id exists; 403 for a member who lacks the permission
- [x] No endpoint accepts an id that reaches another project's row — four IDOR cases:
      a task id, a phase id, an assignee who is not a member, and another person's
      notification
- [x] Password hashes and tokens absent from every response body; the `User` select lists
      are explicit and the logger redacts by path
- [x] Rate limits on login, password reset and message posting — with refresh on its own,
      more generous limit, because it is not a credential guess
- [x] Refresh-token rotation revokes the whole family when a rotated token is reused
- [x] `helmet` headers present; CORS restricted to `APP_URL`
- [x] Refresh and logout cookies are `SameSite=Strict`; every state-changing route
      authenticates with the bearer token rather than the cookie
- [x] User text renders as text; `dangerouslySetInnerHTML` appears nowhere in `apps/web`
- [x] Prisma parameterises every query; the raw chat-search query uses a tagged template
      with bound parameters, and a SQL-shaped task name is stored and searched as data
- [x] An account locks after repeated failures, a forged token is refused, and
      deactivating someone takes effect on their next request rather than at token expiry

**Not covered.** Uploads are out of scope because nothing is uploaded: the only file the
API accepts is the Excel workbook the importer parses in memory and discards
(decision D-007). There is no penetration test and no dependency-scanning gate beyond
`npm audit` in CI.

---

## 6. Performance, verified in Phase 19

Two additions, both executable rather than asserted in prose.

**`apps/api/tests/integration/performance.test.ts`** covers the two behaviours Phase 19
changed. The resource library now pages across three tables in the database, so the tests
assert the things an in-memory merge got right only by accident: global ordering rather
than per-source, page two disjoint from page one, a total that counts the library rather
than the page, and search and pin filters that still reach every source. The
`consistency-scan` job is tested by writing a wrong progress value straight into the
database — the shape of the gap D-006 recorded — and requiring the job to find it, correct
it, report it, and then have nothing left to do on the second run.

**`apps/api/scripts/load-check.ts`** is run on demand (decision D-016), not in CI. It
seeds 4,000 tasks, 20,000 messages, 400 WBS items and 6,000 shared resources, then times
nine reads five times each through the HTTP layer. Measured on the development machine
against PostgreSQL 16 in Docker, medians were:

| Read                  | Median |
| --------------------- | -----: |
| chat: newest page     |  61 ms |
| chat: page 20         |  62 ms |
| chat: search          | 134 ms |
| resources: first page |  79 ms |
| resources: page 100   |  53 ms |
| resources: search     |  32 ms |
| Gantt feed            | 268 ms |
| task list             |  33 ms |
| project dashboard     | 338 ms |

Deep pagination costs no more than the first page, which is the property the rewrite
existed to get. These are one machine's numbers, not a guarantee; the script exists so the
same measurement can be taken against a real deployment.

**Not covered.** No concurrency or soak testing: every number above is a single client
against an idle server, so it says nothing about behaviour under many simultaneous users.
The web workspace still has no component tests — the level exists in the table in section
1 and is unpopulated — so UI behaviour is covered only by the Playwright journeys.
