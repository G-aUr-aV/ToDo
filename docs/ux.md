# UX guide

Todo helps one person capture work, finish it and keep a readable record of what was done in Obsidian files. The interface is calm and keyboard-first: one task list, an always-visible capture line, notes one click away and controls that appear only when needed. The [revamp design](superpowers/specs/2026-11-21-todo-revamp-design.md) is the reference. Full Todo and Mini Today run in a browser or separate Chrome app windows connected to one vault server.

## Views

| View | Purpose |
| --- | --- |
| Tasks | Every open task without a future plan date, grouped by project, then **Later** for planned work |
| Done | Completed tasks by day, each with the first line of its outcome |
| Projects | The Tasks list filtered to one project, with its description; one project per repository plus a few categories, all stored as vault notes |
| Search (⌘K) | Find tasks and projects by words in titles, notes and project names |
| Trash and Settings | Restore trashed tasks; agents, issue links, planning, appearance, vault, data and account |

Plan dates and deadlines are independent. A future plan date does not hide a deadline that is due. Automatic rollover moves unfinished plan dates to today while retaining original dates and roll counts; Settings can disable it.

## Capture and editing

Type in the capture line and press Enter; focus stays for the next task, and pasted multi-line text becomes title plus notes. Opening a task expands a card in place with an editable title, project and date chips, and notes that edit with one click. Deadline, labels, reminder and repeat are added from **+** and shown only when set. Links and issue keys in titles become chips. The copy button or **C** copies a task's name.

Autosave reports Saving and then Saved only after the server acknowledges the write. Unsaved drafts stay on the device. A failed save retains the draft. If Obsidian changes the same note while it is dirty, saving pauses and offers **Copy draft** or **Discard draft & reload**. Discard loads the latest note without writing. Revision checks protect completion, Undo and recovery as well as editing.

Trash is reversible. Completing a repeating task keeps the completed note and creates one linked future occurrence. Daily, weekly and monthly intervals are supported. Reminders offer snooze/dismiss and catch up after reconnect; either Todo or Mini must remain open. Browser suspension, device sleep and server downtime can delay alerts.

## Mini and Obsidian

[Mini Today](mini-today.md) keeps a compact copy of the Tasks list (without Later) with completion/Undo and links to full task details. Adding, rescheduling, notes and settings stay in the full workspace. Mini shares the vault, login and same-device appearance settings.

Open in Obsidian uses the configured device-specific vault name. A remote browser needs the corresponding vault on that device for the URI to work. Tasks remain readable directly through the [vault format](vault-format.md), with private authentication and recovery state stored separately.

## Responsive and accessible behavior

Narrow layouts use Tasks / Done / Search / More navigation and a single column. Keep task names readable, focus visible, controls named and status understandable without color alone. Keyboard shortcuts must respect editable fields and the user's shortcut setting. Completion and Undo must remain accessible by keyboard, and motion must respect the user's preference.

## Errors and recovery

| State | Expected behavior |
| --- | --- |
| Empty list | Explain the empty state and offer an appropriate next action |
| Save failure | Keep the draft and show the error without claiming Saved |
| Same note changed externally | Pause saving; retain the draft for Copy or discard/reload |
| Invalid or duplicate note | Preserve the file and show a diagnostic; do not guess which note to overwrite |
| Server unavailable | Preserve editor drafts; Mini labels its last update and disables writes |
| Sign-out | Clear the authenticated Mini summary and require login |

Use the [development guide](development.md) for repeatable checks and browser acceptance with temporary data.
