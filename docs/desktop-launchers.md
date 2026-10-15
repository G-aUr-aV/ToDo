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

Chrome's current/default profile is reused. To select another profile explicitly, use the **Profile Path** folder name shown at `chrome://version` (for example `Profile 1`). Todo and Mini share the login when they use the same origin and profile. The helper never edits browser preferences or creates a separate browser-data directory. Changing the server URL or selected profile requires rerunning installation; it does not move drafts, cookies or account data between origins/profiles.

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
