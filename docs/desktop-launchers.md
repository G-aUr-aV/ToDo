# Desktop launchers

Todo and **Todo Mini Today** can have separate icons on Linux, macOS and Windows. Each opens the existing Chrome/Chromium executable with `--app=<server URL>`. The installed launchers do not need Node, the source checkout, a bundled browser or a separate server process. Chrome continues to manage its own updates and browser data.

## Install

With Node 24 LTS available, run from this folder's parent (the Todo root):

```sh
npm run launchers:install
```

There are also platform entry points, run from the Todo root:

| System | Command | Installed locations |
| --- | --- | --- |
| Linux | `./launchers/linux/install.sh` | User applications menu and Desktop; support files under `$XDG_DATA_HOME/todo-launchers` (default `~/.local/share/todo-launchers`) |
| macOS | `sh "launchers/macos/Install Todo.command"` | `~/Applications/Todo.app`, `~/Applications/Todo Mini Today.app`, plus Desktop links |
| Windows PowerShell | `node launchers/install.mjs` (or `./launchers/windows/install.ps1` if script policy permits) | Current user's Start menu → Todo and Desktop, including a redirected OneDrive Desktop; icon under `%LOCALAPPDATA%\Todo Launchers` |

The macOS app bundles contain only a shell launcher, metadata and an icon. Chrome owns the resulting window and Dock behavior. On Linux a desktop may require **right-click → Allow Launching**; the applications-menu entries work independently. Use **Keep in Dock** or **Pin to taskbar** through the OS if desired. No administrator access or startup service is required by these helpers.

## macOS and Windows app identity

For a separate Dock or taskbar identity on macOS/Windows, use Chrome's **menu → Cast, save, and share → Install page as app** for Todo and again for `/mini`, then pin the apps Chrome creates. The script helpers remain URL shortcuts and now explain this distinction during installation and in dry-run output.

| Platform | Review finding | Supported setup for an independent app icon |
| --- | --- | --- |
| macOS | The shell `.app` executes Chrome directly; its bundle name/icon do not make Chrome's window belong to that bundle. This delivery path can group under Chrome. | Let Chrome create its app shim through browser installation. |
| Windows | The generated `.lnk` has an icon and arguments but no matching `System.AppUserModel.ID`. Chrome computes its app-window ID from the URL and profile; grouping or pinning can therefore mismatch. This is a source-level risk, not a reproduced Windows failure. | Let Chrome create and maintain the matching app shortcut and window identity. |

Neither platform was executed on this Ubuntu host. A plist check or COM shortcut readback does not establish live grouping. Do not invent an arbitrary AppUserModelID or modify the user's browser binary to force separation; the window and shortcut must agree. Existing wrappers can be removed after Chrome's installed apps work, without deleting website data or server state.

