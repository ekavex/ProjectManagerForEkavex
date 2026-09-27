# Ekavist — API Design

Base path: `/api/v1`. JSON in, JSON out. All times are ISO-8601 UTC.

## 1. Conventions

- `GET` list, `GET /:id` read, `POST` create, `PATCH` partial update, `DELETE` remove.
- `PUT` is not used; every update endpoint is a partial update.
- Success: `200` (read/update), `201` (create, with `Location`), `204` (delete).
- Failure body is always:
  ```json
  {
    "error": { "code": "…", "message": "…", "details": [{ "path": "dueDate", "message": "…" }] },
    "requestId": "01J…"
  }
  ```
- Status codes: `400` validation, `401` unauthenticated, `403` unauthorised,
  `404` not found _or_ not visible to the caller (no existence leak), `409` conflict /
  business-rule violation, `422` semantically invalid state transition, `429` rate limited.
- Every collection endpoint is paginated: `?page=1&pageSize=25` (max 100) and answers
  `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`.
- Filtering and sorting are explicit allow-lists per endpoint; arbitrary field sorting is
  rejected rather than passed to the database.

## 2. Authentication

| Method | Path                    | Notes                                                                                                |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`           | body `{email, password}` → access token in body, refresh token in `httpOnly; SameSite=Strict` cookie |
| POST   | `/auth/refresh`         | rotates the refresh token; reuse of a rotated token revokes the family                               |
| POST   | `/auth/logout`          | revokes the current refresh token                                                                    |
| POST   | `/auth/forgot-password` | always `204`, never reveals whether the address exists                                               |
| POST   | `/auth/reset-password`  | `{token, password}`                                                                                  |
| GET    | `/auth/me`              | current user, org role, permission list                                                              |
| POST   | `/auth/change-password` | requires the current password                                                                        |

Access token: 15 min. Refresh token: 30 days, rotating, stored hashed.

## 3. Resources

```
/users                         GET POST
/users/:id                     GET PATCH DELETE(deactivate)
/users/:id/activate            POST
/departments                   GET POST
/departments/:id               GET PATCH DELETE

/projects                      GET POST
/projects/:id                  GET PATCH DELETE
/projects/:id/archive          POST
/projects/:id/status           PATCH
/projects/:id/dashboard        GET
/projects/:id/health           GET
/projects/:id/timeline         GET
/projects/:id/activity         GET

/projects/:id/members          GET POST
/projects/:id/members/:userId  PATCH DELETE

/projects/:id/phases           GET POST
/projects/:id/phases/:phaseId  GET PATCH DELETE
/projects/:id/phases/:phaseId/start     POST
/projects/:id/phases/:phaseId/submit    POST   → phase gate review
/projects/:id/phases/:phaseId/approve   POST
/projects/:id/phases/:phaseId/reject    POST   { reason, requiresRework }

/projects/:id/wbs              GET POST          GET returns the full tree
/projects/:id/wbs/:wbsId       GET PATCH DELETE
/projects/:id/wbs/:wbsId/move  POST              { parentId, position } → renumbers

/projects/:id/tasks            GET POST
/projects/:id/tasks/:taskId    GET PATCH DELETE
/projects/:id/tasks/:taskId/status    PATCH
/projects/:id/tasks/:taskId/progress  PATCH
/projects/:id/tasks/:taskId/comments  GET POST
/projects/:id/tasks/:taskId/attachments GET POST DELETE
/projects/:id/dependencies     GET POST
/projects/:id/dependencies/:depId     DELETE
/projects/:id/milestones       GET POST PATCH DELETE
/projects/:id/raci             GET PUT

/projects/:id/gantt            GET   ?from&to&granularity=day|week|month

/projects/:id/messages         GET POST         ?search&type&userId&from&to&pinned&mine
/projects/:id/messages/:msgId  PATCH DELETE
/projects/:id/messages/:msgId/reactions  POST DELETE
/projects/:id/messages/:msgId/pin        POST DELETE
/projects/:id/resources        GET              unified files + links + Drive

/projects/:id/documents        GET POST
/projects/:id/documents/:docId GET PATCH DELETE

/projects/:id/notes            GET POST PATCH DELETE     project notes only
/projects/:id/decisions        GET POST PATCH DELETE
/projects/:id/risks            GET POST PATCH DELETE
/projects/:id/issues           GET POST PATCH DELETE
/projects/:id/change-requests  GET POST
/projects/:id/change-requests/:crId          GET PATCH
/projects/:id/change-requests/:crId/analyse  POST
/projects/:id/change-requests/:crId/decide   POST  { approved, note }
/projects/:id/closure          GET POST
/projects/:id/lessons          GET POST

/projects/:id/reports/daily    GET ?date
/projects/:id/reports/weekly   GET ?weekOf
/projects/:id/reports/final    GET
/projects/:id/import           POST (upload) → preview
/projects/:id/import/:jobId/confirm POST

/me/notes                      GET POST PATCH DELETE     personal notes
/me/work                       GET                       today / upcoming / overdue / completed
/me/dashboard                  GET

/attendance/start-work         POST  { projectId?, taskId? }
/attendance/end-work           POST
/attendance/break/start        POST
/attendance/break/end          POST
/attendance/today              GET
/attendance/history            GET ?from&to&userId
/attendance/team               GET ?date            (lead/admin)

/notifications                 GET ?unread
/notifications/:id/read        POST
/notifications/read-all        POST
/notifications/rules           GET PATCH            (admin)

/dashboard/company             GET                  (admin)
/dashboard/lead                GET                  (lead)
/reports/workload              GET
/audit                         GET ?entityType&entityId&actorId&from&to   (admin)
/search                        GET ?q&types
```

## 4. Authorisation

Every route declares its requirement and the check runs **server side** before the service
executes:

```ts
router.post(
  '/projects/:id/tasks',
  requireAuth,
  requireProjectPermission('task:create'),
  validate(createTaskSchema),
  handler,
);
```

`requireProjectPermission` resolves the caller's project role and org role, then consults
the permission matrix in `docs/PERMISSIONS.md`. Services re-assert the invariant for
operations reachable from more than one route, so a missing middleware is not an exploit.

## 5. Real-time

Socket.IO namespace `/`; a client joins room `project:{id}` only after the server verifies
membership on the handshake token. Server → client events:

```
message:created   message:updated   message:deleted
message:pinned    message:unpinned  message:reaction
task:updated      notification:new  presence:changed
```

The REST API remains the source of truth; sockets carry deltas, never authorisation.
