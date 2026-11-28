# Setup and everyday operation

Todo needs one running server and a browser. Todo stores your workspace in SQLite and keeps account credentials in the private state directory. Linux ARM64 is the platform exercised here. The browser app and source scripts support standard Node environments; other OS acceptance remains to be checked on those devices.

## Node setup

Install Node 24 LTS, version 24.18 or later within Node 24. From the repository root run:

```sh
npm start
```

### Project-local Node (macOS/Linux)

`scripts/local-node.sh` keeps Todo's Node inside this checkout. On first use it downloads the official build pinned in `.node-version` for the detected OS/CPU (native ARM64 on Apple silicon, even under Rosetta), checks it against Node's published SHA-256 sums and unpacks it into gitignored `.tools/`. It then runs the given command with that Node first on `PATH`; nothing else on the system changes.

```sh
scripts/local-node.sh install     # install or confirm the pinned Node
scripts/local-node.sh npm start   # any npm/node command
```

To update, change `.node-version` and run `install`; older copies in `.tools/` are removed. Delete `.tools/` to remove it entirely. `.node-version` is also read by fnm, mise and nodenv if you prefer a version manager.

The start command installs the locked dependencies when absent, builds absent/outdated output, then serves Todo in the same Node process. An internet connection is needed for the first dependency installation. `npm run setup` explicitly repeats the clean install and build.

A fresh start creates a SQLite workspace and private account state. A legacy vault requires an explicit import.

Open http://localhost:4310. The generated initial login is written privately to `.todo-state/server/initial-login.txt` (0600 permissions) and its path is printed. Read the file locally, sign in, then set your own password in Settings → Account. The file is removed after the password changes. Your session stays signed in for a week from last use and survives server restarts.

For personal task management from any project, install the portable `todo-tasks` skill and a short routing rule using the [Codex, Claude Code and Hermes setup guide](agent-skills.md). It also covers the separate `todo-setup` skill. A clone includes the skill sources; each machine supplies its own vault paths, global installation and agent permissions.

## Configuration

Copy `.env.example` to `.env` at the repository root and uncomment the settings you need. Existing environment variables take precedence. `npm start` loads this file; Docker Compose also reads it. Direct `server:dev` or `npm run dev` commands take environment variables from your shell.

| Node setting | Default | Meaning |
| --- | --- | --- |
| `VAULT_PATH` | `../Todo Vault` | Legacy source location checked at startup, relative to `app/` or absolute |
| `STATE_PATH` | `../.todo-state/server` | Persistent folder for the SQLite database and private account state, outside the legacy vault |
| `HOST` | `127.0.0.1` | Address to listen on |
| `PORT` | `4310` | Port from 1 to 65535 |
| `PUBLIC_ORIGIN` | `http://localhost:4310` | Exact browser origin, with your configured port |

For a different port, set both `PORT` and `PUBLIC_ORIGIN`. The origin accepts only HTTP/HTTPS plus hostname and optional port; paths, embedded credentials and query parameters are refused. Do not use symlinks as vault or private-state folders.

A setup error is printed without credentials. If the vault is busy, connect to its running server or stop that server before starting another. If an interrupted initial account setup left `initial-login.txt` without `owner.json`, restore both files from a trusted backup or move the orphan login file aside and restart. Existing account files are never silently reset.

## Docker

On Linux/macOS, run `./start-docker.sh`. This creates an absent `.env` containing your host UID/GID, creates mount directories without replacing existing data and runs Compose. The service restarts automatically with Docker. See [Docker runbook](docker.md) for manual/Windows setup, health, remote hosting and container verification.

Do not run the Node server and Docker server against the same vault simultaneously. To switch, stop the current server, retain both vault and state folders, then start the other one with those same paths.

## Upgrade a Markdown vault

Use the Node runtime or the Docker procedure in the [Docker runbook](docker.md). Keep the old release and its configuration available. Build the new tools with `npm run build` from an installed checkout. Supply absolute paths to the existing vault and its matching private state.

```sh
npm run migrate -- --vault "/path/to/Todo Vault" --state "/path/to/private-state" --dry-run
```

Review the report. Unresolved items prevent cutover. Optionally pass `--resolutions /path/to/resolutions.json` to specify which source files to archive or how to resolve project links. For example:

```json
{
  "archive": ["vault/Tasks/unsupported-example.md"],
  "projects": {"Tasks/ambiguous-example.md": "86b25702-c66d-4c38-99fa-bd293588a1a5"}
}
```

Archived items remain in the full backup. For a missing project, an explicit `null` keeps the task with no project. Stop the old server and close editors that could write to the source. Choose a new, private backup directory outside both input directories. Run the import in the same path context as the old server to preserve browser draft identity.

```sh
npm run migrate -- --vault "/path/to/Todo Vault" --state "/path/to/private-state" --backup "/backups/todo-before-upgrade"
```

Keep the resulting archive. Start the new app with the matching state directory, sign in with the existing account, and check project counts, a completed task, a recurring task and version history. Verify an agent can read the same workspace.

## Back up and restore

Stop the writer for a complete backup, including sign-in and agent credentials. Use new, private directories for the destination.

```sh
npm run backup -- --state "/path/to/private-state" --backup "/backups/todo-current"
npm run restore -- --backup "/backups/todo-current" --state "/path/to/restored-state"
```

Point the server at the restored state directory to verify it. Preserve the previous state until verification succeeds. **Settings → Data** also offers a database-only download. Restore it into a fresh state directory. Omit `--auth-state` for a new owner setup, or include the stopped installation’s private state to retain authentication.

```sh
npm run restore -- --database "/backups/todo.sqlite" --state "/path/to/fresh-state" --auth-state "/path/to/stopped-state"
```

Protect both kinds of backup as private data.

Before the upgraded server accepts writes, rollback can use the old server with the archived vault and matching private state. After it accepts writes, save a complete SQLite backup and reconcile the newer changes before reverting. The frozen vault only contains data through the cutover.

Reminders require an open browser tab. Rollover runs on the server and catches up after downtime.
