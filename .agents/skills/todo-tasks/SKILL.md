---
name: todo-tasks
description: Manage the owner's personal tasks in Todo from any project. Use to review pending work, add, find, plan, update or complete tasks, record progress or what was done on a task, or close tasks after finishing work. Excludes app development, server setup, and explicitly named alternative task services.
---

# Todo Tasks

Todo is the owner's personal task list. The live Todo server stores tasks in SQLite and owns every write. Distinguish personal tasks from steps in the current coding assignment. A request to list or suggest priorities does not authorize changing the plan.

## Connect

- **Use the `todo` MCP tools** when they are available: `find_tasks`, `get_task`, `add_task`, `update_task`, `complete_task`, `reopen_task`, `list_projects`, `add_project`. They go through the server, so revisions, recovery versions and date queries stay consistent.
- **Without them**, write through a signed-in Todo browser tab using [the API workflow](references/api.md). If neither is available, report the missing connection and direct the owner to **Settings → Agent access**.
- Never write the database, locks or private state directly, never start a second server, and never read or print tokens, passwords or cookies.

## Find the task

- When you don't already have the task's id, search with `find_tasks` across all projects, using the distinctive words from the owner's request. Search `status: "all"` before adding, to avoid duplicates.
- If more than one task plausibly fits what the owner asked (not merely shares a word), show the candidates and ask before writing.
- For one calendar day, use `find_tasks` with `day: "YYYY-MM-DD"` and the requested status. Open tasks use plan date, falling back to deadline. Done tasks use their completion date in the workspace timezone. The Today screen also surfaces overdue work. Read results through the running server.

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
