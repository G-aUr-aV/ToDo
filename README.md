# Todo — Daylight

[![Validate Todo web app](https://github.com/G-aUr-aV/ToDo/actions/workflows/build.yml/badge.svg)](https://github.com/G-aUr-aV/ToDo/actions/workflows/build.yml)

A small personal task website that keeps your data in a dedicated Obsidian vault. Every task is an ordinary Markdown note. Use Todo in your browser, or install Todo and Mini Today as separate Chrome app windows on Linux, Mac or Windows.

One Node server owns one vault. There is no Electron runtime, task database, sync service or AI account to configure. Docker is optional.

## Start

With **Node 24.18 or newer in the Node 24 line**, run from this folder:

```sh
npm start
```

The first start installs locked dependencies, builds the app and creates `Todo Vault/` and private `.todo-state/server/` if needed. Later starts reuse the build unless sources changed. Open **http://localhost:4310**. The terminal gives the path to `initial-login.txt`; read it locally, sign in as `owner`, then change the generated password in **Settings → Vault & connection**. Passwords are never printed in the terminal.

Open `Todo Vault/` through Obsidian's **Open folder as vault**. Keep the server running while using Todo. Stop it with Ctrl+C. Only one server should open a vault at once; browser windows all share that server.

For Docker on Linux/macOS, with Docker Compose installed:

```sh
./start-docker.sh
```

The helper creates absent local configuration with your host user IDs, prepares the mount folders and builds/starts the service. Open the same localhost address. Existing `.env`, notes and account state are retained. Windows users can use the Node command above, or the manual [Docker runbook](docs/docker.md).

Optional settings are documented in [.env.example](.env.example). Copy it to `.env` before changing paths, port or public origin. Source paths are relative to `app/`; Docker paths are relative to this folder. Account/recovery state must stay outside the vault. [Setup, updating and backups](docs/setup.md).

## Plan and finish work

Today, Inbox, Upcoming, projects, labels, search, focus, Markdown notes/checklists, independent plan dates and deadlines, completion/Undo, Trash/restore, recovery, import/export, dark theme and responsive layouts are included.

- **Automatic rollover:** unfinished tasks planned before today move to today in your workspace timezone, including missed days while the server was stopped. Deadlines stay fixed. Markdown properties record the original plan and roll count. Disable it in Settings for manual planning.
- **Reminders:** choose a date/time in the workspace timezone. Todo and Mini show due reminders with snooze/dismiss; enable browser notifications in Settings for system alerts. Keep either page open. Sleeping devices, suspended tabs and a stopped server can delay delivery; missed reminders appear on return. Closed-page push notifications are not provided.
- **Repeating tasks:** daily, weekly or monthly, with a chosen interval. Completing an occurrence keeps its history and creates one future task. Missed occurrences are skipped; month-end dates keep their intended day. Undo handles the untouched generated occurrence safely.
- **Mini Today:** http://localhost:4310/mini shows remaining tasks, overdue work and quick completion/Undo. It shares your vault, login and reminders with full Todo.

To add separate **Todo** and **Todo Mini Today** desktop launchers on Linux, macOS or Windows, run:

```sh
npm run launchers:install
```

The helper detects Chrome/Chromium and creates shortcuts for your OS. Both reuse the browser and need the server. For a remote server, pass `-- --url https://your-server.example`. [Platform helpers and options](docs/desktop-launchers.md). You can also use Chrome's **menu → Cast, save, and share → Install page as app** on Todo and `/mini`.

For agent-assisted setup, ask **“Set up Todo on this computer using the todo-setup skill.”** The [portable skill](.agents/skills/todo-setup/SKILL.md) checks OS, CPU architecture, server and browser before installing the launchers. An agent without skill discovery can read that file directly. [Mini behavior](docs/mini-today.md).

## Your notes and progress

Tasks live in `Tasks/`; project context lives in `Projects/`. Task YAML includes `status`, `scheduled`, `due`, `completed_at`, `tags` and a project wiki link. Markdown bodies hold notes and subtasks. Rollovers add `original_scheduled`, `rollover_count` and `last_rolled_at`. Repeating occurrences link through `recurrence_source_id` and `next_occurrence_id`; reminders use `reminder_at` with an explicit timezone.

Your assistant can read the vault directly to review plans, completed work and progress. No API key, LLM integration or proprietary database is needed. `Home.md` explains the format. Exclude `trashed: true` notes when reviewing active work, and preserve each note's UUID `id`.

For a single day, open `Days/YYYY-MM-DD.md` instead of scanning every task. Todo maintains linked day lists with completed tasks struck through. Rescheduling and rollover move unfinished entries out of the old day. `Days/README.md` lists available days; `Days/Unscheduled.md` holds undated tasks. Lists refresh while the server runs; the linked task notes remain authoritative.

Custom YAML properties, comments and Markdown bodies are preserved during metadata edits. Invalid or duplicate notes stay untouched and appear in vault status. Body checkboxes are subtasks; top-level completion uses `status`. Ordinary Obsidian edits are detected automatically.

The app autosaves and retains unsaved drafts on the device. If an Obsidian edit changes the same note while you edit, saving pauses and offers **Copy draft** or **Discard draft & reload**. Revision checks, recoverable versions and exact Undo protect your notes without a merge workflow. Back up both vault and private state; recovery copies stay outside the vault. [Storage architecture](docs/architecture.md) and [vault format](docs/vault-format.md).

## Development and verification

```sh
npm run setup       # explicit clean dependency install + build, if desired
npm run dev         # UI at http://localhost:4173, API at 4313; needs an unused vault
npm run check       # TypeScript, core/API/setup tests, production build, real HTTP startup smoke
npm run test:launchers # desktop shortcut checks; no app dependencies required
```

Use temporary `VAULT_PATH`/`STATE_PATH` directories when developing with a production server already running. `npm run check` uses invented temporary vaults and needs permission to listen on loopback. See the [development guide](docs/development.md) for the source layout and repeatable checks, and the [UX guide](docs/ux.md) for the product behavior.

## License

Todo is available under the [MIT License](LICENSE). Bundled [Tabler icons](app/public/icons/LICENSE) and the [Inter font](app/public/fonts/OFL.txt) retain their own license notices.
