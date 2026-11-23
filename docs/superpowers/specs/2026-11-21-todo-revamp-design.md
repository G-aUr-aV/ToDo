# Todo revamp: fewer clicks, agent access, longer logins

Date: 2026-11-21. Visual reference: [the clickable mockup](2026-11-21-todo-revamp-mockup.html) (open it in a browser). Where this text and the mockup disagree on layout, spacing, colour or typography, the mockup wins; where they disagree on behaviour, this text wins.

## Why

The owner uses Todo every day for engineering work and wants it simple, elegant and quick: fewer clicks, less "AI slop". Their real vault (92 tasks, read on 2026-11-20) shows the actual workflow:

- All 84 completed tasks went straight from Inbox to done. Only 4 tasks ever had a plan date (set by an agent).
- No task uses a project, label, deadline, reminder, repeat or focus.
- The notes that exist are outcome notes: root causes, what was fixed, or why the work was not needed. The panel hides notes behind "Edit notes", and the "Add a note…" text cannot be clicked.
- Titles often contain URLs, Slack links and issue keys (`APP-1234`) that are not clickable.

From now on the owner will mostly use a Claude agent to find, update and close tasks, and the agent should write the notes. Today an agent cannot sign in at all: there is no token, only the browser cookie. Logins also expire after a fixed 24 hours and on every server restart, so the owner signs in daily.

## Goals

1. Copy a task's name in one click (or one key).
2. Notes always visible and editable with one click; agents write context, progress and outcome there.
3. One task list instead of Inbox / Today / Upcoming / All tasks; a Done log that shows what was done.
4. Projects as the only grouping: one per repo, plus a few basic categories that live as data in the owner's vault.
5. An MCP endpoint and a rewritten `todo-tasks` skill so Claude can find, update and close tasks.
6. Logins that last 7 days, extended on use, and survive restarts.
7. A calmer, crafted look: no taglines, warm neutrals, one accent, serif page titles, keyboard-first.

## Non-goals

- Copying full task details or day summaries (the owner asked only for the name).
- Deleting deadline, labels, reminders or repeat from the engine or vault format. They stay supported and are tucked away in the UI.
- Any vault-format migration, new storage engine, desktop runtime or heavy dependency (no MCP SDK).

## Anti-goals (failure even if it works)

- Capture-to-complete takes more clicks than today.
- An agent marks work done without verifying it, or overwrites notes it did not read.
- Category names hard-coded in app or skill code.
- Notes become unreadable in Obsidian (they stay plain Markdown).

## Constraints

- `app/AGENTS.md` and root `AGENTS.md`: web-only, one vault server, lightweight, Sites files kept, tests against invented temporary vaults only. The line "Keep the Daylight design" is replaced by this design (owner asked for a revamp).
- Inter is already bundled. Serif titles use the system `ui-serif` stack (New York on macOS, Georgia elsewhere): no new font download.
- The owner runs the real instance in Docker (`compose.yaml`) against `Todo Vault/`. Nothing touches it until the owner approves the rollout step.

## Approaches considered

| Decision | Options | Chosen and why |
| --- | --- | --- |
| Agent access | A) MCP endpoint inside the existing server with a personal token; B) separate stdio MCP program calling the API; C) token plus a CLI | **A.** No extra process, still one vault server, works with Claude Code's HTTP transport. B needs local Node beside Docker; C isn't MCP. |
| Where categories live | Todo Vault `Projects/` notes; MemexVault page; config file in the repo | **Todo Vault `Projects/`.** The app already reads it and it is the owner's data, not framework code. MemexVault can only be written through its capture inbox (stalled since 2026-11-15), and the Docker server cannot see it. |
| Unused features | Hide in UI; delete code | **Remove the unused task focus flag. Tuck deadline, labels, reminder and repeat behind "+".** |
| Inbox / Today / Upcoming / All | Keep separate; merge | **Merge into Tasks with a Later section.** The owner closes everything from Inbox. |

## Design

### 1. Logins

- Session lifetime 7 days, sliding: an authenticated request moves `expiresAt` to now + 7 days. Persist the change at most once an hour per session.
- Sessions are saved in `STATE_PATH/sessions.json` (mode 0600) as `sha256(sessionId) → { csrf, expiresAt }` and loaded at startup, so restarts keep you signed in. The cookie `maxAge` is 7 days and is reissued when the session is extended.
- Unchanged: logout deletes the session; a password change still ends all other sessions.

### 2. Agent access: tokens and MCP

