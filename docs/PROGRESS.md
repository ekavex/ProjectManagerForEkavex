# Ekavist — Progress

Legend: `[x]` complete · `[~]` in progress · `[ ]` not started · `[!]` blocked

| Phase                         | Status |
| ----------------------------- | ------ |
| 0 — Repository & architecture | `[x]`  |
| 1 — Foundation                | `[x]`  |
| 2 — Authentication & users    | `[x]`  |
| 3 — Projects                  | `[x]`  |
| 4 — Waterfall engine          | `[x]`  |
| 5 — WBS & tasks               | `[x]`  |
| 6 — Dependencies & Gantt      | `[x]`  |
| 7 — Dashboards                | `[x]`  |
| 8 — Attendance                | `[x]`  |
| 9 — Notifications             | `[x]`  |
| 10 — Project chat             | `[x]`  |
| 11 — Documents & Drive links  | `[x]`  |
| 12 — Notes & decision log     | `[x]`  |
| 13 — Risks & issues           | `[x]`  |
| 14 — Change requests          | `[x]`  |
| 15 — Reports & Excel import   | `[x]`  |
| 16 — Audit & activity         | `[x]`  |
| 17 — Security                 | `[x]`  |
| 18 — Testing                  | `[x]`  |
| 19 — Performance              | `[x]`  |
| 20 — Production readiness     | `[x]`  |
| — Web application             | `[x]`  |

---

## Test coverage as it stands

| Suite                                                    |      Tests | Result      |
| -------------------------------------------------------- | ---------: | ----------- |
| Unit (`tests/unit`)                                      |         19 | passing     |
| Integration — auth                                       |         20 | passing     |
| Integration — projects                                   |         17 | passing     |
| Integration — waterfall, WBS, tasks, dependencies, Gantt |         28 | passing     |
| Integration — Excel import                               |         12 | passing     |
| Integration — security checklist                         |         19 | passing     |
| Integration — resource paging and progress consistency   |          8 | passing     |
| Permissions — the full matrix                            |        164 | passing     |
| End-to-end (Playwright)                                  | 9 journeys | passing     |
| **API total**                                            |    **287** | **passing** |

`npm run verify` — format check, lint, typecheck, all 287 tests and the build — passes on
a clean tree. The nine Playwright journeys pass against the route-split bundle.

---

## What each phase delivered

**Phase 0.** Read the full 2,679-line specification. The repository held nothing but the
spec, so no existing architecture had to be preserved. Wrote the eight planning documents,
chose the stack (D-001), scaffolded npm workspaces with TypeScript, ESLint, Prettier and a
docker-compose stack for PostgreSQL 16 and Mailpit.

**Phase 1.** Prisma schema (41 models), initial migration, the search and partial-unique
indexes Prisma cannot express, validated environment configuration, structured logging with
secret redaction, the `AppError` model, the Express application, the health endpoint.

**Phase 2.** Argon2id hashing, login with a uniform failure response, rotating refresh
tokens with family revocation on reuse, password reset by emailed token, user and
department management, the RBAC policy layer.

**Phase 3.** Project CRUD, an explicit status transition map, members with project roles,
viewer chat opt-in, a closure checklist derived from live data, project health, soft delete.

**Phase 4.** Phases with the eight-phase default template, reordering, configurable gates,
submit/approve/reject, rework, and the escalation rule when the approver is the submitter.

**Phase 5.** Recursive WBS with dotted-path numbering recomputed on every shape change,
move with cycle rejection, tasks with project-scoped references, assignment restricted to
project members, status and progress coupled, comments, link attachments, the centralised
progress rollup.

**Phase 6.** Finish-to-Start dependencies, cycle detection that names the tasks in the
loop, a predecessor warning with a recorded override, and the Gantt feed with phase bands,
WBS rollup spans, milestones and dependency edges.

**Phases 7 to 16.** Dashboards (company, lead, employee, project), My Work, attendance with
breaks and a database-enforced single open session, the notification engine with
configurable deadline rules and lead digests, project chat with database-side full-text
search, documents and Drive links, personal and project notes, the decision log, risks with
derived severity, issues, change requests with impact analysis and an explicit plan update,
daily/weekly/final reports, the staged Excel importer, global search, audit log and activity
feed.

**Phase 17.** The security checklist from `TEST_STRATEGY.md` turned into 19 executable
tests: headers, request ids, no stack traces, no account enumeration, no project-existence
disclosure, four IDOR cases, SQL- and script-shaped input handled as data, page-size and
sort allow-lists, `javascript:` URLs refused, account lockout, forged tokens, and immediate
effect of deactivation.

**Phase 18.** The permission matrix (164 cases), the Excel importer suite, and nine
Playwright journeys covering the ten scenarios in the specification.

**The web application.** Every screen in the specification's navigation: dashboards, My
Work, projects with fourteen tabs, team, attendance, reports, notifications, settings and
the three administration screens. The Gantt is a purpose-built component with its geometry
in a separate, testable module.

