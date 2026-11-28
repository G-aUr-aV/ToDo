# Todo application instructions

Todo is a single-owner browser planner served by Node and backed by SQLite. Follow the [Today upgrade plan](../docs/superpowers/plans/2026-11-27-todo-upgrade.md) and [desktop and phone mockups](../docs/superpowers/specs/2026-11-27-today-mockups.html). Agents use MCP or the signed-in API. Keep one writer and preserve revision checks, draft recovery and Undo.

Today is the primary view. Keep capture and inline notes within reach, reserve width for titles, and let crowded lists and project navigation scroll independently. Treat dark mode, reduced motion, large text, keyboard use and narrow phone layouts as primary surfaces. Prefer contextual actions and verify changes with a populated temporary workspace in a browser.

Store tasks, projects, history and planning preferences in the local database. Preserve independent plan dates and deadlines, timezone-aware rollover, bounded repeats, reminders with snooze/dismiss while the page is open, and recoverable history. The legacy vault is migration input. Test migration, fresh setup and restore using invented data. Protect live data, credentials, services and backups.

Keep the client lightweight and use existing platform APIs. Build React UI in src/. Keep the Sites adapter, hosting configuration and packaging checks working for static preview. Full planner operation requires the local Node server.
