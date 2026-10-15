# Todo project instructions

Todo stays web-only. Platform-specific desktop launchers are lightweight shortcuts to the user's installed Chrome/Chromium in app mode. Keep one vault server; do not introduce a bundled browser, Electron/Tauri runtime or another storage engine.

For requests to install or set up Todo, Mini Today, browser app windows or desktop shortcuts, read [.agents/skills/todo-setup/SKILL.md](.agents/skills/todo-setup/SKILL.md). It is portable Agent Skills content; agents without skill discovery can follow that file directly. Detect the destination OS and CPU rather than assuming the agent's host is the user's desktop.

Implementation details in `app/` also follow [app/AGENTS.md](app/AGENTS.md). Test task writes against invented temporary vaults. Preserve real vaults, `.env`, private server state and running services while adding/updating launchers.
