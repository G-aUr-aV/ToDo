---
name: todo-setup
description: Set up the Todo Daylight vault server and separate Todo or Mini Today Chrome desktop launchers on macOS, Windows or Linux. Detect the destination OS and CPU, reuse existing installations and verify setup. Use for installing, repairing or updating this Todo project's launchers; not for unrelated task apps.
---

# Set up Todo

Todo is a web app with one Node/Fastify vault server. Desktop launchers open the user's installed Chrome/Chromium with `--app=URL`. Keep this architecture; do not add Electron, Tauri, a bundled browser or a second writer to an existing vault.

For installing these skills across projects or setting up another agent's global Todo routing, read [the agent setup guide](../../../docs/agent-skills.md). This is separate from installing the Todo application itself.

## Locate the project and destination

Find the Todo source root containing `launchers/install.mjs`, `app/package.json` and `docs/setup.md`. This skill normally lives at `<root>/.agents/skills/todo-setup`; resolve symlinks before walking three directories up. If copied independently, locate the user's checkout or ask for its path; there is no assumed public clone URL. Read `docs/desktop-launchers.md` and the relevant parts of `docs/setup.md` before changes.

Determine whether the request is for this computer, a different desktop, a fresh local server or shortcuts to an existing server. Use project configuration, running services and the user's explicit address before asking. `localhost` refers to the browser computer. A remote server's URL must be reachable from that computer and match its `PUBLIC_ORIGIN`. For remote-hosting changes, read `docs/docker.md`; creating shortcuts alone does not authorize changing network exposure.

An SSH session, container, WSL shell or cloud agent may not be the destination desktop. Inspect `SSH_CONNECTION`, container/WSL indicators and available GUI session as relevant. Use native Windows Node/PowerShell for Windows shortcuts, not Linux under WSL. If the destination is unavailable, prepare its commands and report the unverified step. Do not claim installation on a computer you cannot operate.

## Detect platform and prerequisites

- POSIX: `uname -s` and `uname -m`; check `node --version` if installed. On macOS, `sysctl -n hw.optional.arm64` detects Apple silicon even when a shell or Node is translated through Rosetta.
- Windows PowerShell: `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` gives the OS CPU; `$env:PROCESSOR_ARCHITECTURE` and `$env:PROCESSOR_ARCHITEW6432` help with an emulated process. `node -p "process.platform + '/' + process.arch"` describes Node itself, which can differ from the OS architecture.
- Normalize `arm64`/`aarch64` to 64-bit ARM, and `x64`/`x86_64`/`amd64` to 64-bit Intel/AMD. Generic `arm`, `armv7l` and 32-bit `x86` are not ARM64/x64; do not download a 64-bit package blindly.

The launcher files themselves need no architecture-specific build. Install a native browser and, when installing/running the server or installer, **Node 24.18 or newer in the Node 24 line** with npm. Read `app/package.json` for the current engine constraint before selecting a version. An installed shortcut needs only Chrome and a reachable server at runtime; a remote desktop client does not need its own vault/server. On macOS/Linux, when no compatible Node is on `PATH` or the user wants Todo isolated from their global Node, use `scripts/local-node.sh install` and prefix Node commands with `scripts/local-node.sh` (for example `scripts/local-node.sh npm start`); it installs the checksum-verified version pinned in `.node-version` into gitignored `.tools/` without changing global Node or version-manager defaults. Use official Node/browser downloads or trusted OS packages; check current architecture availability instead of assuming Linux ARM lacks or has a Google build. Chromium is supported where native Chrome is unavailable. Do not copy `node_modules` across platforms.

