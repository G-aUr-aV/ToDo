# Running Todo with Docker

Compose runs one non-root Node server with a local persistent state volume. The default loopback address is `http://localhost:4310`. Browser tabs and authorized agents connect to this server. The SQLite database, recovery history and private account state survive container replacement.

## Fresh installation

From the checkout, run `./start-docker.sh` on Linux or macOS. The helper preserves existing environment settings. For manual setup, create the host state and legacy-source directories from `.env.example`, configure the container UID/GID for your host, and run `docker compose up -d --build`. For private state on Unix use permissions 0700. The generated first login is in the host state directory, in `initial-login.txt`.

The state directory must be writable. The ordinary server only reads the legacy vault location to detect installations that still require migration. Use local storage for SQLite. The container has a read-only root, temporary `/tmp`, dropped capabilities and a loopback-bound port.

## Upgrading a Markdown installation

Keep the current app image and settings for rollback. Stop the old writer, close any external editor that might save notes, and build the new image before starting it. The following paths use Compose's default legacy mount (`/vault`) and state mount (`/state`). Replace the example absolute host paths with your configured bind sources. Create a new private host backup parent outside both source folders, writable by the configured container user.

```sh
docker compose stop todo
docker compose build todo
docker compose run --rm --no-deps todo node dist/server/storage-cli.cjs import --vault /vault --state /state --dry-run
docker compose run --rm --no-deps -v "/absolute/legacy/vault:/vault:rw" -v "/absolute/backups:/backups" todo node dist/server/storage-cli.cjs import --vault /vault --state /state --backup /backups/before-upgrade
docker compose up -d todo
docker compose ps
```

The import takes a temporary writer lock in the old vault. Use the same in-container path the previous release used so the browser recognizes existing drafts. Keep the migration archive. The [recovery guide](setup.md#back-up-and-restore) covers verification and rollback after the new database accepts writes.

## Operation and backup

`docker compose logs --tail=50 todo` shows startup information. `/healthz` reports liveness and `/readyz` reports workspace readiness. Browser sessions survive restart. Settings provides a database download. For the full database and account state, stop the server and run the packaged CLI with a private backup bind mount.

```sh
docker compose stop todo
docker compose run --rm --no-deps -v "/absolute/backups:/backups" todo node dist/server/storage-cli.cjs backup --state /state --backup /backups/todo-current
docker compose start todo
```

To rehearse recovery, use a fresh target directory. Supply a read-only backup mount and a writable parent mount that can contain the restored directory.

```sh
docker compose run --rm --no-deps -v "/absolute/backups:/backups:ro" -v "/absolute/rehearsals:/restore" todo node dist/server/storage-cli.cjs restore --backup /backups/todo-current --state /restore/test-state
```

For remote access, configure HTTPS through a reverse proxy, preserve the Host header, proxy events, and set `TODO_PUBLIC_ORIGIN` to the exact external origin. The browser and API share the origin root.

## Isolated verification

Build a separately tagged image and point the Docker smoke test at that tag with `TODO_SMOKE_IMAGE`. `node app/scripts/docker-smoke.mjs` uses invented data and its own container. `node app/scripts/compose-smoke.mjs` tests the helper with a temporary checkout and Compose project.
