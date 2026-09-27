# Ekavist — Architecture

## 1. Repository state at kickoff

The repository contained exactly one file: `Ekavist_Project_Specification.md`.
There was no existing framework, package manager, database, or code to preserve.
Therefore the stack was selected fresh (spec §60 leaves the technology open).

## 2. Selected stack

| Layer           | Choice                                                                                  | Why                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript (strict) everywhere                                                          | One language, shared types between API and UI (spec §87 maintainability)                                                                                                 |
| Monorepo        | npm workspaces                                                                          | Zero extra tooling; `packages/shared` is consumed by both apps                                                                                                           |
| Backend         | Node.js + Express 5                                                                     | Mature, boring, easy for another developer to read. Real REST API usable by a future mobile app (spec §87)                                                               |
| Real-time       | Socket.IO over the same HTTP server                                                     | Spec §63 requires real-time chat. A long-lived WS connection rules out a serverless-only design                                                                          |
| Database        | PostgreSQL 16                                                                           | Relational data with deep FK graphs, recursive WBS, reporting aggregates                                                                                                 |
| ORM             | Prisma                                                                                  | Typed client, first-class migrations (spec §58 requirement for migrations)                                                                                               |
| Validation      | Zod                                                                                     | One schema validates the request and infers the TypeScript type                                                                                                          |
| Auth            | Argon2id password hash + JWT access token + rotating refresh token in httpOnly cookie   | Spec §8, §69                                                                                                                                                             |
| Background jobs | node-cron in-process scheduler behind a `JobRunner` interface                           | Spec §48 wants async work; a queue broker (BullMQ/Redis) is not justified at this scale. The interface allows swapping later without touching business logic             |
| Email           | Nodemailer with a pluggable transport; dev uses a JSON transport that writes to `logs/` | Spec §42. Never reports "email sent" unless the transport accepted it (master prompt §67)                                                                                |
| Frontend        | React 19 + Vite + React Router + TanStack Query                                         | SPA is the right shape for a dense internal tool; TanStack Query removes hand-rolled cache/loading/error code                                                            |
| Styling         | Tailwind CSS v4 + a small local component set                                           | Consistent spacing/typography tokens without importing a heavyweight design system                                                                                       |
| Gantt           | Custom SVG/CSS timeline component fed by the `/gantt` API                               | Spec §22 needs WBS grouping, dependency arrows and phase bands. Off-the-shelf free Gantt libs do not model phase gates; a focused component is smaller than fighting one |
| Testing         | Vitest (unit + integration via Supertest), Playwright (E2E)                             | Spec §73                                                                                                                                                                 |
| Logging         | Pino structured JSON with redaction of secrets                                          | Spec §47 of master prompt                                                                                                                                                |

### 2.1 Why not Next.js

Next.js would collapse the two apps into one deploy, but:

- Socket.IO still needs a custom server, losing most of the Next hosting benefit.
- The spec calls for an API consumable by future mobile apps; an explicit versioned REST
  surface (`/api/v1/...`) is a clearer contract than route handlers colocated with pages.

Recorded in `DECISIONS.md` as **D-001**.

## 3. Runtime topology

```text
Browser (React SPA)
   │  HTTPS  REST /api/v1/*        ws  Socket.IO /socket.io
   ▼                                ▼
        Express app (apps/api)
   ┌──────────────────────────────────────────┐
   │ http layer   routes + zod validation     │
   │ policy layer authorize() / RBAC          │
   │ service layer business rules (the truth) │
   │ data layer   Prisma client               │
   └──────────────────────────────────────────┘
        │                    │
        ▼                    ▼
    PostgreSQL          Side effects
                        (mail transport, scheduler)
```

### 3.1 Layer rules

- **Routes** never contain business rules. They parse input, call a service, shape a response.
- **Services** own all business rules and are the only code that touches Prisma.
  Every mutation that matters passes through the audit/activity recorder.
- **Policy** (`src/policy`) is the single place that answers "may this actor do this?".
  Called from services, not only from routes, so an unprotected route cannot leak access.
- **Domain** (`src/domain`) holds pure, DB-free functions: progress rollup, overdue
  detection, schedule variance, dependency cycle detection, project health. These are
  the functions the master prompt §46 forbids duplicating, so dashboards, reports and
  notifications all call the same ones.

## 4. Shared package

`packages/shared` exports enums (task status, phase status, roles, notification types),
Zod schemas for every request body, and the response DTO types. The web app imports the
same module, so a field rename breaks the build on both sides instead of at runtime.

## 5. Multi-tenancy

Single-organization deployment (spec §7 describes one company). An `Organization` row
exists and every user/project points at it, so a future multi-tenant mode is a scoping
change rather than a schema rewrite. Documented as **D-002**.

## 6. Time and timezone

- Every timestamp column is `timestamptz`; the server always works in UTC.
- Calendar-only values (attendance `workDate`, task `dueDate`) are stored as a `@db.Date`
  and are interpreted in the _organization_ timezone, never the server's.
- `src/domain/time.ts` is the only place that converts between the two. UI renders in the
  user's timezone (`User.timezone`, defaulting to the organization timezone).

Documented as **D-003**.

## 7. Error model

Every failure is an `AppError` with a stable `code`, an HTTP status, and a human message
safe to display. The error middleware logs the cause with a request id and returns:

```json
{ "error": { "code": "TASK_DEPENDENCY_CYCLE", "message": "…", "details": [] }, "requestId": "…" }
```

Unexpected exceptions become `INTERNAL_ERROR` with a generic message; the stack only ever
reaches the log.
