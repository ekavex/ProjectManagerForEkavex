# Ekavist — Decision Log

Each entry records a choice that was not dictated by the specification, the reasoning, and
what would cause it to be revisited.

---

### D-001 — Express + React SPA rather than Next.js

**Date:** 2026-09-27
**Context:** The repository was empty; the spec (section 60) leaves technology open but
requires real-time chat (section 63) and an architecture that admits future mobile apps
(section 87).
**Decision:** A TypeScript monorepo with `apps/api` (Express 5 + Prisma + Socket.IO) and
`apps/web` (React + Vite), sharing `packages/shared`.
**Why:** Socket.IO needs a long-lived server, which removes most of the benefit of a
Next.js hosting model. An explicit versioned REST surface is a clearer contract for a
future mobile client than route handlers colocated with pages.
**Revisit if:** real-time moves to a managed service and server-rendered marketing pages
become a requirement.

---

### D-002 — Single organisation, but an `Organization` row exists

**Date:** 2026-09-27
**Context:** The spec describes one company (section 7). Building full multi-tenancy now
would be over-engineering (master prompt section 3).
**Decision:** One `Organization` row, seeded at install. Every user and project references
it. Queries do not filter by it yet.
**Why:** Adding the column later means a migration plus an audit of every query. Adding
the filter later is a scoping change in the repository layer.

---

### D-003 — UTC timestamps, organisation timezone for calendar values

**Date:** 2026-09-27
**Context:** Master prompt sections 49 and 50; attendance and due dates are calendar
concepts, not instants.
**Decision:** Instants are `timestamptz` in UTC. Calendar values (`AttendanceDay.workDate`,
`Task.dueDate`) are `DATE` and interpreted in `Organization.timezone`. All conversion goes
through `apps/api/src/domain/time.ts`. The UI renders in `User.timezone`.
**Why:** "Overdue" must mean "the working day ended in the company's timezone", not "the
server's clock passed midnight".

---

### D-004 — In-process cron scheduler behind a job definition

**Date:** 2026-09-27
**Context:** Deadline reminders, overdue escalation, daily and weekly summaries, email
delivery (master prompt section 48).
**Decision:** `node-cron` inside the API process. Each job is a `JobDefinition` — a name, a
cron expression, a function that derives the logical window, and the work itself — and
`runJobOnce` claims that window by inserting a `ScheduledJobRun` row. The unique constraint
on `(jobName, runKey)` is the lock, so a restart cannot make a daily job fire twice.
**Why:** Redis plus BullMQ is real operational weight for an internal tool with tens of
users. The job functions know nothing about cron, so swapping in a queue later means
replacing `scheduler.ts` and nothing else.
**Revisit if:** the API runs more than one replica, at which point the run table's advisory
lock becomes the coordination point, or a real queue is introduced.

---

### D-005 — A purpose-built Gantt component

**Date:** 2026-09-27
**Context:** Spec section 22 needs WBS grouping, phase bands, dependency arrows,
milestones, expand/collapse and day/week/month zoom, all driven by live data.
**Decision:** A local React + SVG component fed by `GET /projects/:id/gantt`, with the
timeline geometry isolated in a pure, unit-tested module.
**Why:** The free Gantt libraries either do not model phase bands and gates or require
adapting the data twice. The geometry is roughly two hundred lines and is testable.

---

### D-006 — Progress is derived, and cached in one place

**Date:** 2026-09-27
**Context:** Master prompt section 46 forbids divergent progress and overdue calculations.
**Decision:** `domain/progress.ts` is the only implementation. Task progress is authored;
WBS, phase and project progress are derived. Derived values are written back inside the
same transaction as the task write purely as a read cache.
**Why:** Dashboards, Gantt and reports all read the cache and therefore always agree.
**The gap this left, and how it is closed.** The cache is only refreshed by the service
that changes a task, so data written directly to the database bypassed it — which is how
the seed initially displayed 0% against finished work. Phase 19 added the
`consistency-scan` job (`apps/api/src/jobs/consistency.job.ts`, 02:00 daily by
`JOBS_CONSISTENCY_SCAN_CRON`): it recomputes every live project, writes back whatever had
drifted, and logs the before and after values at warn level. Repeated drift on the same
project is then a bug somewhere else, and the log is where that becomes visible. It is
asserted in `tests/integration/performance.test.ts` by writing a wrong number straight
into the database and requiring the job to find it.

