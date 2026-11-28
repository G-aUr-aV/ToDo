# Todo project instructions

Todo runs in a regular browser tab with one SQLite-backed server. Product scope is the web workspace and its server APIs.

For requests to set up the Todo server, read [.agents/skills/todo-setup/SKILL.md](.agents/skills/todo-setup/SKILL.md). It is portable Agent Skills content; agents without skill discovery can follow that file directly. Detect the destination OS and CPU rather than assuming the agent's host is the user's desktop.

For the owner's personal task list, read [.agents/skills/todo-tasks/SKILL.md](.agents/skills/todo-tasks/SKILL.md) and use the installation's live server. To make either skill available across projects or configure personal-task routing on another machine, follow [docs/agent-skills.md](docs/agent-skills.md). Both skills can be read directly by agents without native skill discovery; global configuration is set up only when requested.

Implementation details in `app/` also follow [app/AGENTS.md](app/AGENTS.md). Test task writes against invented temporary workspaces. Preserve real vaults, `.env`, private server state and running services when working on the application.
