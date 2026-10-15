# Implementation decisions — web-only Todo

Todo is a lightweight personal website with optional Chrome app windows and one self-hosted vault server.

## One interface and one engine

React, TypeScript and Vite build the full website and a separate Mini Today entry. Node 24 and Fastify serve the assets and same-origin API. `app/core/` owns Markdown parsing, validation, indexing, writes, imports and recovery. `app/server/` exposes that engine to every browser window. Desktop launchers are small shortcuts to the installed Chrome/Chromium browser.

Docker is optional server deployment. A client uses an ordinary browser or Chrome's installed-site mode. Full Todo and Mini have distinct install manifest identities; both share the same origin/session. There is no second task database, local native engine or offline write queue.

## Vault storage

Notes are authoritative. A rebuildable in-memory index scans the dedicated vault; tasks use UUIDs and stable filenames. Titles can change without renaming notes, and external file renames are followed by identity. Duplicate IDs disable ambiguous writes rather than choosing a note. Project references are wiki links.

The YAML Document API preserves unknown properties and comments. Metadata edits keep the Markdown body. GFM checklist parsing changes real task markers without modifying examples inside fenced code. Raw HTML and automatic remote image loading are excluded from the preview.

The engine serializes writes, checks a SHA-256 revision, saves the replaced note, flushes a temporary file and renames it atomically. One fixed `.todo-writer.lock` lease coordinates server instances opening the same vault through different mount paths. Chokidar watches note folders, with periodic reconciliation. Unchanged raw content reuses plain metadata instead of reparsing YAML source trees; disk content is still read, so same-size/same-mtime Obsidian edits are observed. Automatic rollover serializes the batch and scans once after writing, while each note retains its revision/recovery checks. Symlink notes are skipped, and parent paths are canonicalized.

Obsidian does not participate in the app's lock. A save racing after the final revision check remains a filesystem limitation; recovery records versions the engine observed.

## Planning and readable history

The server rolls unfinished scheduled tasks forward to the workspace's current date by default, including after downtime. Deadlines are independent. `original_scheduled`, `rollover_count` and `last_rolled_at` retain the plan history; disabling `autoRollover` leaves dates under manual control.

Tasks can store an explicit timezone-aware `reminder_at` and daily/weekly/monthly `repeat`. A completed recurring note is retained and links to one generated successor; the successor resets real checklist markers while preserving fenced examples. Deterministic next IDs and stored creation/revision flags support restart repair and safe Undo without a second task database. Browser reminders read this same metadata and need an open full/Mini page.

A local assistant can read the vault's status/date/completion fields, linked projects, checklist bodies and recurrence history directly. `Home.md` documents the format. Private account settings and recovery remain outside the vault; no LLM/provider integration is needed.

## Simple editing

Editing autosaves after 800 ms. Acknowledged writes report Saved to vault. Unsaved drafts stay in browser storage, namespaced by vault identity; failed storage warns that the draft is only in memory. Create request UUIDs avoid duplicates on retry.

The personal app has no conflict modal, comparison view or merge editor. If a newer vault revision arrives while a draft is dirty, autosaving pauses. The existing editor keeps that draft and offers **Copy draft** or **Discard draft & reload**. Copy includes title, notes and task fields. Discard fetches the latest note and does not write to the vault. A stale list action refreshes the list and asks the owner to try again. No automatic overwrite or merge occurs.

The server's small stale-revision check remains, including for Undo/restores. It protects one person's browser-versus-Obsidian edits as well as multiple browser windows. Recovery and exact Undo use the same observed version copies; Trash remains reversible. These features do not require the removed merge workflow.

## Browser security and session

The server supports one owner and vault. Authentication uses HttpOnly SameSite cookies, Secure under HTTPS, login throttling and CSRF/Origin/Host checks. Sessions expire when the server restarts. API responses are no-store; HTML and install manifests revalidate. CSP restricts executable content to the app. Markdown HTTPS links use normal browser navigation; Obsidian handoff uses a device-specific vault name.

Browsers refresh through server events, opaque same-origin BroadcastChannel invalidations and periodic checks. Mini requests an authenticated metadata-only Today projection and loads separately from full editing, Markdown and ZIP export code. Appearance is shared on the same browser/device. Disconnected Mini shows its last in-memory update and disables writes; sign-out clears the summary.

## Build and maintenance

`npm run check` checks TypeScript, runs core/API/setup/UI-logic tests, builds web/server output and exercises the packaged server over real HTTP. `npm start` installs missing locked dependencies and rebuilds only absent/stale output, then runs in one Node process. Missing or empty vaults receive a complete scaffold through exclusive file creation. The build bundles the ESM Markdown parser and keeps Fastify/filesystem runtime packages external; production omits frontend/build dependencies. CI checks desktop launchers on Linux/macOS/Windows, validates the web app and builds the Docker image.

[Development and checks](development.md), [vault format](vault-format.md), [Mini behavior](mini-today.md), [Docker operations](docker.md).
