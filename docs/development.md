# Development

Use Node 24.18 or newer within the Node 24 line. Run commands from the repository root unless stated otherwise.

## Source layout

| Path | Responsibility |
| --- | --- |
| `app/src/` | Full Todo and Mini Today React interfaces |
| `app/core/` | Markdown model, vault operations, dates, rollover and recurrence |
| `app/server/` | Fastify API, owner authentication and storage setup |
| `app/public/` | Browser manifests, icons and licensed font |
| `app/scripts/` | Setup, development, build, startup and deployment checks |
| `app/tests/` | Core, API, setup and UI-logic regression tests |
| `launchers/` | Chrome shortcuts and platform installer entry points |
| `.agents/skills/todo-setup/` | Portable agent instructions for setup |
| `Dockerfile`, `compose.yaml`, `start-docker.sh` | Optional server deployment |

See [architecture](architecture.md), [vault format](vault-format.md), [UX](ux.md), [Mini Today](mini-today.md) and [setup](setup.md).

## Local development

Install dependencies and build with `npm run setup`. Point `VAULT_PATH` and `STATE_PATH` at unused temporary directories before running `npm run dev`. Paths are relative to `app/` unless absolute. The UI listens at http://localhost:4173 and the API at port 4313. Full and Mini use the same API.

Never use the owner's vault or private state for task-writing tests. Keep one server per vault, and preserve running installations while developing.

## Repeatable checks

```sh
npm run check
npm run test:launchers
```

`check` runs TypeScript, core/API/setup/UI-logic tests, the production build and a real HTTP startup smoke. The smoke exercises authentication, Markdown persistence, recurrence/checklists, live event shutdown and restart behavior against invented temporary data. It needs loopback access.

To include dependency installation from a clean temporary checkout:

```sh
TODO_SMOKE_CLEAN_INSTALL=1 npm --prefix app run test:setup
```

Launcher tests use temporary output folders and check native shortcut formats on each OS. CI runs them on Ubuntu, macOS and Windows; the web job runs `check` and builds the Docker image. For isolated Docker image and Compose-helper checks, follow the [Docker runbook](docker.md). Results go to standard output.

## Browser acceptance

Use an invented vault to check full Todo and `/mini`: capture, schedule, completion/Undo, external Obsidian edits, retained drafts after a stale save, reminders, recurrence, sign-out/reconnect, narrow layouts and keyboard navigation. Test Chrome windows and Obsidian handoff on the destination device. Native screen readers, notification permissions, long sessions and deployment-specific backup/restore need direct acceptance.

## Optional Sites packaging

The static Sites adapter in `app/worker/` and hosting configuration in `app/.openai/` are retained. They do not replace the Node vault server. After building, check packaging from `app/`:

```sh
node scripts/prepare-sites-build.mjs
node --test tests/sites-worker.test.mjs
```

Generated `dist/` output and `node_modules/` are ignored. Real vault data, `.todo-state/` and local `.env` files also stay outside version control.