**Tokens.** Settings → "Connect an agent" → *New token* asks for a name (default "Claude Code"). The token `todo_pat_<43 base64url chars>` is shown once, inside a ready command with a copy button:

```
claude mcp add --scope user --transport http todo http://localhost:4310/mcp --header "Authorization: Bearer todo_pat_…"
```

The origin in the command is the server's `PUBLIC_ORIGIN`. *(Builder-check call)* Under the command, Settings also shows the endpoint URL and the bare token, each with its own copy button, so Codex or any other MCP client can connect. `STATE_PATH/tokens.json` (0600) stores `{ id, name, sha256, createdAt, lastUsedAt }`, with at most 20 tokens. Revoking deletes one. Tokens are accepted only on `/mcp`. *(Builder-check call)* A password change revokes all tokens as well as other sessions, and Settings says so next to the password form.

**Security on `/mcp`.** The Host check stays. A request with a valid bearer token and **no** `Origin` header skips the Origin/CSRF checks. If an `Origin` header is present it must equal `PUBLIC_ORIGIN`. No cookie auth on `/mcp`. Rate limit 120 requests/minute.

**Protocol.** MCP Streamable HTTP, stateless, JSON responses, hand-written on Fastify + zod:

- `POST /mcp` handles JSON-RPC `initialize`, `notifications/initialized` (202, no body), `ping`, `tools/list` and `tools/call`. Batches are not needed.
- `initialize` answers with the client's `protocolVersion` if known (`2025-06-18`, `2025-03-26`), otherwise `2025-06-18`. It sends capabilities `{ tools: {} }`, server info `{ name: "todo", version }`, and short `instructions` pointing at the note conventions below.
- `GET` and `DELETE /mcp` return 405.
- A tool failure is returned as a tool result with `isError: true` and the app's error message. Protocol errors use JSON-RPC error codes.

**Tools.** All tools go through the existing `operate()`/Vault engine, so revisions, recovery versions and day lists work exactly as they do for the UI.

| Tool | Input | Result and rules |
| --- | --- | --- |
| `find_tasks` | `query?`, `status: open\|done\|all = open`, `project?` (title or id), `limit = 20` (max 50) | Compact list: `id, title, project, status, scheduled, due, completedAt, hasNotes, path`. Every query word must appear in title + notes + project (case-insensitive). Title matches rank first, then the newest `updatedAt`. Excludes trashed. |
| `get_task` | `id` | Full task including `notes`, `revision`, project title. |
| `add_task` | `title`, `notes?`, `project?`, `scheduled?`, `due?`, `requestId?` | Project must already exist (matched by title, case-insensitive, or id), else error "unknown project; call list_projects or add_project". A server-generated `requestId` is returned so retries can reuse it. |
| `update_task` | `id`, `title?`, `notes?` (replace), `append_notes?`, `project?` (`null` clears), `scheduled?`, `due?` | `append_notes` re-reads the task and appends with one blank line between, retrying once on a revision conflict. Replacing `notes` uses the revision the agent read last (`revision` input required with `notes`) and fails on conflict. |
| `complete_task` | `id`, `outcome?` (Markdown) | If `outcome` is given, appends `## Outcome\n<outcome>` (unless the notes already end with that same text) and sets `status: done` in one update. Returns the task. |
| `reopen_task` | `id` | Sets status back to `previousStatus`. |
| `list_projects` | `include_archived = false` | `id, title, description` (first paragraph of the project note), `openCount`. |
| `add_project` | `title`, `description` | Creates the project note. Errors if the title already exists. |

Each tool's `description` repeats the essential rule in one or two sentences (for example `complete_task`: "Only after the work is verified done or the owner says so. Put what was done, the root cause for bugs, and links in `outcome`."), so an agent without the skill still behaves.

### 3. The `todo-tasks` skill (rewrite)

The skill stays in `.agents/skills/todo-tasks/`, is rewritten to roughly half its current length, and is edited through the owner's `skill-edit` process. Content:

