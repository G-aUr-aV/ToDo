# Todo Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One quick task list with copy-name, always-visible notes, a Done log, an MCP endpoint plus token so agents can close tasks with outcome notes, and 7-day sliding logins.

**Architecture:** The data layer gets pure view helpers (`inNow`, `isLater`) and Mini/preference changes. The server gets persisted sliding sessions, personal tokens and a hand-written stateless MCP JSON-RPC route that calls the existing `Vault`. The React UI is split out of `App.tsx` into focused components using inline SVG icons and new design tokens taken from the mockup.

**Tech Stack:** TypeScript, React 19, Vite 8, Fastify 5, zod 4, node:test via tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-todo-revamp-design.md`. Visual source of truth: `docs/superpowers/specs/2026-11-21-todo-revamp-mockup.html`.

## Global Constraints

- No new npm dependencies (no MCP SDK). Lightweight: no new font files.
- One vault server. Every write goes through `Vault` methods: `createTask(input)`, `updateTask(id, revision, patch)`, `createProject(input)`, `updateProject(id, revision, patch)`.
- Vault note format unchanged. `focus` is still parsed and preserved but ignored by the UI and ordering.
- Tests use invented temporary vaults only. Never touch `Todo Vault/`, `.todo-state/` or the Docker instance.
- Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs` intact.
- No git add/commit (owner rule). There are no commit steps; the changes stay unstaged.
- Run commands from `app/` with `../scripts/local-node.sh` (Node 24 pinned). Baseline: typecheck clean, 72/72 tests passing.
- Copy rule: plain words, no taglines. Page titles are "Tasks", "Done", "Trash", "Settings" or the project title.

## Review Focus

1. **An existing `preferences.json` with `startPage: "today"`:** the vault must still open, with startPage mapped to `"tasks"`. (Task 1 test.)
2. **A title URL with trailing punctuation**, e.g. `see https://x.test/a/b).`: the link excludes the trailing `).` (Task 5 test).
3. **A corrupt or unreadable `sessions.json` or `tokens.json`:** the server starts. Sessions start empty and tokens are treated as none (fail closed), with no crash. (Task 2 tests.)
4. **An agent appends notes while the owner has the same task open with unsaved edits:** the owner's editor pauses with Copy draft / Discard (existing stale path), and the agent's append is not lost. (Task 3 test for append retry; the UI path is verified in the browser in Task 8.)
5. **A long unbroken title or URL at 375 px width:** no horizontal page scroll (Task 8 browser check).

---

### Task 1: Core views, Mini summary, preferences

**Files:**
- Modify: `core/task-views.ts`, `core/today.ts`, `core/model.ts` (preferences)
- Test: `tests/task-views.test.ts` (new), `tests/mini.test.ts`, `tests/vault.test.ts`

**Interfaces:**
- Produces: `inNow(task: Task, today: string): boolean`, `isLater(task: Task, today: string): boolean` and `byPriority(a, b)` (due ascending with null last, then `createdAt` ascending, then id; focus ignored), from `core/task-views.ts` and re-exported from `core/model.ts`.
- Produces: `Preferences.issueLinkTemplate: string` and `Preferences.startPage: "tasks" | "done"`.
- Produces: `TodaySnapshot.groups` keys `"overdue"`, `"project:<id>"`, `"none"`, labels `"Deadline passed"`, `<project title>`, `"No project"`. Project order follows `snapshot.projects` order.

- [ ] Step 1: Write `tests/task-views.test.ts`. Assert `inNow` is true for a task with no dates, `scheduled == today`, or `scheduled < today`. It is true for `scheduled > today` with `due <= today`, false for `scheduled > today` with `due > today` or no due, and false for done or trashed tasks. Assert `isLater` is the complement among active tasks, and that `byPriority` ignores `focus`.
- [ ] Step 2: Update `tests/mini.test.ts` so groups are keyed by project, with the overdue group first and no `focus` key. Add a future-planned task (`scheduled` tomorrow) that is excluded, and an undated inbox task that is included.
- [ ] Step 3: Add to `tests/vault.test.ts` a check that writing `preferences.json` with `{startPage:"today", …}` into a temp state dir then starting `Vault` succeeds, and `snapshot().preferences.startPage === "tasks"`. Add that `setPreferences` with `issueLinkTemplate: "https://x.test/browse"` (no `{key}`) is rejected and `"https://x.test/browse/{key}"` is accepted.
- [ ] Step 4: Run `../scripts/local-node.sh npm test`. Expected: the new assertions FAIL.
- [ ] Step 5: Implement.
  - `startPage` becomes `z.preprocess(v => ["today","inbox","upcoming","all","projects"].includes(v) ? "tasks" : v, z.enum(["tasks","done"]))`.
  - `issueLinkTemplate`: `z.string().max(300).refine(v => v === "" || v.includes("{key}"))` with default `""`.
  - `defaultPreferences.startPage = "tasks"`.
  - `todaySummary` uses `inNow`.