---

### D-007 — Files are references, not bytes, in version 1

**Date:** 2026-09-27
**Context:** Spec sections 36 and 65 recommend Google Drive for storage.
**Decision:** Documents, task attachments and chat attachments store a URL plus metadata.
Nothing is uploaded: the only file the API accepts is the Excel workbook the importer
parses in memory and discards. A link whose host is Google Drive is labelled as such, and
that label is applied by the server from the URL, so a client cannot mislabel a resource.
There is no Google Drive API integration and no screen that claims one.
**Why:** Master prompt section 67 forbids a fake "Drive connected" state; the OAuth
integration is explicitly not a blocker for the core product.

---

### D-008 — Phase gate approver resolution

**Date:** 2026-09-27
**Context:** The spec does not say who approves when the gate's approver is the person who
submitted it.
**Decision:** A gate defaults its approver to the project lead. When the approver and the
submitter are the same person, approval requires a `SUPER_ADMIN`.
**Why:** The simplest behaviour consistent with the product; a gate that a person can
approve for themselves is not a control.

---

### D-009 — Excel import is staged, never partial

**Date:** 2026-09-27
**Context:** Master prompt section 34; spec section 68.
**Decision:** An upload produces an `ImportJob` with parsed rows and per-row validation
results. Nothing is written to project tables until the user confirms, and the confirm step
runs inside one transaction that rolls back entirely on any error.
**Why:** A half-imported project tracker is worse than a rejected one.

---

### D-010 — Soft deletion only where history depends on it

**Date:** 2026-09-27
**Context:** Master prompt section 7 says "soft deletion where appropriate".
**Decision:** `deletedAt` on `Project`, `Task`, `Message` and `Document` only. Every other
entity is hard-deleted or status-flagged.
**Why:** Universal soft deletion means every query must remember the filter, and one
forgotten filter is a data-leak bug. Limiting it to four tables keeps the rule memorable
and is enforced by a shared `notDeleted` helper.

---

### D-011 — `uuid` pinned above the version `exceljs` asks for

**Date:** 2026-09-27
**Context:** `exceljs` depends on `uuid@8`, which carries a published advisory
(GHSA-w5hq-g745-h8pq: a missing buffer bounds check). The only "supported" fix `npm audit`
offers is downgrading `exceljs` to 3.4.0, which is far older and loses features the
importer uses.
**Decision:** An npm `overrides` entry forces `uuid@^11.1.1` for the whole tree. `exceljs`
calls `require('uuid').v4`, which uuid 11 still provides through its CommonJS entry point;
this was verified rather than assumed, and the importer's tests exercise the code path.
**Result:** `npm audit --omit=dev` reports zero vulnerabilities.
**Revisit if:** `exceljs` publishes a release that depends on a current `uuid`, at which
point the override can simply be deleted.

---

### D-012 — Argon2 parameters are reduced under `NODE_ENV=test`

**Date:** 2026-09-27
**Context:** The integration and permission suites sign in dozens of accounts. At the
production parameters (19 MiB, three passes) password hashing dominated the run: roughly
eight seconds per test, most of it spent proving that argon2 is slow.
**Decision:** `src/lib/password.ts` uses the minimum parameters argon2 accepts when
`NODE_ENV=test`, and the production values otherwise. The tests verify login _logic_, not
the cost factor.
**Why this is safe:** the branch is on `NODE_ENV`, which `env.ts` validates, and a
deployed environment never sets it to "test". Hashes already in a database carry their own
parameters, so verification is unaffected either way.
**Effect:** the integration suite went from roughly eight seconds per test to under three.

---

### D-013 — Tailwind classes are merged, not concatenated