---

## Bugs found and fixed during verification

These were all found by running the thing, not by reading it.

1. **The seed showed 0% against finished work.** It wrote task rows directly and never
   refreshed the derived progress cache. The seed now calls `recomputeProjectProgress`.
2. **A completed phase with no tasks rolled up as 0%.** Phase status now overrides the task
   rollup, with unit tests for all three cases.
3. **`tests/global-setup.ts` hung the whole suite when run detached.** It shelled out
   through `npx`, which waits for a terminal prompt. It now invokes the installed CLI with
   Node directly.
4. **Every filter input rendered full width.** `clsx` concatenates rather than merges, so a
   caller's `w-56` lost to the control's own `w-full`. Fixed with `tailwind-merge`
   (decision D-013); found by looking at the running application.
5. **The add-member dropdown was always empty.** It asked for `pageSize: 200` against a
   server maximum of 100, so the request was rejected and the list silently stayed empty.
   Fixed, and the modal now reports the failure instead of showing nothing.
6. **`/auth/refresh` shared the ten-per-minute credential limit.** The SPA calls it on every
   page load, so a few navigations or a second tab could lock a legitimate person out of
   their own session. Refresh now has its own, far more generous limit; login and the
   password endpoints keep the tight one.
7. **The permission matrix passed for the wrong reasons.** Cases shared mutable state, so
   adding the outsider to a project in one case turned later "outsider may not" cases from
   404 into 403. Every mutating case now creates its own targets.
8. **Milestones had an API and no way to reach them.** They were drawn on the Gantt and
   listed on the dashboards, but nothing in the interface could create one. Added the
   Milestones tab the specification's navigation calls for (section 80).

Seven more were found in Phase 20, by building and running things that had until then
only been written: the Dockerfile's three defects, `npm run verify` failing on a clean
tree, and the three clean-checkout failures that CI found on its first runs. All are
described under Remaining work below.

---

## Remaining work

**Phase 19 — performance.** Done, and verified by execution.

- The `consistency-scan` job recomputes derived progress for every live project at 02:00
  (`JOBS_CONSISTENCY_SCAN_CRON`), writes back whatever had drifted and logs the before and
  after values at warn level. This closes the gap D-006 recorded. It is tested by
  corrupting a value directly in the database and requiring the job to find it.
- `listResources` pages in the database. A `UNION` over the three source tables decides
  the ordering and the page boundary, and only that page is hydrated. The old version read
  up to 500 rows from each table, merged them in memory and sliced the result, which
  truncated silently past the cap.
- Load tested. `npm run load:check --workspace @ekavist/api` builds a project with 4,000
  tasks, 20,000 messages and 6,000 shared resources and times nine reads. Every median is
  under 350 ms, and page 100 of the resource library costs no more than page 1. The table
  is in `docs/TEST_STRATEGY.md` section 6.
- The web bundle is route-split with `React.lazy`. The entry chunk went from 491 kB to
  **57.6 kB**; the project screen, which carries the Gantt, is a 114 kB chunk that nobody
  who stays on their dashboard downloads. Two real problems surfaced while measuring: the
  vendor split named `react-dom`, but the application imports `react-dom/client`, so the
  renderer had been in the entry chunk the whole time; and `socket.io-client` and
  `date-fns` are declared dependencies of `apps/web` that nothing imports.

**Phase 20 — production readiness.** Backups are automated, and the image has been built
and run. One item genuinely remains.

- **Backups are scheduled, and the dumps have been restored.** A `backup` service in
  `docker-compose.yml`, behind a profile, runs busybox `crond` in the same
  `postgres:16-alpine` image as the server (D-015). `ops/backup.sh` takes a custom-format
  dump, verifies its table of contents, and applies retention only after the dump
  succeeded. `ops/restore-check.sh` restores the newest dump into a throwaway database and
  counts rows. Both were run against the development database, and a container scheduled
  at `* * * * *` was watched until cron actually fired it.
- **The image was built and run, and it was broken in three ways.** All three were
  invisible until something executed it:
  1. `tsconfig.base.json` was never copied into the build stage, so `tsc` failed with
     TS5083 and then a cascade of type errors from the defaults it fell back to.
  2. `prisma generate` ran in a stage with no OpenSSL installed, so it chose the
     `debian-openssl-1.1.x` query engine while the runtime stage has 3.0. The container
     started, then died on its first database query.
  3. The image shipped the Prisma CLI, TypeScript and the `deepmerge-ts` advisory of
     D-014, despite the comment at the top of the Dockerfile saying that it did not.
     `@prisma/client` declares the CLI as an _optional peer_ dependency and npm installs
     optional peers by default, so `--omit=dev` alone does not drop them.

  Fixed, rebuilt, and run against PostgreSQL 16 in a production configuration: it refuses
  to start without HTTPS and secure cookies, reports healthy through its own
  `HEALTHCHECK`, signs in, and serves the project list, the rewritten resource query, the
  Gantt feed, the dashboard, the task list and the chat. `node_modules` went from 327 MB
  to 164 MB.