- [ ] Step 6: Run the tests and typecheck. Expected: PASS, and the earlier `inToday` tests are untouched.

### Task 2: Sessions (7-day sliding, persisted) and personal tokens

**Files:**
- Modify: `server/auth.ts`, `server/app.ts` (cookie maxAge, token routes), `src/client.ts`
- Test: `tests/auth.test.ts` (new), `tests/server.test.ts`

**Interfaces:**
- Produces in `Auth`:
  - `session(id?: string): Session | null`, which now slides `expiresAt` to `now + WEEK`. It persists when the stored `expiresAt` is more than 1 h older than the new value.
  - `createToken(name: string): Promise<{ token: string; info: TokenInfo }>`
  - `listTokens(): TokenInfo[]`
  - `revokeToken(id: string): Promise<void>`
  - `verifyToken(header?: string): TokenInfo | null`, which updates `lastUsedAt` at most once a minute.
  - `TokenInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null }`
  - `WEEK = 7*24*3600*1000`
  - The `Auth` constructor accepts an optional `clock: () => number` (default `Date.now`) for tests.
- Files: `STATE/sessions.json` holds `{ [sha256(id)]: { csrf, expiresAt } }`; `STATE/tokens.json` holds `TokenInfo & { sha256 }` entries. Both are mode 0600 and written atomically (temp + rename). A token is `"todo_pat_" + randomBytes(32).toString("base64url")`. Maximum 20 tokens; creating one more returns `AppError(400, "TOKEN_LIMIT", …)`.
- Routes (cookie + CSRF, same as other `/api`):
  - `GET /api/tokens` returns `TokenInfo[]`
  - `POST /api/tokens {name}` returns `{ token, info, endpoint }`, where `endpoint = publicOrigin + "/mcp"`
  - `DELETE /api/tokens/:id` returns `{ ok: true }`
- Client operations: `listTokens`, `createToken` and `revokeToken`, special-cased in `src/client.ts` like `changePassword`.
- `changePassword` also clears all tokens.

- [ ] Step 1: Write `tests/auth.test.ts` with a temp state and a fake clock:
  - Login, advance 6 days, `session()` is valid; advance another 6 days, still valid (sliding); advance 8 idle days, it returns null.
  - A new `Auth(state)` after `load()` restores a valid session from `sessions.json`.
  - Writing `"{not json"` to `sessions.json` and `tokens.json`: `load()` does not throw, and `verifyToken` returns null.
  - `createToken` returns a token starting `todo_pat_`; `verifyToken("Bearer "+token)` returns the info; a wrong token returns null; after `revokeToken` it returns null.
  - `changePassword` clears tokens.
- [ ] Step 2: In `tests/server.test.ts`, assert the login cookie `maxAge === 604800`, and that `POST /api/tokens` without CSRF is 403 while with CSRF it is 200 and lists one token.
- [ ] Step 3: Run the tests. Expected: FAIL.
- [ ] Step 4: Implement in `auth.ts` and wire the routes in `app.ts`. `cookieOptions.maxAge = 604800`. Reissue the cookie on `/api/session` when a session is valid so the browser expiry slides too.
- [ ] Step 5: Run the tests and typecheck. Expected: PASS, including the existing session tests.

### Task 3: MCP endpoint

**Files:**
- Create: `server/mcp.ts`
- Modify: `server/app.ts` (route plus the bearer branch in the `onRequest` hook)
- Test: `tests/mcp.test.ts` (new)

**Interfaces:**
- Consumes: `Auth.verifyToken` (Task 2); `inNow`, `byPriority` (Task 1); `Vault`.
- Produces: `handleMcp(vault: Vault, message: unknown): Promise<object | null>` (null for notifications) and `mcpTools: { name, description, inputSchema }[]`.
- Hook rule:
  - For `url === "/mcp"`, check Host as today.
  - Then require `verifyToken(req.headers.authorization)`, else 401 `{error}` with a `WWW-Authenticate: Bearer` header.
  - If `req.headers.origin` is present and is not `publicOrigin`, return 403.
  - Skip the Content-Type check only for GET/DELETE (both return 405). Skip the cookie and CSRF checks.
  - Rate limit 120/min on the route.