- **Stays agent-neutral** *(builder-check call)*: Codex, Claude Code, Hermes. The repo is public, so nothing owner-specific goes in the skill. A short "locate the installation" step is kept for the read-only fallback.
- **Connect:** use the `todo` MCP tools. Without them, if a signed-in Todo browser tab is available, write through it using `references/api.md`, as today. Otherwise read the vault files read-only and tell the owner to connect (Settings → Connect an agent). Never hand-edit task files or read private state.
- **Find:** `find_tasks` with the distinctive words from the owner's request. If more than one task plausibly matches, show the candidates and ask before writing.
- **Project:** inside a git repo, use the project whose title equals the repo folder name (`basename $(git rev-parse --show-toplevel)`), creating it with description `Repo: <name>` if missing. Otherwise pick the project whose description fits; if none fits, leave it unassigned. Never invent other categories.
- **Notes**, written in plain words for the owner reading later, with no filler and no secrets or credentials:
  - *On create:* one or two lines of context: where it came from (Slack/Jira/PR link), and what "done" means if the title doesn't say. Don't restate the title.
  - *While working* (milestones only): a `## Progress` section with dated one-line bullets, `- 21 Nov 12:15 — <finding>`. Appended, never rewritten.
  - *On close:* `complete_task` with `outcome`: 1–4 lines covering what was done or decided, the root cause for a bug, and how it was verified. Then `## Links` (PR, Jira, commit, trace, Slack) and `## Follow-ups` only if follow-up tasks were created.
- **Close rule:** complete only when the work is verified done or the owner says it is. Follow-ups become new tasks whose notes start `Follow-up to: <title>`.
- **Report:** the task title, what changed, and the outcome text written.

`references/api.md` stays for the browser-session fallback and gains a short MCP section. `docs/agent-skills.md` gains the MCP connection step.

### 4. Categories as data

After rollout, and with the owner's go-ahead, create these project notes in the real vault (through the UI or MCP): one project per repository the owner works in (description `Repo: <name>`), `Process & Jira` ("Moving stories, Jira subtasks, PR admin"), `Ops & DevOps` ("Environments, secrets, deploys, DevOps tasks"), and `Meetings & demos` ("Demos, discussions, syncs"). No code contains project or category names. Existing tasks stay unassigned.

Project colour comes from a hash of the project id, picked from 8 muted hues. No new stored field.

### 5. UI

**Navigation** (mockup sidebar):

- Search (⌘K), Tasks (open count) and Done.
- *Projects*, with a + button, listing active projects with open counts. Clicking one filters Tasks to it.
- At the bottom, Trash and Settings, then the save status.
- On a phone: bottom tabs Tasks / Done / Search / More (More = Settings, Trash, Projects).
- Removed views: Inbox, Today, Upcoming, All tasks (merged into Tasks), the Help page (replaced by the `?` keyboard sheet) and the "More" page on desktop.
- Archived projects, vault status, import and task versions stay reachable from Settings and the ⋯ menus.

**Tasks view:**

- **Header:** "Tasks" in serif with the long date. In a project filter, the project title plus its description; click the description to edit the project note, and archive from a ⋯ next to the title.
- **Quick add:** an always-visible input that replaces the Add task modal.
  - Enter creates the task in the current project filter (or none) with no date, and focus stays for the next task.
  - Pasting multi-line text puts the first line in the title and the rest in the notes.
  - When focused it shows project and date chips that can be changed before Enter.