- **`npm run verify` did not pass on a clean tree.** The web workspace has no tests and
  `vitest run` exits 1 when it finds none, so the gate the README documents failed at its
  last step. Fixed with `--passWithNoTests`, and the absence of component tests is now
  stated in `docs/TEST_STRATEGY.md` rather than hidden behind a failing command.
- **The CI workflow has run on GitHub Actions, and it is green.** The repository was
  pushed to `ekavex/ProjectManagerForEkavex` on 2026-09-28 and the workflow passed against
  commit `b209e76` — all twenty steps, including the Playwright journeys, the image build,
  the health check, and the assertion that the runtime image contains neither
  `node_modules/typescript` nor `node_modules/prisma`.

  It took four runs, because the first three found real defects. All three are the same
  bug wearing different clothes: **this machine carried build state that a clean checkout
  does not have**, and every local verification in this project had been standing on it.

  1. **The Prisma client was never generated.** `npm ci` does not generate it and
     `prisma migrate deploy` — unlike `migrate dev` — does not either, so
     `apply-search-indexes.ts` imported a client that had never been built. It passed here
     only because `node_modules/.prisma` was left over from earlier runs. `db:deploy` and
     the test bootstrap now generate it first.
  2. **`packages/shared/dist` was never built.** `@ekavist/shared` resolves to its `dist`,
     and nothing built it before the typecheck step, so every file importing it failed
     TS2307 and the resulting `any` types produced another two hundred cascade errors.
     `typecheck` and `test` now build it first, and CI builds it explicitly after install.
  3. **The lockfile was pruned to Windows.** `package-lock.json` recorded win32 binaries
     only — for rollup, for esbuild and for Tailwind's oxide — so `npm ci` on Linux
     installed no native binary and vitest died on startup. Regenerating it added 102
     platform binaries, removed nothing, and moved two patch versions.

  None of these could have been found by reading the code, and none of them would have
  been found by running the gate again on this machine. The workflow paid for itself on
  its first execution.

**Known gaps, deliberately.**

- No Google Drive API integration; Drive links are labelled by host and nothing claims a
  connection (D-007). Other integrations that need an outside service — Google or
  Microsoft sign-in, SSO, mobile push, calendar sync, AI features — are not built.
- Project chat has no live delivery in the browser (the Socket.IO server exists, the web
  app does not connect to it) and no reply or @mention controls, although the API
  supports both. Left for a later round by decision.
- No file uploads beyond the Excel importer, which parses in memory and stores nothing.
- The scheduler assumes a single API replica (D-004).
- No concurrency or soak testing. The load check is one client against an idle server.

**Accepted risk.** `npm audit` reports `deepmerge-ts` via the Prisma CLI. It is a
devDependency, absent from the runtime image, and merges only this repository's own
configuration. Recorded as D-014, together with the correction to what that entry used to
claim about production installs.

---

## Second round: closing the gap with the specification

A review against the specification found features with an API but no screen, and
specification items not yet built. Everything that does not need an outside service was
built in this round.

- **Screens for existing APIs:** adding and removing dependencies on the task panel; a
  project Settings tab (details, status changes, archive and restore); a Closure tab
  (checklist, handover note, lessons learned, close); the Excel importer with column
  mapping, validation and preview; switching the running work session between tasks.
- **Project lifecycle:** a live project is completed only through the closure checklist
  (business rule 19); lessons learned have their own endpoints; a new project can start
  from a copy of another project's plan, shifted to the new start date.
- **Tasks:** completion criteria per project (business rule 7); all four dependency types
  enforced as overridable warnings and drawn correctly on the Gantt; `PATCH /tasks/:id`
  now refuses `status`/`progress` instead of ignoring them.
- **Gantt:** drag a bar, or either end, to reschedule; arrow keys for keyboard users;
  tasks with a single date drawn as one-day bars instead of being left off.
- **Planning:** workstream breakdown and earned value (SPI, CPI, EAC, in hours) on the
  project dashboard; capacity by person and week; a calendar of deadlines, milestones,
  phase dates, leave and holidays.
- **People:** leave requests with balances, manager or administrator approval, attendance
  marked automatically, and the tasks affected shown; editing a person after creation,
  including their manager.
- **Administration:** organisation settings, public holidays, and a role-permission
  editor.
- **Security:** two-factor sign-in (TOTP, with ten single-use recovery codes, and an
  administrator reset).
- **Notifications:** the header bell polls, and browser notifications are available.
- **Exports:** CSV for tasks, risks, issues, change requests, decisions, milestones,
  workload and attendance, with formula injection defused.

Fixed along the way: sorting the task list by any non-date column returned 500; the
workload report's `projectId` filter widened visibility to projects the caller is not on;
the holiday lookup ignored the organisation; three Playwright journeys had hard-coded
dates that had gone stale. The test count is now 344 API tests, 5 web unit tests and 12
Playwright journeys.
