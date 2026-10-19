# Todo's authenticated API

Read this when making task changes programmatically. The normal UI uses these same routes; no separate agent token or task CLI exists in the current app. Use the existing server and an authorized session. Do not construct a second `Vault` instance against live data.

## Connect without exposing secrets

Use the installation's confirmed `PUBLIC_ORIGIN`; the local default is `http://localhost:4310`. `localhost` and `127.0.0.1` are different hosts for the server's checks. Respect its configured Host and Origin instead of disabling those checks.

In an authenticated browser page, same-origin requests use the HttpOnly `todo_session` cookie automatically. `GET /api/session` returns `{ authenticated, csrf, version }`; keep `csrf` in execution memory and use it as `X-Todo-CSRF` for writes. Include `Content-Type: application/json` and the configured Origin. Browsers supply Origin themselves. A direct HTTP client also needs its authorized cookie; keep it private, and never put it into a shell command or transcript. Do not extract browser-profile cookies or dump session responses. If no usable session exists, let the owner sign in privately in the UI; do not read `initial-login.txt` or change account credentials for task management.

`GET /healthz` and `/readyz` are unauthenticated service probes, not proof of an authenticated task session. A restart expires sessions. A network/authentication limitation is not permission to hand-edit files, start a second writer or reset state.

## Read responses

| Request | Response |
| --- | --- |
| `GET /api/workspace` | `{ tasks, projects, diagnostics, preferences, vaultName, vaultKey, now, today, version }` |
| `GET /api/today` | Compact `{ today, count, needsAttention, groups, reminders, ... }`; groups contain active task IDs and revisions, but not full notes or completion history |
| `GET /api/tasks/:id/versions` | Recovery versions `{ id, savedAt, title, notes }[]` for that task |

There is no individual `GET /api/tasks/:id` route. Get a task by filtering `workspace.tasks` on its UUID. Tasks in a workspace include done and trashed records; apply the requested filters. Task objects expose `id`, `path`, `revision`, `notes`, `scheduled`, `due`, `status`, `projectId`, `completedAt`, `reminder`, `repeat`, `recurrenceSourceId` and `nextOccurrenceId`, among other metadata. Project objects include `id`, `path`, `revision` and `archived`. Read `diagnostics` before calling a listing complete or a recurring change fully successful.

## Create a task

`POST /api/tasks` accepts a JSON object with a required nonempty `title` (max 240 characters) and UUID `requestId`. This UUID becomes the task's stable ID. Generate it once and reuse it only for retries of that same creation. Reusing it returns the existing task; it does not apply changed fields. A distinct intended task needs a new UUID. The response is the task itself, not `{ task: ... }`.

Example payload, with invented dates/identity for documentation:

```json
{
  "requestId": "127be6b3-c981-4dd7-bd61-64a681f1199f",
  "title": "Review the invented project brief",
  "scheduled": "2030-01-21",
  "notes": "- [ ] Read the brief\n- [ ] Record open questions"
}
```

Omitting dates and project produces `status: inbox`; providing a plan date, deadline or project produces `todo`, unless `status` is explicit. Do not supply engine metadata such as `id`, `path`, `created_at` or `completed_at`.

## Update or complete a task

`PATCH /api/tasks/:id` requires `If-Match: <current revision>` (the 64-character SHA-256 string from a fresh task snapshot; quoted values are also accepted). Send a patch object directly, not `{ revision, patch }`. On success it returns the task plus `undoVersion`, a recovery-version ID.

Example patch to reschedule without changing the deadline:

```json
{ "scheduled": "2030-01-22" }
```

Example patch to record completion:

```json
{ "status": "done" }
```

Supported create/patch fields:

| API field | Value |
| --- | --- |
| `title`, `status` | Nonempty title; status `inbox`, `todo`, `doing`, or `done` |
| `scheduled`, `due` | `YYYY-MM-DD` or `null` to clear |
| `projectId` | Existing non-archived project UUID, or `null` to unassign |
| `focus`, `trashed` | Booleans |
| `tags` | Complete string array, up to 30 entries, each 1–40 characters; preserve existing tags when adding one |
| `notes` | Entire Markdown body, max 500,000 characters; preserve unaffected content |
| `reminder` | ISO timestamp with seconds and explicit `Z` or `±HH:MM`, or `null` |
| `repeat` | `{ "frequency": "daily" | "weekly" | "monthly", "interval": 1..365 }`, or `null` |

Creation additionally requires `requestId`; PATCH rejects it. Unknown fields are rejected. API names differ from stored YAML: use `projectId`, `notes`, `reminder` on the wire; YAML has `project`, the Markdown body, and `reminder_at`. Read completion from `completedAt`; let the engine maintain `completed_at`, rollover metadata and recurrence bookkeeping.

To reopen, patch the desired pending status, usually the task's `previousStatus`; do not send `completedAt`. To trash/untrash, patch `trashed`. Read back the requested result by UUID, including related recurrence records and diagnostics where applicable.

## Projects and exact recovery

- `POST /api/projects` takes `{ requestId, title, notes? }` (title max 120 characters). Use a fresh UUID, with the same retry semantics as task creation.
- `PATCH /api/projects/:id` takes `title`, `notes` and/or `archived`, plus the current `If-Match` header. Archiving preserves task links and dates.
- For exact Undo of a saved change, retain its `undoVersion`, obtain the task's current revision, then use `POST /api/tasks/:id/restore` with `{ "revision": "CURRENT_REVISION", "version": "UNDO_VERSION" }`. This route takes the revision in its JSON body, not just in `If-Match`.
- For older recovery, fetch versions and choose the version requested by the owner. Do not select an arbitrary latest version or overwrite newer work to undo one field. Restore changes the whole note and can affect recurrence; read back the result.

Use the UI's existing import flow for deliberate note imports and adoption. Do not import or regenerate a note to bypass a failed edit.

## Failures and uncertain outcomes

Errors use `{ "error": { "status", "code", "message", "current"? } }`. Check the HTTP status before treating the body as task data.

| Failure | Action |
| --- | --- |
| `401 SESSION_EXPIRED`, `403 CSRF_INVALID` | Refresh the session or let the owner sign in privately; never disable authentication |
| `403 HOST_INVALID` / `ORIGIN_INVALID` | Use the configured origin and host |
| `428 REVISION_REQUIRED` | Fetch the current task and include its revision |
| `409 CONFLICT` | Preserve the intended change, fetch/review the current task; no automatic merge, blind retry or force overwrite |
| Validation, duplicate ID, read-only/invalid note | Explain the concrete problem; do not guess an identity, coerce an unsupported repeat rule or rewrite the YAML |
| Unavailable vault, writer lease or service | Keep useful read-only results; report the blocked write without creating/replacing a service |
| Network failure after sending a mutation | Read back by UUID first; replay a create only with the same `requestId`. Reapply an update only after reviewing whether it already took effect and whether intervening changes matter |

An operation can persist completion while recording a recurrence diagnostic. Verify the successor through `nextOccurrenceId` and fresh `diagnostics`; report saved completion and paused recurrence separately.
