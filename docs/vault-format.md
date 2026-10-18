# Vault format

Tasks and projects are ordinary Obsidian Markdown notes. Notes are authoritative; the server rebuilds its in-memory index from them. The [architecture guide](architecture.md) explains writing, revision checks and recovery.

## Vault layout

```text
Todo/
  docs/                    project documentation, outside the vault
  Todo Vault/
    .obsidian/             per-vault Obsidian configuration
    Home.md
    Tasks.base             optional native task table views
    Tasks/                 one Markdown file per task
    Days/                  generated day lists with links to task notes
    Projects/              project context notes
    Templates/Task.md      outside the app task scan
    Attachments/
  .todo-state/             local recovery data, outside the vault
```

## Why one note per task

Each task can have readable properties, arbitrary notes, backlinks and a checklist. Updating one task touches one small file. A single large checkbox file would be convenient for generic checkbox queries but makes stable identity, rich notes, concurrent edits and per-task metadata harder.

Tradeoff: more files, and top-level task completion is a `status` property rather than a Markdown checkbox. Body checkboxes are subtasks. Compatibility with a community Tasks plugin is not part of this format's contract. Obsidian Properties and optional core Bases views provide direct inspection instead.

## Data contract

Example below is documentation only, not a task added to the vault:

```yaml
---
schema_version: 1
type: task
id: 7e6c0a21-6d88-4de1-a25a-9c13e2fd8746
title: Review the landing page
status: todo
scheduled: 2026-10-14
due: 2026-10-15
project: "[[Projects/Work]]"
focus: true
trashed: false
tags: [design]
created_at: 2026-10-14T12:00:00Z
updated_at: 2026-10-14T12:00:00Z
completed_at:
---

## Notes

Check the mobile flow and simplify the first screen.

## Checklist

- [ ] Check the empty states
- [ ] Review keyboard navigation
```

| Field | Contract |
| --- | --- |
| `id` | Stable UUID; unique across the vault; absent in templates, assigned on explicit import |
| `title` | Canonical display name; filenames are not the task identity |
| `status` | `inbox`, `todo`, `doing`, `done` |
| `scheduled`, `due` | Nullable calendar dates `YYYY-MM-DD`, interpreted in the app's configured timezone |
| `project` | Optional quoted vault-relative wiki link to one project note |
| `focus`, `trashed` | Booleans, default false; focus only changes ordering within Today |
| timestamps | UTC instants. `completed_at` is set when completed and cleared when reopened |
| body | User-owned Markdown; subtask checkboxes do not implicitly complete the parent |

Generate a readable filename such as `review-the-landing-page--7e6c0a21-6d88-4de1-a25a-9c13e2fd8746.md`. Retain it when the title changes in v1, so links do not break. If the owner renames it in Obsidian, discover the new path by ID. Duplicate IDs are a visible validation error, never an excuse to pick one file arbitrarily.

Scan Markdown under `Tasks/` with `type: task`. Templates, hidden folders, attachments and other notes are excluded. External note creation without an ID appears as importable; scanning does not silently mutate user files. Preserve unrecognized properties, comments and the untouched body when editing known fields. If safe round-trip editing cannot be guaranteed for a note, make it read-only in the app with an explanation.

Project notes under `Projects/` use `schema_version: 1`, `type: project`, a stable UUID `id`, `title` and `archived: false`, plus UTC creation/update timestamps and a user-owned Markdown body. Archive only changes project visibility; task links remain valid and dated tasks stay in Today/Upcoming. Restore clears `archived`. Resolve project links to current paths without guessing between duplicate identities.

The engine uses a YAML document parser that retains comments and source ranges, with Markdown parsing for body edits. Document size and parsing aliases are limited. Unsupported schema versions remain read-only rather than being quietly rewritten.

## Planning metadata

`reminder_at` is an optional timestamp with an explicit timezone. `repeat` is an optional mapping with `frequency` (`daily`, `weekly`, `monthly`) and integer `interval` (1–365).

Automatic rollover retains `original_scheduled`, `rollover_count` and `last_rolled_at` while moving unfinished plan dates to today. It leaves deadlines fixed. Recurring notes retain history through `recurrence_source_id` and `next_occurrence_id`. Let the app maintain recurrence and Undo bookkeeping; preserve unknown properties when editing notes externally.

The initial workspace timezone is `Asia/Kolkata`, configurable in Settings. Calendar dates do not shift as UTC timestamps. Today includes open, non-trashed tasks planned for today or earlier, or due today or earlier. A future plan date does not hide an overdue deadline.

Obsidian can edit the same files. A stale browser edit pauses autosave and retains its draft for Copy or explicit discard/reload. Obsidian does not share Todo's writer lock, so simultaneous external saves still have a narrow race. Back up both the full vault and private state; ZIP export contains indexed task/project notes only.

## Day-by-day lists for people and agents

Read `Days/README.md` for available dates, then `Days/YYYY-MM-DD.md` for a single day's tasks. Each entry links to the actual note in `Tasks/`. Open tasks have normal links; completed tasks have struck-through links. No task bodies are copied into these summaries.

Open tasks appear on their `scheduled` date, falling back to `due` when no plan is set. Tasks with neither date appear in `Days/Unscheduled.md`. Completed tasks appear on the local calendar day of `completed_at` in the workspace timezone, regardless of their original plan. A completed note without a recorded timestamp also appears in Unscheduled, without inventing a completion day. Trashed tasks are excluded.

Rescheduling or automatic rollover removes the open task from the earlier day's list and puts it on the new day. Completed tasks stay on their actual completion day; reopening, Undo and restore regenerate the lists from the current notes. A recurring task's completed occurrence and future occurrence have separate links on their respective days. Empty day pages are retained with no task entries.

These are generated, read-only views, refreshed by the vault server after task edits, external note scans, rollover, timezone changes and restart. The server's existing watcher and 15-second reconciliation also handle midnight and edits made in Obsidian. While the server is stopped, lists reflect its last refresh. Edit the linked note or use Todo; editing a list does not edit the task. Unchanged lists are not rewritten. Unrecognized files and symlinks at generated paths are left alone and reported in vault status. Invalid task notes produce a warning that lists may be incomplete.