**Date:** 2026-09-27
**Context:** Passing `className="w-56"` to a control whose base styles include `w-full`
produced whichever rule the generated stylesheet happened to order last. In practice every
filter input rendered full width, which was found by looking at the running application
rather than by reading the code.
**Decision:** `lib/cn.ts` wraps `clsx` with `tailwind-merge`, and every component uses it.
A caller's `className` now reliably overrides the component's default for the same
property, which is what a `className` prop is for.

---

### D-014 — The Prisma CLI's `deepmerge-ts` advisory is accepted, not patched

**Date:** 2026-09-27
**Context:** `npm audit` reports GHSA-ggr8-5vv4-36mx (stack exhaustion in `deepmerge-ts`
below 8.0.0) reaching the tree through `prisma` → `@prisma/config` → `deepmerge-ts@7.1.5`.
**What was tried:** an npm `overrides` entry forcing `deepmerge-ts@^8`. npm silently keeps
7.1.5 regardless, so the override was removed rather than left in the manifest pretending
to do something. `npm audit fix --force` resolves it by downgrading `prisma` to 6.12.0,
which is a regression, not a fix.
**Decision:** accept it, and record why.

- `prisma` is a **devDependency**: the CLI runs during development and deployment
  (`migrate deploy`), never inside the running server. The server uses `@prisma/client`,
  which does not depend on `deepmerge-ts`.
- The vulnerability is stack exhaustion when merging a recursive object graph. The only
  objects `@prisma/config` merges are this repository's own Prisma configuration and CLI
  flags — never anything a user of Ekavist supplies.
- The runtime image does not contain the package.

**Corrected in Phase 20.** The third point used to read "a production image built with
`npm ci --omit=dev` does not contain the package at all". Building the image for the first
time showed that was false: `@prisma/client` declares the `prisma` CLI as an _optional
peer_ dependency, npm installs optional peers by default, and the CLI — with TypeScript
and `deepmerge-ts` behind it — was being shipped inside the runtime image. The deps stage
now runs `npm ci --omit=dev --omit=optional`, which is what makes the claim true; it is
asserted by a CI step that fails if `node_modules/typescript` or `node_modules/prisma`
exists in the image. Not `--omit=peer` as well: that also drops packages installed to
satisfy a genuine peer range, `date-fns` among them, and the server dies on its first
import.

**Revisit when:** Prisma ships a release whose `@prisma/config` depends on
`deepmerge-ts@^8`. At that point this entry can be deleted along with the note in the
README.

---

### D-015 — Backups run in a sidecar container, not in the API

**Date:** 2026-09-27
**Context:** Phase 20. The README described scheduling backups; nothing scheduled them.
**Decision:** a `backup` service in `docker-compose.yml`, behind a profile, running
busybox `crond` in the same `postgres:16-alpine` image as the server. It runs
`ops/backup.sh` (custom-format `pg_dump`, table-of-contents verified, retention applied
only after a successful dump) and `ops/restore-check.sh` restores the newest dump into a
throwaway database on demand.
**Why:** the same image means `pg_dump` always matches the server version, which is the
usual way a team finds out at restore time that its backups were never usable. Keeping it
out of the API process means a backup cannot be skipped because the application is down,
and it does not inherit the single-replica constraint of D-004. `crond` rather than a
scheduler library because the container has exactly one job.
**Verified by:** running it. A dump was taken against the development database, listed,
restored into a scratch database and row-counted; a container scheduled at `* * * * *`
was watched until cron fired it.
**Revisit if:** the database moves to a managed service with its own point-in-time
recovery, at which point this becomes redundant rather than wrong.

---

### D-016 — The load check is a script, not a CI gate

**Date:** 2026-09-27
**Context:** Phase 19 required evidence that a large chat history and a Gantt with
thousands of bars are actually usable.
**Decision:** `apps/api/scripts/load-check.ts` seeds a deliberately oversized project,
times nine reads through the HTTP layer and fails if any median exceeds a budget. It is
run on demand, not in CI.
**Why:** it takes minutes and its numbers depend on the machine, so in CI it would either
be flaky or have a budget so loose it asserted nothing. Run against a real deployment it
answers the question that matters — does this stay usable at ten times the expected size.
**Revisit if:** a performance regression reaches production. The budget then belongs in a
nightly job against a fixed machine, not in the pull-request gate.
