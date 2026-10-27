# Setup and everyday operation

Todo needs one running server and a browser. Your dedicated Obsidian vault is the data source; private account settings and recovery copies are stored separately. Linux ARM64 is the platform exercised here. The browser app and source scripts support standard Node environments; other OS acceptance remains to be checked on those devices.

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

The launcher installs the locked dependencies when absent, builds absent/outdated output, then serves Todo in the same Node process. Future starts do not keep a builder or launcher child running. An internet connection is needed for the first dependency installation. `npm run setup` explicitly repeats the clean install and build.

A fresh start creates the complete `Todo Vault/` scaffold: Tasks, Projects, Attachments, Templates, Obsidian configuration, a Home guide and Tasks.base. An existing empty Docker mount is also initialized. An existing vault is retained; its note files and custom setup are never replaced.

Open http://localhost:4310. The generated initial login is written privately to `.todo-state/server/initial-login.txt` (0600 permissions) and its path is printed. Read the file locally, sign in, then set your own password in Settings → Vault & connection. The file is removed after the password changes. Restarting the server clears browser sessions and requires signing in again.

Open `Todo Vault/` in Obsidian. To let a local assistant review progress, give it read access to the vault. It can read Markdown without an API or AI provider connection. `Home.md` describes active/completed/trashed tasks, date fields, history and recurrence links.

For personal task management from any project, install the portable `todo-tasks` skill and a short routing rule using the [Codex, Claude Code and Hermes setup guide](agent-skills.md). It also covers the separate `todo-setup` skill. A clone includes the skill sources; each machine supplies its own vault paths, global installation and agent permissions.

## Desktop shortcuts

Once Chrome/Chromium is installed, `npm run launchers:install` creates separate Todo and Mini Today icons for the current OS. Use `-- --url https://your-server.example` when this computer connects to a remote server. The shortcuts reuse Chrome and do not start another vault server. See [platform commands, architecture guidance and agent setup](desktop-launchers.md).

For an agent, the reusable entry point is [.agents/skills/todo-setup/SKILL.md](../.agents/skills/todo-setup/SKILL.md). It checks the destination OS/CPU, preserves existing data/configuration and verifies both routes.

## Configuration

Copy `.env.example` to `.env` at the repository root and uncomment the settings you need. Existing environment variables take precedence. `npm start` loads this file; Docker Compose also reads it. Direct `server:dev` or `npm run dev` commands take environment variables from your shell.

| Node setting | Default | Meaning |
| --- | --- | --- |
| `VAULT_PATH` | `../Todo Vault` | Vault path, relative to `app/` or absolute |
| `STATE_PATH` | `../.todo-state/server` | Private account/recovery folder outside the vault |
| `HOST` | `127.0.0.1` | Address to listen on |
| `PORT` | `4310` | Port from 1 to 65535 |
| `PUBLIC_ORIGIN` | `http://localhost:4310` | Exact browser origin, with your configured port |

For a different port, set both `PORT` and `PUBLIC_ORIGIN`. The origin accepts only HTTP/HTTPS plus hostname and optional port; paths, embedded credentials and query parameters are refused. Do not use symlinks as vault or private-state folders.

A setup error is printed without credentials. If the vault is busy, connect to its running server or stop that server before starting another. If an interrupted initial account setup left `initial-login.txt` without `owner.json`, restore both files from a trusted backup or move the orphan login file aside and restart. Existing account files are never silently reset.

## Docker

On Linux/macOS, run `./start-docker.sh`. This creates an absent `.env` containing your host UID/GID, creates mount directories without replacing existing data and runs Compose. The service restarts automatically with Docker. See [Docker runbook](docker.md) for manual/Windows setup, health, remote hosting and container verification.

Do not run the Node server and Docker server against the same vault simultaneously. To switch, stop the current server, retain both vault and state folders, then start the other one with those same paths.

## Update and back up

Stop Todo before copying both the entire vault and `.todo-state/server/` to your backup destination. Protect the state backup as private data. Restore those two folders together. ZIP export contains indexed task/project notes only; it is not a complete vault backup.

For source updates, stop the server, update the source, run `npm run setup`, then `npm start`. For Docker updates, run `./start-docker.sh` again. Neither operation deletes vault files, owner credentials or recoverable history.

Reminders require Todo or Mini Today open in a browser. Enable browser notifications in Settings if you want system alerts. A device asleep or a page suspended cannot deliver exactly on time; due reminders catch up on return. Unfinished-date rollover runs on the server and catches up after downtime even when no browser page is open.