- **"Now" list:** every open task without a future plan date, plus any open task whose deadline is today or past, even if its plan date is in the future (kept from today's rule in `docs/ux.md`: a future plan date never hides a due deadline). As code: `!trashed && status !== "done" && (!(scheduled > today) || (due && due <= today))`. Grouped by project in sidebar order, then "No project". Within a group, sort by deadline, then `createdAt` ascending.
- **Later:** every other open task, i.e. `scheduled > today` with no deadline due yet, sorted by date with the date on the right.
- **Row:**
  - A round check and the title. URLs become short link chips (`host-label › last two path segments`, opens in a new tab). Keys matching `\b[A-Z][A-Z0-9]{1,9}-\d+\b` become monospace key chips linking to the configured issue template; with no template they are plain text. *(Builder-check call)* Common technical prefixes are never linked: `UTF`, `SHA`, `ISO`, `RFC`, `GPT`, `MD`, `AES`, `TLS`, `HTTP`, `IPV`, `CVE`, `ES`.
  - Faint inline markers: notes, checklist `n/m`, `Due 25 Nov` (warning colour when passed), `#label`, reminder and repeat icons.
  - On hover or focus: copy-name and ⋯.
- **Opening a task** (click the title or press Enter) expands a card under the row:
  - The title becomes an inline input.
  - A properties row: project picker, date picker (Today, Tomorrow, Next Monday, Pick a date…, No date), and "+ Deadline, label…", which adds a hidden property. A set property shows as a chip with ×.
  - Notes: rendered Markdown. One click anywhere edits it (monospace textarea, auto-grow). Checkboxes toggle in place and links open without entering edit mode.
  - Footer: Complete (⌘↵) and the save state.
  - Autosave, drafts and the stale-save handling (Copy draft / Discard & reload) behave exactly as today.
  - Only one card is open at a time. Esc, clicking outside the card or opening another task closes it; pending edits still save.
- **⋯ menu:** Copy name, Open in Obsidian, Earlier versions, Move to Trash.
- **Completing:** the check fills, the row fades and slides out (~450 ms), and a toast shows "Completed · Undo".
- **Keyboard** (single keys respect the existing "shortcuts" setting):
  - N add, J/K or arrows move, Enter open or close, Esc close.
  - X complete, C copy name, E edit notes, P project, D date.
  - ⌘K find, `?` keyboard sheet.

**Done view:**

- Grouped by local completion day: Today, Yesterday, then weekday + date. It shows the last 30 days, with "Show older" for more.
- Row: filled check, title, project on the right, and below it one muted line with the first line of the `## Outcome` section (else the first line of the notes).
- Clicking a row opens the same card as in Tasks: title, properties and notes stay editable with one click, and the footer shows Reopen instead of Complete. *(Builder-check call)* Adding an outcome to a done task therefore never means reopening it, so `completed_at` is unchanged.
- Clicking the check reopens the task, with Undo. The project filter applies here too.

**Quick find (⌘K):** an overlay searching open and done titles, notes and projects. Enter opens the top result in its view; arrow keys move.

**Settings:**

- One scrolling page with sections: Connect an agent; Issue links (`issueLinkTemplate`, for example `https://<site>.atlassian.net/browse/{key}`); Appearance; Vault & Obsidian; Planning (rollover, timezone, week start); Account; Data (import/export, vault status, versions, archived projects).
- Reuse the existing Settings logic; this is a re-layout.

**Removed from the UI:** focus (checkbox, menu item, Today grouping), page taglines, select mode and bulk toolbar, "Mark ready", the Rename modal and the Add task modal.


**Visual system** (tokens are in the mockup's `:root`, light and dark):

- Warm paper neutrals, hairline dividers and one green accent.
- Inter at 14 px for the UI, 12–13 px for meta, page titles in `ui-serif` 28 px/600.
- Radii of 7–10 px, one soft shadow for the open card and popovers.
- Motion of 120–250 ms; `prefers-reduced-motion` and the app's motion setting turn it off.
- One line-art SVG for the empty state.

### 6. Model and server changes

- `core/task-views.ts`: add `inNow(task, today)` and `isLater(task, today)`; `byPriority` no longer uses `focus`.
- `preferences`:
  - Add `issueLinkTemplate: string` (default `""`, max 300, must contain `{key}` when set).
  - `startPage` is `"tasks" | "done"`.
- `server/auth.ts`: persisted sliding sessions and tokens. `server/app.ts`: `/mcp` route and bearer handling. New `server/mcp.ts` for the tools.
- Task notes no longer define a focus flag.

### 7. Verification

- **Unit and API tests** (invented temporary vaults):
  - session persistence, sliding expiry and expiry after 7 idle days
  - token create, use, revoke and wrong-token rejection
  - `/mcp` initialize, tools/list and each tool, including the conflict paths for `append_notes` and `notes`
  - `inNow`/`isLater`, supported start pages
- **`npm run check`** passes, apart from failures that already exist before the change (record the baseline first).
- **Browser acceptance** on the sandbox server at desktop and 375 px, light and dark:
  - capture with Enter
  - open, edit notes with one click, complete and Undo
  - Done shows the outcome line
  - copy name by click and with C
  - ⌘K find and the keyboard sheet
  - link and Jira chips
  - stale-save handling still shows Copy draft / Discard
- **External check:** a real Claude Code session connected to the sandbox `/mcp` with a sandbox token runs "find the trace task, add a progress note, then close it with an outcome" and the vault note shows the expected sections.

### 8. Rollout (each step needs the owner's go-ahead)

1. Rebuild and restart the Docker instance (`docker compose up -d --build`). This is one last sign-out.
2. The owner signs in, creates a token and runs the shown `claude mcp add` command themselves.
3. Seed the category projects (section 4) and set the issue-link template.
4. Link `~/.claude/skills/todo-tasks` to the repo skill, and add a short routing rule to `~/.claude/CLAUDE.md` via `skill-edit`.
5. Update `app/AGENTS.md` (Daylight line), `README.md`, `docs/ux.md` and `docs/agent-skills.md`.

No commits unless the owner asks.

## Left to the builder

Component structure and file split (e.g. moving views out of `App.tsx`), CSS organisation, exact chip truncation lengths, popover positioning, and whether the date picker reuses `DateControl`.
