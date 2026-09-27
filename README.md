# Ekavist

A project and team management platform: one place for projects, Waterfall phases, work
breakdown, tasks, dependencies, Gantt, attendance, chat, documents, notes, risks, issues,
change requests and reports.

Built from `Ekavist_Project_Specification.md`, which remains the source of truth for what
the product should do.

---

## Contents

- [What is here](#what-is-here)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Everyday commands](#everyday-commands)
- [Testing](#testing)
- [Project layout](#project-layout)
- [How it fits together](#how-it-fits-together)
- [Deploying](#deploying)
- [Troubleshooting](#troubleshooting)

---

## What is here

| Area                                                       | State                  |
| ---------------------------------------------------------- | ---------------------- |
| Authentication, users, departments, RBAC                   | Working                |
| Projects, members, status lifecycle, closure               | Working                |
| Waterfall phases and configurable phase gates              | Working                |
| WBS with automatic numbering                               | Working                |
| Tasks, assignment, progress, comments, link attachments    | Working                |
| Finish-to-Start dependencies with cycle rejection          | Working                |
| Interactive Gantt                                          | Working                |
| Company, lead, project and employee dashboards             | Working                |
| Attendance, work sessions and breaks                       | Working                |
| Notification engine, deadline rules, email outbox          | Working                |
| Project chat with database-side search, pins and reactions | Working                |
| Documents and Google Drive links                           | Links only — see below |
| Personal and project notes, decision log                   | Working                |
| Risks, issues, change requests                             | Working                |
| Daily, weekly and project-completion reports               | Working                |
| Excel import (preview, then confirm)                       | Working                |
| Audit log and activity feed                                | Working                |

**Not built, and not pretending to be.** There is no Google Drive API integration: a Drive
link is recognised by its host and labelled, nothing more (decision D-007). File uploads
are limited to the Excel importer; documents and attachments are links. Nothing in the
interface claims a connection that does not exist.

---

## Requirements

- **Node.js 20.11 or newer** (24.x is what this was developed against)
- **Docker**, for PostgreSQL 16 and a local mail catcher
- About 1 GB of free disk space for dependencies

If you would rather use your own PostgreSQL, skip the Docker step and point
`DATABASE_URL` and `TEST_DATABASE_URL` at it. Two databases are needed: tests truncate
every table in theirs.

---

## Getting started

```bash
git clone <repository-url> ekavist
cd ekavist

npm install                 # installs all workspaces
cp .env.example .env        # then open it and set AUTH_JWT_SECRET

npm run db:up               # PostgreSQL on 5433 and Mailpit on 8025, via Docker
npm run db:migrate          # applies migrations and the search indexes
npm run db:seed             # development data, clearly marked as such

npm run dev                 # API on :4000, web on :5173
```

Open <http://localhost:5173> and sign in with one of the seeded accounts:

| Account               | Role         | Password            |
| --------------------- | ------------ | ------------------- |
| `admin@ekavist.test`  | Super Admin  | `ekavist-demo-2026` |
| `lead@ekavist.test`   | Project Lead | `ekavist-demo-2026` |
| `rahul@ekavist.test`  | Team Member  | `ekavist-demo-2026` |
| `viewer@ekavist.test` | Viewer       | `ekavist-demo-2026` |

These accounts are development data. The seed refuses to run when `NODE_ENV=production`
or when `DATABASE_URL` looks like a production database.

**Generating an auth secret:**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## Environment variables

`.env.example` documents every variable. The ones that matter most:

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection for the application                      |
| `TEST_DATABASE_URL`  | A **separate** database for tests; they truncate every table   |
| `AUTH_JWT_SECRET`    | Signs access tokens. At least 32 characters, random            |
| `AUTH_COOKIE_SECURE` | Must be `true` behind HTTPS so the refresh cookie is protected |
| `APP_URL`            | Origin of the web app; used for CORS and links inside emails   |
| `ORG_TIMEZONE`       | The zone due dates and attendance days are interpreted in      |
| `EMAIL_TRANSPORT`    | `smtp`, `json` (writes to `logs/mail/`) or `console`           |
| `JOBS_ENABLED`       | Turns the deadline, summary and mail-dispatch schedulers on    |

The application refuses to start in production if the auth secret is still the example
value, if the refresh cookie is not marked secure, or if the email transport would only
pretend to deliver mail.

---

## Everyday commands

From the repository root:

| Command                     | What it does                                                   |
| --------------------------- | -------------------------------------------------------------- |
| `npm run dev`               | API and web app together, both reloading                       |
| `npm run build`             | Builds shared, API and web for production                      |
| `npm run typecheck`         | TypeScript across every workspace                              |
| `npm run lint`              | ESLint across the repository                                   |
| `npm run format`            | Prettier, writing changes                                      |
| `npm run verify`            | Format check, lint, typecheck, tests and build — the full gate |
| `npm run db:up` / `db:down` | Starts and stops PostgreSQL and Mailpit                        |
| `npm run db:migrate`        | Creates and applies a migration, then the search indexes       |
| `npm run db:reset`          | Drops and rebuilds the development database                    |
| `npm run db:seed`           | Loads the development data                                     |
| `npm run db:studio`         | Prisma Studio, for looking at the data directly                |

Mail sent in development is visible at <http://localhost:8025> when `EMAIL_TRANSPORT=smtp`
and Mailpit is running, or in `logs/mail/` when it is `json`.

---

## Testing

```bash
npm run test:unit          # pure domain logic; no database
npm run test:integration   # routes through to a real PostgreSQL
npm run test:permissions   # every endpoint against every role
npm run test:e2e           # Playwright journeys against a running stack

npm run load:check --workspace @ekavist/api   # timings against a deliberately oversized project
```

The first end-to-end run needs browsers:

```bash
npx playwright install chromium
```

Integration, permission and end-to-end tests all use `TEST_DATABASE_URL` and truncate it.
They refuse to run if it is the same as `DATABASE_URL`.

What the layers cover:

- **Unit** — progress rollup, overdue detection, dependency cycles, risk severity, WBS
  numbering, schedule variance, timezone conversion.
- **Integration** — authentication, projects, the Waterfall engine, WBS, tasks,
  dependencies, the Gantt feed, the Excel importer, and the security checklist.
- **Permissions** — the full matrix from `docs/PERMISSIONS.md`, asserting status codes
  rather than the absence of data.
- **End-to-end** — the ten journeys listed in `docs/TEST_STRATEGY.md`.
- **Load** — `npm run load:check --workspace @ekavist/api` seeds 4,000 tasks, 20,000
  messages and 6,000 shared resources into the scratch database and times the reads that
  would fall over first. It prints a table and exits non-zero if any median exceeds
  `LOAD_BUDGET_MS` (1,500 ms by default). It refuses to run against `DATABASE_URL`.

The web workspace has no unit tests; its behaviour is covered by the Playwright journeys,
so `npm run test` there passes with none. Adding the first one needs no setup — the
`jsdom` environment and Testing Library are already configured.

---

## Project layout

```
apps/
  api/                    Express, Prisma, Socket.IO
    prisma/               schema, migrations, seed
    scripts/              search indexes, end-to-end fixtures
    src/
      config/             validated environment
      domain/             pure business rules — no database
      policy/             who may do what
      services/           business logic; the only code that touches Prisma
      http/               routes, middleware, the Express app
      jobs/               scheduler, deadline scan, summaries
      mail/               templates, transport, outbox
      realtime/           Socket.IO server and the emitter services use
    tests/                unit, integration, permissions
  web/                    React, Vite, TanStack Query, Tailwind
    src/
      components/         interface primitives and the Gantt
      features/           auth
      layouts/            the application frame
      lib/                API client, query hooks, formatting
      pages/              one directory per area
packages/
  shared/                 enums, Zod schemas, response types — used by both apps
e2e/                      Playwright journeys
docs/                     architecture, database, API, permissions, decisions, progress
```

---

## How it fits together

```
Browser (React SPA)
   │  REST /api/v1/*            ws  Socket.IO
   ▼                             ▼
        Express (apps/api)
   ┌──────────────────────────────────────┐
   │ routes    parse, validate, respond   │
   │ policy    may this actor do this?    │
   │ services  business rules             │
   │ domain    pure functions, no I/O     │
   │ data      Prisma                     │
   └──────────────────────────────────────┘
        │                  │
        ▼                  ▼
    PostgreSQL        mail, scheduler
```

Three rules hold the design together:

1. **Business logic lives in services, never in routes or the UI.** A route parses input,
   calls a service and shapes a response.
2. **Derived values have exactly one implementation.** Progress, overdue, schedule
   variance and risk severity are computed in `src/domain` and used everywhere, so a
   dashboard, a report and an email can never disagree.
3. **Every permission is enforced on the server.** The UI hides what you cannot do as a
   courtesy; `tests/permissions` proves the server refuses it regardless.

`docs/ARCHITECTURE.md` explains the stack choice, and `docs/DECISIONS.md` records the ten
decisions that were not dictated by the specification.

---

## Deploying

```bash
npm ci
npm run build
npm run db:deploy --workspace @ekavist/api     # migrations, no prompts
NODE_ENV=production npm run start --workspace @ekavist/api
```

The web app builds to `apps/web/dist` as static files; serve them from any web server or
CDN, with a rewrite so client-side routes fall back to `index.html`.

There is a multi-stage `apps/api/Dockerfile` for the API:

```bash
docker build -f apps/api/Dockerfile -t ekavist-api .

docker run -d --name ekavist-api -p 4000:4000   -e NODE_ENV=production   -e DATABASE_URL='postgresql://user:password@host:5432/ekavist?schema=public'   -e AUTH_JWT_SECRET='...'   -e APP_URL='https://ekavist.example'   -e AUTH_COOKIE_SECURE=true   -e EMAIL_TRANSPORT=smtp -e EMAIL_HOST=smtp.example -e EMAIL_PORT=587   ekavist-api
```

The image contains the compiled output and production dependencies only — no TypeScript,
no test framework and no Prisma CLI. That takes `--omit=dev --omit=optional`, not
`--omit=dev` alone: `@prisma/client` declares the Prisma CLI as an _optional peer_
dependency and npm installs those by default. It runs as the unprivileged `node` user and
carries a `HEALTHCHECK` that calls `/api/v1/health`, which touches the database — so an
unhealthy container is one that cannot serve a request, not merely one whose process
exited.

Run `npm run db:deploy` as a separate step in the pipeline rather than migrating on
container start: a container that migrates on boot races itself the moment there are two
replicas.

Before going live:

- Set a real `AUTH_JWT_SECRET` and `AUTH_COOKIE_SECURE=true`.
- Point `APP_URL` at the HTTPS origin the SPA is served from; CORS follows it.
- Configure a real SMTP server. With any other transport the API refuses to start.
- Start the backup service. `docker compose --profile backup up -d backup` runs
  `ops/backup.sh` on a schedule (`BACKUP_CRON`, 02:00 UTC by default) into the
  `ekavist-backups` volume, keeping `RETENTION_DAYS` days of custom-format dumps and
  verifying each one's table of contents before it deletes anything older. Prove the
  dumps restore — `docker compose run --rm backup /ops/restore-check.sh` restores the
  newest one into a throwaway database and counts the rows. Point the volume at real
  storage: a backup on the same disk as the database is not a backup. Audit-log retention
  is a policy decision, and the schema keeps the log append-only so it stays trustworthy.
- Run the API behind a reverse proxy that terminates TLS. `trust proxy` is on, so the
  client address comes from `X-Forwarded-For` for rate limiting.

The scheduler runs inside the API process. If you run more than one replica, set
`JOBS_ENABLED=false` on all but one — see decision D-004 for why, and what changes if you
outgrow that.

---

## Troubleshooting

**`Invalid environment configuration` at startup.** The message lists the variables that
failed and why. The most common cause is an `AUTH_JWT_SECRET` shorter than 32 characters.

**`Can't reach database server at localhost:5433`.** Docker is not running, or the
container is not up. `npm run db:up`, then `docker compose ps` to confirm.

**Tests hang or fail with a foreign-key error.** Two test runs are sharing one database.
Wait for the first to finish; they truncate the same tables.

**`TEST_DATABASE_URL must differ from DATABASE_URL`.** Exactly what it says — tests would
otherwise destroy your development data. The `ekavist_test` database is created
automatically the first time the Postgres container starts; if you changed the volume,
recreate it with `docker compose down -v && npm run db:up`.

**`npm audit` reports a high-severity advisory.** One is known and accepted:
`deepmerge-ts` reaches the tree through the Prisma CLI, which is a devDependency and
never runs inside the server. A production image built with `npm ci --omit=dev` does not
contain it. See decision D-014 for the full reasoning and the condition to revisit.

**Email does not arrive.** With `EMAIL_TRANSPORT=json` it never leaves the machine: look
in `logs/mail/`. With `smtp` and Mailpit, open <http://localhost:8025>. An outbox row stays
`QUEUED` until a transport accepts it, and a failure is recorded with its error — nothing
reports a message as sent unless it was.

**The Gantt shows fewer bars than expected.** Items with no dates cannot be drawn; the
footer says how many were left out. Give them planned dates and they appear.

**Progress shows 0% against finished work.** Derived progress is a cache written by the
rollup service. It is refreshed on every task write, but data inserted straight into the
database bypasses it. `npm run db:seed` handles this correctly; a manual `INSERT` does not.
