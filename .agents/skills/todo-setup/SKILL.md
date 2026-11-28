---
name: todo-setup
description: Set up and verify the Todo web server on Linux, macOS or Windows. Reuse existing workspaces and account state and open the configured URL in a browser.
---

# Set up Todo

Todo runs in a browser with one SQLite-backed Node/Fastify server. Reuse the existing server when it already owns the workspace.

For installing these skills across projects or setting up another agent's global Todo routing, read [the agent setup guide](../../../docs/agent-skills.md). This is separate from installing the Todo application itself.

## Locate the project and destination

Find the Todo source root containing `app/scripts/start.mjs`, `app/package.json` and `docs/setup.md`. This skill normally lives at `<root>/.agents/skills/todo-setup`; resolve symlinks before walking three directories up. If copied independently, locate the user's checkout or ask for its path; there is no assumed public clone URL. Read the relevant parts of `docs/setup.md` before changes.

Identify the server host and the browser device. A remote server must use a reachable address that matches `PUBLIC_ORIGIN`. For hosting or network changes, read `docs/docker.md`.

## Detect platform and prerequisites

- POSIX: `uname -s` and `uname -m`; check `node --version` if installed. On macOS, `sysctl -n hw.optional.arm64` detects Apple silicon even when a shell or Node is translated through Rosetta.
- Windows PowerShell: `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` gives the OS CPU; `$env:PROCESSOR_ARCHITECTURE` and `$env:PROCESSOR_ARCHITEW6432` help with an emulated process. `node -p "process.platform + '/' + process.arch"` describes Node itself, which can differ from the OS architecture.
- Normalize `arm64`/`aarch64` to 64-bit ARM, and `x64`/`x86_64`/`amd64` to 64-bit Intel/AMD. Generic `arm`, `armv7l` and 32-bit `x86` are not ARM64/x64; do not download a 64-bit package blindly.

Use **Node 24.18 or newer in the Node 24 line** and npm on the server. On macOS/Linux, `scripts/local-node.sh npm start` uses the Node version pinned in `.node-version`. A browser client needs only the reachable server URL.

## Reuse or start the server

If the chosen origin's `/readyz` succeeds and `/` loads, reuse it. A healthy existing Docker deployment also counts; do not start Node against its vault. If the address is not reachable, identify the cause before starting a replacement. Inspect only relevant non-secret settings, service status and listen ports; never dump `.env`, owner state, browser cookies or `initial-login.txt` into chat or logs.

For a fresh local install, use `npm start` from the source root. This installs locked dependencies, builds and starts the server, creating a fresh SQLite database and private state when needed. Preserve existing `.env`, notes, credentials and recovery state; never point tests at real tasks. Use the environment's supported persistent terminal/process mechanism and report its lifetime. Starting a terminal process does not configure login autostart. If Docker is requested and available, follow `docs/docker.md` and reuse existing mounts/state. Keep one server per workspace.

`VAULT_PATH`/`STATE_PATH` for Node are relative to `app/`; private state stays outside the vault. Set both `PORT` and `PUBLIC_ORIGIN` for a custom port. Keep the generated initial login private: tell the user the local file path and let them sign in/change it. Do not read the password aloud or paste it. For an existing Markdown workspace use the dry run, cutover backup and explicit importer in docs/setup.md. Preserve the original source and private state.

## Verify

Check `/readyz` and open `/` at the configured origin in a browser. Verify sign-in with an existing authorized session or let the owner enter credentials privately. Run `npm run check` with temporary vaults for code changes.

Report the server URL, whether the server was reused or started, and the checks performed.
