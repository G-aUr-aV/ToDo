# Prototype Instructions

Todo is a single-owner, self-hosted website with optional Chrome app windows on Linux, Mac and Windows. The owner explicitly removed native desktop delivery for simplicity and low resource use. Do not add Electron, Tauri, native installers, IPC bridges or local-folder onboarding. Keep the Daylight design and the Mini Today route. Reuse one vault engine and do not add another storage system or automatic offline writes.

Lightweight operation is a primary requirement: minimize download size, idle memory, idle CPU and maintenance cost. Measure the complete runtime rather than only JavaScript entry sizes. Browser installation reuses the browser; it does not mean zero memory use.

The owner requested separate macOS, Windows and Linux desktop launchers that internally open the existing Chrome app. Small per-user shortcut/app-bundle helpers in `../launchers/` are allowed; they must reuse the installed browser and available server. Keep platform/CPU setup guidance in `../.agents/skills/todo-setup/SKILL.md` so another agent can set up a machine from the source folder.

Keep tasks as readable Obsidian Markdown so the owner and local assistants can inspect progress directly. Automatic rollover must update unfinished planned dates in the vault, keep deadlines fixed and retain readable history. Provide simple reminders with snooze/dismiss and a clear open-page delivery requirement. Prefer bounded daily/weekly/monthly repeat rules and useful completion history over extra services, accounts or collaboration features. Verify both fresh setup and representative populated vaults using temporary invented data.

The owner does not want a conflict-resolution/merge workflow for this personal app. Keep the rare stale-edit case simple: pause saving, retain the draft, and offer Copy or an explicit discard-and-reload action. Keep revision checks and recovery/Undo so Obsidian edits are not silently overwritten. Do not reintroduce side-by-side comparisons, merge editors or reviewed-merge dialogs.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
