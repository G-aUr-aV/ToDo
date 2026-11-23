---
name: todo-tasks
description: Manage the owner's personal tasks in Todo from any project. Use to review pending work, add, find, plan, update or complete tasks, record progress or what was done on a task, or close tasks after finishing work. Excludes app development, server setup, and explicitly named alternative task services.
---

# Todo Tasks

Todo is the owner's personal task list. Each task is a Markdown note in the live Todo Vault, and one Todo server owns every write. Distinguish personal tasks from steps in the current coding assignment. A request to list or suggest priorities does not authorize changing the plan.

## Connect

- **Use the `todo` MCP tools** when they are available: `find_tasks`, `get_task`, `add_task`, `update_task`, `complete_task`, `reopen_task`, `list_projects`, `add_project`. They go through the server, so revisions, recovery versions and day lists stay correct.
- **Without them**, write through a signed-in Todo browser tab using [the API workflow](references/api.md). If neither is available, read the vault files only and tell the owner to connect an agent in Todo under **Settings → Agent access**.
- Never hand-edit task notes, generated day lists, locks or private state, never start a second server, and never read or print tokens, passwords or cookies.

To read files directly, use the installation the owner named or recorded in user instructions; otherwise resolve this skill's real path and walk up from `<checkout>/.agents/skills/todo-tasks` to the checkout (it contains `app/package.json`). The vault is `VAULT_PATH` (relative to `app/`, default `<checkout>/Todo Vault`) or, for Docker, the host path in `TODO_VAULT_PATH`. Read `Home.md` first.

## Find the task

- When you don't already have the task's id, search with `find_tasks` across all projects, using the distinctive words from the owner's request. Search `status: "all"` before adding, to avoid duplicates.
- If more than one task plausibly fits what the owner asked (not merely shares a word), show the candidates and ask before writing.
- For one day's work, read `Days/YYYY-MM-DD.md`; for everything open, use `find_tasks` with an empty query.

## Choose the project for a new task

- Inside a git repository, use the project titled like the repository folder (`basename "$(git rev-parse --show-toplevel)"`, case-insensitive). If it doesn't exist, create it with `add_project` and the description `Repo: <name>`.
- Otherwise, use the project whose description (`list_projects`) fits the work, or none. Don't create other projects unless the owner asks; they are the owner's categories.

## Write notes

Notes are the task's working record, read later by the owner. Write plain words, only what the owner said or you verified, and never secrets or credentials.

- **On add:** give notes only for real context, such as the source link (Slack, Jira, PR) or what done means when the title doesn't say. Omit them otherwise.
- **While working:** record each meaningful finding with `update_task` `progress`, one line each. Todo adds the time and the `## Progress` heading.
- **Links:** add each URL (PR, commit, trace, Slack) with `update_task` `link`, e.g. `PR 57: https://…`; Todo keeps them under one `## Links` heading. Issue keys can stay inline.
- **On close:** call `complete_task` with `outcome`: 1–4 lines covering what was done or decided, the root cause for a bug, and how it was verified, without repeating the progress lines.
- To replace notes entirely, read the task with `get_task` first and pass its `revision`. Keep content you weren't asked to change.

## Plan and complete

- "Work on it tomorrow" sets `scheduled`; "due by Friday" sets `due`. Convert to an explicit `YYYY-MM-DD` date in the workspace timezone and say which date you used. Don't invent deadlines, reminders or repeats.
- Complete a task only when the work is verified done or the owner says it is. A plan or draft is not done.
- A follow-up is a new task whose notes start `Follow-up to: <original title>`.
- If a write fails because the task changed, read it again and retry once. If the intended result is then unclear, ask.

## Report

Name each task you touched, what changed, and the outcome text you wrote. Keep saved changes, proposals and blocked work distinct. If the server is unreachable, do the useful read-only part and say what could not be written.
