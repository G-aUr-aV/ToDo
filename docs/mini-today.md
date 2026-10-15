# Mini Today and Chrome app windows

Mini is a small companion page showing what is left today, using the same self-hosted vault server and login as the full website.

## Open and install

- Full workspace: **http://localhost:4310**.
- Mini: **http://localhost:4310/mini**, or choose **Mini Today** on Today or in the phone's More menu.

Open Todo in Chrome and choose **menu → Cast, save, and share → Install page as app**. Open `/mini` and repeat to install **Todo Mini** separately, then resize its window. Todo and Mini have distinct manifest identities and use the same authenticated server session. A Google account integration is unnecessary. [Chrome's instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en).

For script-created shortcuts instead, run `npm run launchers:install` from the Todo root. The [desktop launcher guide](desktop-launchers.md) covers Linux, macOS, Windows, remote URLs and Chrome profiles. These are Chrome app windows; there is no pin-on-top control, background tray or separate desktop engine. Chrome-managed installation and script-created shortcuts are alternative ways to open the same website; avoid duplicate icons.

The server must remain available. `localhost` means the device running the browser; a Mac connecting to a server on Ubuntu needs a reachable HTTPS server address and matching `PUBLIC_ORIGIN`. The supplied Compose deployment remains bound to loopback until deliberately configured otherwise. [Docker operations](docker.md).

## Design decisions

[Things Slim Mode](https://culturedcode.com/things/support/articles/3238254/) and [multiple windows](https://culturedcode.com/things/support/articles/2803580/) informed the navigation-free list and separate Today window. The existing Daylight typography, colors and real Tabler icons remain. The selected composition has a Today heading, remaining count, grouped task list, one escape to the full workspace and a quiet connection footer.

Mini supports quick reference and completion. Adding tasks, rescheduling, notes, projects and settings stay in the full workspace. Its small-screen design reference is 360 × 560; the list also scrolls correctly at 320 × 280 while keeping header and footer visible.

## Behavior

- Today matches the full website: active tasks planned for today or earlier, or due today or earlier. Completed and trashed tasks are excluded.
- Passed deadlines come first, followed by focus and remaining work. A future deadline does not hide a task planned for today. Archived-project titles remain visible.
- Completion removes a task after an acknowledged save. Undo restores the prior observed version and rejects a stale restore. Clicking a title opens that task in the full editor.
- Server events and opaque same-origin BroadcastChannel invalidations refresh the view. It also refreshes every 30 seconds and on focus, visibility or connectivity changes. Requests in flight are coalesced.
- Theme and text size follow same-device preferences. Titles wrap to two lines with the full accessible link name; metadata truncates to fit. Only the list scrolls.
- Disconnection labels the last in-memory update and disables completion. A fresh unreachable page cannot load tasks. Sign-out clears the summary and Undo. Invalid notes expose an attention link instead of a false all-clear.
- There is no offline write queue, service worker or persistent task cache. Browser drafts in the full editor are separate from Mini's transient summary.

## Implementation

Mini has its own HTML/React entry and does not import the full editor, Markdown renderer or ZIP code. It shares the React/client/component code, local Inter font and licensed icons with full Todo.

`GET /api/today` is authenticated and returns titles, identity/revision, dates, focus and project labels. It omits note bodies, paths, tags and preferences. API responses are no-store; HTML and manifests revalidate. The server still owns and indexes the canonical vault.

Use the [development guide](development.md) for automated checks and browser acceptance with temporary data.