Sources for prerequisite selection: [Node downloads](https://nodejs.org/en/download), [Chrome requirements](https://support.google.com/chrome/a/answer/7100626?hl=en). Check current official sources when downloading. Reuse installed compatible prerequisites. Honor the user's package-manager preference; do not change global execution policy, disable browser sandboxing or require a Google account.

## Reuse or start the server

If the chosen origin's `/readyz` succeeds and `/` and `/mini` load, reuse it. A healthy existing Docker deployment also counts; do not start Node against its vault. If the address is not reachable, identify the cause before starting a replacement. Inspect only relevant non-secret settings, service status and listen ports; never dump `.env`, owner state, browser cookies or `initial-login.txt` into chat or logs.

For a fresh local install, use `npm start` from the source root. This installs locked dependencies, builds and starts the server, creating absent dedicated vault/private state. Preserve existing `.env`, notes, credentials and recovery state; never point tests at real tasks. Use the environment's supported persistent terminal/process mechanism and report its lifetime. Starting a terminal process does not configure login autostart. If Docker is requested and available, follow `docs/docker.md` and reuse existing mounts/state. Keep one server per vault.

`VAULT_PATH`/`STATE_PATH` for Node are relative to `app/`; private state stays outside the vault. Set both `PORT` and `PUBLIC_ORIGIN` for a custom port. Keep the generated initial login private: tell the user the local file path and let them sign in/change it. Do not read the password aloud or paste it. Obsidian's Open folder as vault can use the dedicated Todo Vault; do not modify another vault to finish setup.

## Choose app installation for macOS/Windows grouping

If the destination is macOS or Windows and the user expects a separate Dock/taskbar app, prefer Chrome's **menu → Cast, save, and share → Install page as app** for the full origin and `/mini`. This uses the existing browser while giving Chrome responsibility for the native app shim or matching window/shortcut identity. Use browser tools on the destination desktop, or report the manual step if that desktop is unavailable.

The supplied macOS shell bundles execute Chrome and can group their windows under Chrome. The Windows `.lnk` helper lacks Chrome's matching `System.AppUserModel.ID`, so an icon alone does not guarantee grouping/pinning. Do not invent an unrelated app ID or claim native acceptance from static artifact checks. Use the script helpers when URL shortcuts meet the request; their installer/preview now reports this limitation. Preserve existing wrappers until browser-installed apps work, and do not delete browser data when removing duplicate launch icons. Read `docs/desktop-launchers.md` for the source-level platform review and limits.

## Install both shortcuts

Run on the destination computer from the Todo root:

```sh
node launchers/install.mjs --dry-run --url http://localhost:4310
node launchers/install.mjs --url http://localhost:4310
```

Replace the sample with the confirmed server origin. Without `--url`, the helper uses `PUBLIC_ORIGIN` from the environment/root `.env`, then localhost:4310. It writes only the user's launchers and their icon/support files; it does not start the server or install a browser. `npm run launchers:install -- --url <origin>` is equivalent.

The helper detects common Chrome locations, then Chromium. Use `--chrome <absolute executable>` for a nonstandard install (the binary inside the `.app` on macOS, `chrome.exe` on Windows). `--profile "Profile 1"` chooses a known Chrome profile folder. Linux explicitly selects `Default` when omitted, so its Wayland window ID is deterministic; if the user uses another existing profile, select it explicitly for both launchers. Other OS launchers reuse Chrome's current/default profile when omitted. Choose one profile for both windows so the origin's login is shared; do not create a separate `--user-data-dir`. Rerun with the same options to update shortcuts. Browser-managed Install page as app is also available, especially for sandboxed browser packages.

- Linux: creates applications-menu and Desktop `.desktop` entries. Match `StartupWMClass` to the actual native Wayland app ID or X11 URL window class; `--class` and standalone display mode alone do not prove Dock grouping. The installer uses `XDG_SESSION_TYPE` and the selected profile; for a browser forced to X11 in a Wayland session, override installation with `XDG_SESSION_TYPE=x11`. Reopen old Todo/Mini windows after updating because GNOME can cache their association; re-pin only Todo if necessary. Respect `$XDG_DATA_HOME` and the XDG desktop location. Some desktops need Allow Launching for Desktop icons. Do not manufacture a GUI in a headless session.
- macOS: creates `~/Applications/Todo.app` and `Todo Mini Today.app` with Desktop links. These bundles are shell wrappers, not native Todo runtimes. Use Terminal if Finder's environment cannot find Node. Chrome controls the resulting Dock window identity; pinning acceptance is a separate real-device check.
- Windows: creates current-user Start menu and Desktop `.lnk` files using Windows PowerShell COM, including redirected Desktop folders. `node launchers/install.mjs` works without changing PowerShell script execution policy. `launchers/windows/install.ps1` is optional when policy permits.

`--no-desktop` keeps menu/Applications entries only. `--output-dir <directory>` stages artifacts in a chosen folder for inspection. `--platform` supports cross-OS `--dry-run` previews only, never real cross-OS installation.

## Verify and report

Check readiness and HTTP success for `/`, `/mini`, `/manifest.webmanifest` and `/mini.webmanifest` at the chosen origin. Open each actual generated launcher when a desktop is available and confirm separate full/Mini app windows at the expected origin, plus their own Dock/taskbar grouping. A correct icon on disk or standalone display mode alone does not establish grouping. Verify shared sign-in only with an already authorized session; let the user enter credentials privately. Inspect artifact targets and icon paths; on Linux use `desktop-file-validate` if available. A file's existence alone does not prove app-window behavior.

Use `npm run test:launchers` when changing/repairing launcher code. If server code changes, follow the existing `npm run check` workflow with temporary invented vaults. On another OS, distinguish preview/static tests from native execution and actual browser acceptance. Do not claim CI passed just because a job was added.

Report destination OS/CPU, server origin and whether reused/started, installed shortcut locations, checks performed and any manual acceptance remaining. Reminders require an open page and reachable server; shortcut installation adds no background notification or login service. Use `docs/desktop-launchers.md` for update/removal details; removing shortcuts must leave vault/state/browser data alone.