- Tool names, inputs and rules are exactly the spec §2 table. Tool results are `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result }`. Errors use `{ isError: true, content: [{type:"text", text: message}] }`.
- `find_tasks` ranking: every lower-cased query word must be in `title + "\n" + notes + "\n" + projectTitle`. Sort by title-contains-all-words first, then `updatedAt` descending.
- `complete_task` with `outcome`: the patch is `{ status: "done", notes: appendSection(notes, "## Outcome\n" + outcome.trim()) }`. `appendSection(body, text)` returns `body` unchanged if `body.trimEnd().endsWith(text.trim())`; otherwise `body.trimEnd() + (body.trim() ? "\n\n" : "") + text.trim() + "\n"`.
- `update_task` with `append_notes`: on `CONFLICT`, re-read the snapshot and retry once.

- [ ] Step 1: Write `tests/mcp.test.ts`, using the server fixture plus `auth.createToken("test")`:
  - `initialize` returns `protocolVersion "2025-06-18"` and `capabilities.tools`
  - `notifications/initialized` returns 202
  - `tools/list` returns the 8 named tools
  - no token is 401; a wrong token is 401; a foreign Origin is 403; GET `/mcp` is 405
  - `add_task` with an unknown project gives `isError`
  - `add_project` then `add_task` with the project title creates a task in that project
  - `find_tasks {query:"trace"}` finds it
  - `update_task {append_notes}` twice gives both paragraphs in order
  - `complete_task {outcome:"Rotated key."}` gives `status done` and notes ending `## Outcome\nRotated key.`; calling it again does not duplicate the section
  - `reopen_task` restores the previous status
  - `update_task {notes}` without `revision` gives `isError`
  - **Review Focus 4:** after an `updateTask` from the "UI" between read and append, `append_notes` still succeeds and the earlier UI change is kept
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement `server/mcp.ts` with zod schemas per tool, hand-written JSON Schemas for `tools/list`, and the JSON-RPC dispatch (`-32600` invalid request, `-32601` method not found, `-32602` invalid params). Add the instructions string from spec §2.
- [ ] Step 4: Run the tests and typecheck. Expected: PASS.

### Task 4: Design system, icons, app shell and navigation