Sources: [Chrome web-app installation](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en), [Chromium macOS app shim](https://github.com/chromium/chromium/blob/main/chrome/app_shim/app_mode_loader_mac.mm), [Chromium Windows app IDs](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/shell_integration_win.cc), [Microsoft taskbar identity requirements](https://learn.microsoft.com/en-us/windows/win32/shell/appids).

By default, installation uses `PUBLIC_ORIGIN` from the environment or root `.env`, falling back to `http://localhost:4310`. For a different server, pass its origin explicitly:

```sh
npm run launchers:install -- --url https://todo.example.com
```

`localhost` means the computer running Chrome. A client connecting to another computer must use that server's reachable HTTPS origin, with the server configured for the same `PUBLIC_ORIGIN`. See [Docker and remote hosting](docker.md). Keep the server running; these shortcuts only open Chrome. They do not configure networking or expose the vault.

Optional arguments:

```sh
node launchers/install.mjs --dry-run
node launchers/install.mjs --no-desktop
node launchers/install.mjs --profile "Profile 1"
node launchers/install.mjs --chrome "/absolute/path/to/chrome"
```

On Windows, `--chrome` is the full path to `chrome.exe`; on macOS it is the executable **inside** the Chrome application bundle. Detection checks normal Chrome locations, then Chromium. It stops if no browser is found. For Flatpak or other browser wrappers, install the site through that browser's menu instead of passing a launcher command as an executable path.

Linux explicitly uses Chrome's `Default` profile unless `--profile` selects another existing profile. This keeps the window's Dock identity consistent with its launcher. macOS and Windows reuse Chrome's current/default profile unless selected explicitly. To select another profile, use the **Profile Path** folder name shown at `chrome://version` (for example `Profile 1`). Todo and Mini share the login when they use the same origin and profile. The helper never edits browser preferences or creates a separate browser-data directory. Changing the server URL or selected profile requires rerunning installation; it does not move drafts, cookies or account data between origins/profiles.

## Ubuntu Dock grouping

The Linux installer matches `StartupWMClass` to Chrome's URL-derived window identity. Under native Wayland, localhost Todo uses `chrome-localhost__-Default` and Mini uses `chrome-localhost__mini-Default`; X11 uses `localhost` and `localhost__mini`. A custom profile changes the Wayland identity. These names follow Chromium's implementation, so standalone-window display mode alone is not sufficient verification.

Installation uses `XDG_SESSION_TYPE` to select the identity. If Chrome was deliberately forced to X11 within a Wayland session, install with `XDG_SESSION_TYPE=x11 node launchers/install.mjs` instead. No browser restart, separate browser profile or display-server change is required.

After updating the launchers, close the old Todo/Mini windows and reopen them from their own icons; GNOME may retain a cached association for windows already open. If an old pinned shortcut still retains the Chrome association, remove only that Todo pin and pin the newly opened Todo window. Keep other Chrome windows and pins intact. For other desktops or browser-managed installations, verify the reported window/app identity rather than assuming `--class` controls it.

The 15 October 2026 Ubuntu ARM64 follow-up observed the full window's actual Wayland `set_app_id("chrome-localhost__-Default")` using a disposable browser profile. This exposed the initial mismatch with `StartupWMClass=todo-daylight`. Both corrected installed launchers were then executed using disposable browser data: the actual full/Mini app IDs matched their installed entries. All 12 launcher tests passed, including Wayland/X11 and custom-profile regressions; desktop entries and the updated setup skill validated. Final visual Dock acceptance remains separate because the browser automation connection was unavailable for this follow-up. See [Chromium's app-ID rules](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/shell_integration_linux.cc) and [GNOME's window matching](https://github.com/GNOME/gnome-shell/blob/main/src/shell-window-tracker.c).

For isolated inspection, `--output-dir <directory>` puts all launcher artifacts under that directory. `--platform linux|darwin|win32` is allowed only with `--dry-run`; use it with an explicit target `--chrome` path to preview another OS. Real installation must run on the destination OS.

## Processor architecture

The shortcut files are architecture independent. `arm64` and `aarch64` both identify 64-bit ARM; `x64`, `x86_64` and `amd64` identify 64-bit Intel/AMD. “ARM” alone may mean 32-bit, so check before downloading dependencies.

Choose a native Node and Chrome/Chromium build for the destination OS and CPU. Apple silicon should use the Apple silicon or universal browser build; Intel Macs use Intel/universal. Windows on ARM should use ARM64 builds. Linux browser availability varies by distribution; check its trusted package sources if Google's current download does not offer the detected architecture. Never copy `node_modules` between machines; install from the lockfile on the server. A machine that only runs the installed Chrome shortcut needs no Node runtime after installation.

Check current [Chrome requirements](https://support.google.com/chrome/a/answer/7100626?hl=en) and [Node downloads](https://nodejs.org/en/download) when installing prerequisites.

## Ask an agent

The portable [todo-setup skill](../.agents/skills/todo-setup/SKILL.md) handles platform/CPU detection, an existing versus new server, browser selection, launcher installation and verification. For example:

> Set up Todo and Mini Today on this computer. Use the todo-setup skill in this project.

For an agent without automatic skill discovery:

> Read `.agents/skills/todo-setup/SKILL.md` in this Todo folder and follow it to set up this machine.

Run the agent on the desktop computer receiving the shortcuts. An agent on a remote server or inside WSL cannot verify another computer's desktop. It can still prepare the destination command and server checks.

## Update or remove

Rerunning the installer updates the named Todo launcher files and retains unrelated files. Installed launchers keep working after moving/removing the checkout; rerun from a checkout if the browser executable or server address changes. For Chrome-managed installation, the existing **Install page as app** workflow remains available; avoid keeping duplicate icons if using both approaches.

To remove these helpers, delete only their generated files:

- Linux: `todo-daylight.desktop` and `todo-mini.desktop` in the applications directory and Desktop, plus the `todo-launchers` support folder.
- macOS: the two named app bundles in `~/Applications` and their Desktop links.
- Windows: the two named Desktop shortcuts, Start menu's `Todo` folder and `%LOCALAPPDATA%\Todo Launchers`.

Deleting launchers does not delete tasks, Chrome data, private server state or a running server.

## Verification

Run `npm run test:launchers`. Tests check distinct full/Mini routes, origin and profile handling, paths containing spaces/metacharacters, no-write previews, repeat installation, and preservation of unrelated files. Native checks validate Linux desktop entries, macOS plists/links or Windows COM shortcut targets on their respective OS. CI runs this suite on Ubuntu, macOS and Windows; adding the job does not mean it has run yet.

After installing on the destination desktop, open both shortcuts and check their windows, icons and pinning behavior. Automated shortcut checks do not replace that real-device acceptance.
