# Self-hosted Docker runbook

Run one Todo server with bind-mounted vault and private-state folders. The isolated image smoke checks authentication, Markdown writes, host-side edits, rollover, reminders/recurrence metadata, recovery and recreation using temporary data.

## Start locally

On Linux/macOS, from the repository root:

```sh
./start-docker.sh
```

The helper creates absent `.env` with the current host UID/GID, prepares vault/state mounts and runs `docker compose up -d --build`. Existing configuration and data are retained. Docker and Docker Compose are the only required runtimes; Node is not needed on the host.

Manual setup (including Windows PowerShell): create a `Todo Vault` folder and `.todo-state/server` folder, copy `.env.example` to `.env`, set `TODO_UID` and `TODO_GID` if needed, then run:

```sh
docker compose up -d --build
docker compose ps
```

On Unix hosts protect the state folder with `chmod 700 .todo-state/server`. Both bind-mounted folders must exist; an empty vault mount receives the same Obsidian scaffold as a fresh source install. Do not recursively change ownership of an existing vault without checking its current owner.

Open http://localhost:4310. Read the generated owner login locally at `.todo-state/server/initial-login.txt`; its permissions are 0600. Change it in Settings → Vault & connection. No credentials are in the image, Compose file or source. `TODO_PORT` changes the localhost port; the default public origin follows it unless `TODO_PUBLIC_ORIGIN` is explicitly set.

The container runs as the configured unprivileged user with a read-only root filesystem, temporary `/tmp`, dropped capabilities and no new privileges. The host port is bound to 127.0.0.1. The Dockerfile pins the official Node 24 Debian slim manifest digest and excludes private files from build context.

## Normal operations

```sh
docker compose logs --tail=50 todo
docker compose stop
docker compose start
docker compose up -d --build
```

Stopping or recreating the container retains the bind-mounted vault and state. Keep those directories. `/healthz` reports process liveness; `/readyz` checks the vault and write capability. Docker's healthcheck probes readiness every 30 seconds; readiness rechecks task/state write access. Event connections close before shutdown so an open browser cannot hold a normal stop indefinitely.

Only one Todo server engine opens a vault for writing. Full and Mini browser windows all connect to that server. The fixed hidden `.todo-writer.lock` directory coordinates ownership even when the same folder has different container/host paths. A crashed lease becomes stale after 30 seconds; never remove a live writer's lock.

## Backups and recovery

Back up the entire vault and state directory. Close Obsidian and stop the server for a quiescent copy. State includes preferences, owner authentication configuration and `versions/<task-id>/` recovery copies. Protect backups as private data.

The app keeps all recovery copies and lists the newest 100 per task. A reviewed restore also saves the note it replaces. Trash is reversible. Exports contain indexed task/project notes, not attachments, Obsidian configuration, credentials or a complete vault backup.

Ordinary Obsidian changes are detected through filesystem watching and periodic reconciliation. Test your real storage: network shares and Docker Desktop mounts differ. Revision checks cannot eliminate every simultaneous external-save race.

## Access from another device

The included setup remains local. For deliberate remote hosting, choose a hostname, add HTTPS through your reverse proxy and set `TODO_PUBLIC_ORIGIN=https://your-hostname`. Preserve that Host header and proxy event streams. Route the app at the origin root, including `/api`. Expose only the proxy intentionally; do not replace the loopback binding casually.

The server uses one owner/workspace, HttpOnly SameSite cookies, secure cookies under HTTPS, CSRF/Origin/Host checks and login throttling. Session memory is cleared by a restart. Use HTTPS when opening this server from another device.

Docker does not synchronize another device's Obsidian files. A phone can use the responsive website; opening the same notes in phone Obsidian needs a separate vault-sync arrangement.

## Reproduce the isolated verification

```sh
docker build -t todo-daylight:0.1.0 .
cd app
node scripts/docker-smoke.mjs
```

The script creates a temporary vault, uses loopback port 4312, writes only invented tasks, recreates its own named container and cleans up that container. It keeps fixture credentials out of logs, removes its temporary vault/state at the end and prints the check results to standard output. It never uses the owner's Todo Vault.

The helper itself can be tested from the repository root with `node app/scripts/compose-smoke.mjs`. It copies a clean fixture checkout, uses its own Compose project on port 4314, verifies repeat-run preservation, then removes that project and temporary data. It prints results to standard output. `TODO_COMPOSE_SMOKE_PORT` overrides the fixture port.

## Sources

- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- [Compose services](https://docs.docker.com/reference/compose-file/services/)
- [Official Node images](https://github.com/nodejs/docker-node)
- [Implementation decisions](architecture.md)