**Files:**
- Create: `src/icons.tsx` (inline SVG icon map, with names matching existing `Icon` callers plus the mockup's)
- Modify: `src/components.tsx` (`Icon` renders inline SVG with `currentColor`; tone becomes a class; `Button` restyled), `src/base.css` (tokens from the mockup's `:root` and dark theme; `[data-motion=reduced]` disables motion), `src/styles.css` (rewritten for the new shell), `src/App.tsx`
- Delete from UI: Today/Inbox/Upcoming/All/Help/More views, select mode, focus, the Composer modal and the Rename modal.

**Interfaces:**
- Produces:
  - `View = "tasks" | "done" | "trash" | "settings" | "projects" | "archived" | "diagnostics" | "import" | "history"`
  - App state `filterProject: string | null`
  - `projectColor(id: string): string`, a deterministic hash into 8 muted hues, in `src/project-color.ts`
- The sidebar, the mobile tabs (Tasks / Done / Search / More, where More opens a sheet with Projects, Trash, Settings) and the header follow the mockup.

- [ ] Step 1: Implement the tokens, icons and shell; render Tasks/Done placeholders.
- [ ] Step 2: Run `npm run typecheck`. Then open `http://localhost:4173` on the sandbox and compare against the mockup at 1280 px and 375 px, light and dark.

### Task 5: Tasks view: rows, rich titles, quick add, detail card

**Files:**
- Create: `src/rich-title.tsx` (pure `titleParts(text, template): Part[]` and `<RichTitle>`), `src/TaskList.tsx` (`QuickAdd`, `TaskRow`, `TaskGroups`), `src/Popover.tsx` (anchored popover/menu with Esc/outside-click close, arrow-key navigation)
- Modify: `src/Editor.tsx` (becomes the detail card: inline title input, property chips, one-click notes, Complete/Reopen footer; keep all draft/stale/save logic as is), `src/App.tsx`
- Test: `tests/rich-title.test.ts` (new)

**Interfaces:**
- `Part = { kind: "text"; text: string } | { kind: "url"; href: string; label: string } | { kind: "key"; key: string; href: string | null }`
- `titleParts` behaviour:
  - URL regex `https?:\/\/[^\s<>"]+`, with trailing `.,;:!?)]}'"` stripped back into text.
  - Key regex `\b[A-Z][A-Z0-9]{1,9}-\d+\b`, skipping the prefixes `UTF SHA ISO RFC GPT MD AES TLS HTTP IPV CVE ES`.
  - `href` is `template.replace("{key}", key)`, or null when the template is empty.
  - The label is `hostFirstLabel + " › " + last two path segments` (falls back to the host).

- [ ] Step 1: Write `tests/rich-title.test.ts`:
  - `titleParts("Review PR https://git.example.test/projects/APP/repos/x/pull-requests/218/overview", "")` gives `[text "Review PR ", url label "git › 218/overview"]`
  - `"see https://x.test/a/b)."` gives the url href `https://x.test/a/b` followed by text `")."`
  - `"Fix APP-1234 and UTF-8"` with template `"https://j.test/browse/{key}"` gives the key `APP-1234` with href `https://j.test/browse/APP-1234`; `UTF-8` stays text
  - with an empty template, the key has a null href
- [ ] Step 2: Run. Expected: FAIL. Then implement `titleParts`. Run again. Expected: PASS.
- [ ] Step 3: Build the Tasks view per spec §5:
  - groups via `inNow`/`isLater` and `byPriority`
  - row markers: notes, checklist from `checkItems(notes)`, deadline, labels, reminder and repeat icons
  - hover actions: copy name (`navigator.clipboard.writeText(task.title)`, toast "Copied task name") and ⋯ (Copy name, Open in Obsidian, Earlier versions, Move to Trash)
  - quick add: Enter creates with `projectId = filterProject`; multi-line paste puts line 1 in the title and the rest in the notes; focus stays
  - card property chips: project popover with "New project…", date popover (Today, Tomorrow, Next Monday, Pick a date… via the existing `DateControl` modal, No date), "+ Deadline, label…" revealing the deadline (`DateControl kind="deadline"`), labels (comma input), reminder and repeat (`ScheduleFields`); a set property shows as a chip with ×
- [ ] Step 4: Build the complete animation: the check fills, the row gets a `leaving` class for 420 ms, then `mutate`. Toast "Completed · Undo".
- [ ] Step 5: Typecheck. Browser check against the mockup: open card, one-click notes, checkbox toggle without edit, link click without opening the row.

### Task 6: Done view, quick find, keyboard

**Files:**
- Create: `src/DoneView.tsx`, `src/Find.tsx`, `src/KeyboardSheet.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Done grouping uses `dayInZone(new Date(completedAt), timezone)`, with labels Today / Yesterday / `weekday d MMM`. It shows 30 days, then "Show older".
- The outcome line is the first non-empty line after `## Outcome`, else the first non-empty notes line.
- Find searches title, notes and project title over non-trashed tasks; at most 8 results; Enter, arrows, Esc.
- Keys: N, J/K and arrows, Enter, Esc, X, C, E, P, D, ⌘K, `?`. Single keys are gated by `appearance.shortcuts` and by not typing in a field.

- [ ] Step 1: Implement the three components and the key handler.
- [ ] Step 2: Typecheck. Browser: complete with X, then Undo; C copies; ⌘K "trace" plus Enter opens the task in Done.

### Task 7: Settings page, Mini restyle, project header

**Files:**
- Modify: `src/Settings.tsx` (one scrolling page of sections: Connect an agent, Issue links, Appearance, Vault & Obsidian, Planning, Account, Data), `src/MiniApp.tsx` (project groups, no focus), `src/mini.css` (new tokens), `src/App.tsx` (project header with editable description and ⋯ Archive)

**Interfaces:**
- Consumes: `createToken`, `listTokens` and `revokeToken` (Task 2); `issueLinkTemplate` (Task 1).
- The agent section shows, after creating a token: the full `claude mcp add --scope user --transport http todo <endpoint> --header "Authorization: Bearer <token>"` command, the endpoint and the token, each with a copy button, plus "Shown once". The token list has Revoke. The password form says that changing it also disconnects agents.

- [ ] Step 1: Implement.
- [ ] Step 2: Typecheck. Browser: create a token, copy the command, revoke it; save an issue template and see key chips link; Mini at `/mini` shows project groups.

### Task 8: Skill, docs, full verification

**Files:**
- Modify: `.agents/skills/todo-tasks/SKILL.md` (rewrite per spec §3, via the `skill-edit` skill), `.agents/skills/todo-tasks/references/api.md` (add MCP section), `docs/agent-skills.md`, `docs/ux.md`, `docs/mini-today.md`, `README.md`, `app/AGENTS.md` (Daylight line, via `skill-edit`)

- [ ] Step 1: Write the docs and skill.
- [ ] Step 2: Run `../scripts/local-node.sh npm run check`. Expected: typecheck, all tests, build and setup smoke pass.
- [ ] Step 3: Browser acceptance on the sandbox at 1280 and 375 px, light and dark: the spec §7 list plus Review Focus 4 and 5.
- [ ] Step 4: External check. Create a sandbox token, then run `claude -p` with `--mcp-config` pointing at the sandbox `/mcp`: "find the trace task, add a progress note, then close it with an outcome". Read the vault note: it has `## Progress` and `## Outcome`.
- [ ] Step 5: A fresh reviewer subagent reviews the whole diff against the spec. Fix its confirmed findings.
