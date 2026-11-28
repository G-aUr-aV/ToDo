# Todo

[![Validate Todo web app](https://github.com/G-aUr-aV/ToDo/actions/workflows/build.yml/badge.svg)](https://github.com/G-aUr-aV/ToDo/actions/workflows/build.yml)

A personal planner for a regular browser tab. Today shows the work you planned and any deadlines that need attention. One Node server stores tasks, projects, preferences and task history in SQLite. Browser tabs and MCP clients use the same workspace.

**Upgrading an existing Markdown vault?** Stop the old writer and follow the [migration and recovery guide](docs/setup.md#upgrade-a-markdown-vault) before starting the new release.

## Start

With **Node 24.18 or newer in the Node 24 line**, run from this folder:

```sh
npm start
```

On macOS or Linux without a suitable Node, or to keep Todo off your global Node, use the project-local copy instead. It installs the version pinned in `.node-version` into gitignored `.tools/` and leaves global Node, nvm defaults and other projects unchanged:

```sh
scripts/local-node.sh npm start
```

Prefix any other `npm`/`node` command in this README the same way. Windows uses an installed Node 24.

The first start installs locked dependencies, builds the app and creates a SQLite database in private `.todo-state/server/` if needed. Later starts reuse the build unless sources changed. Open **http://localhost:4310**. The terminal gives the path to `initial-login.txt`; read it locally, sign in as `owner`, then change the generated password in **Settings → Account**. Passwords are never printed in the terminal.

Keep the server running while using Todo. Stop it with Ctrl+C. Browser windows all connect to that server.

For Docker on Linux/macOS, with Docker Compose installed:

```sh
./start-docker.sh
```

The helper creates absent local configuration with your host user IDs, prepares the mount folders and builds/starts the service. Open the same localhost address. Existing `.env`, notes and account state are retained. Windows users can use the Node command above, or the manual [Docker runbook](docs/docker.md).

Optional settings are documented in [.env.example](.env.example). Copy it to `.env` before changing paths, port or public origin. Source paths are relative to `app/`; Docker paths are relative to this folder. Account/recovery state must stay outside the vault. [Setup, updating and backups](docs/setup.md).

## Plan and finish work

- **Today** shows tasks planned for today or earlier and tasks due today or overdue. Capturing here schedules the task for today.
- **All tasks** includes future and unscheduled work. **Upcoming** groups future plans by day and lets you move several tasks while keeping their deadlines.
- Click a title to edit notes, checklists, dates, reminders or recurrence. Completed work goes into **Done**. Reopen it there, or use Undo immediately. Trash and version history provide additional recovery.
- Rollover uses the workspace timezone. Daily, weekly and monthly repeats create the next occurrence on completion. Reminders support snoozing and dismissing while Todo is open.
- Use search and the keyboard shortcuts in the app for quick navigation. Light and dark themes, larger text and reduced motion are available in Settings.
- Connect an MCP client with a token from **Settings → Agent access**. The browser and agents use the same revision checks and history. [Agent setup guide](docs/agent-skills.md)

## Storage and recovery

Keep the state directory on a persistent local volume. It holds `todo.sqlite` and private owner, session and token files. Back up the complete workspace before an upgrade and rehearse restoring it to a fresh directory. A browser database download contains application data and history. A full backup also preserves sign-in and agent access. [Setup and recovery](docs/setup.md) · [Architecture](docs/architecture.md)

## Development and verification

```sh
npm run setup       # explicit clean dependency install + build, if desired
npm run dev         # UI at http://localhost:4173, API at 4313; use isolated storage
npm run check       # TypeScript, core/API/setup tests, production build, real HTTP startup smoke
```

Use temporary `VAULT_PATH`/`STATE_PATH` directories when developing with a production server already running. `npm run check` uses invented temporary workspaces and needs permission to listen on loopback. See the [development guide](docs/development.md) for the source layout and repeatable checks, and the [UX guide](docs/ux.md) for the product behavior.

## License

Todo is available under the [MIT License](LICENSE). Bundled [Tabler icons](app/public/icons/LICENSE) and the [Inter font](app/public/fonts/OFL.txt) retain their own license notices.
