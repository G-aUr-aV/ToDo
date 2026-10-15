# UX guide

Todo helps one person capture work, choose when it matters and keep context in readable Obsidian files. The Daylight interface uses restrained navigation, legible task rows, one primary Add task action and progressive detail. Full Todo and Mini Today run in a browser or separate Chrome app windows connected to one vault server.

## Views

| View | Purpose |
| --- | --- |
| Inbox | Capture now and organize later |
| Today | Open tasks planned for today or earlier, plus due and overdue deadlines |
| Upcoming | Plan future work with distinct plan-date and deadline labels |
| Projects | Related tasks and a Markdown project note |
| Labels and search | Find work across titles, notes, projects and tags |
| Completed and Trash | Review history, reopen completed work and restore trashed tasks |

Plan dates and deadlines are independent. A future plan date does not hide a deadline due today. Focus helps order today's work. Automatic rollover moves unfinished plan dates to today while retaining original dates and roll counts; Settings can disable it.

## Capture and editing

Only a title is required to create a task. Plan date, deadline, project, labels and notes can follow. Tasks support Markdown notes and body checklists. Desktop details expand within the workspace; narrow layouts use a separate task view with Back.

Autosave reports Saving and then Saved only after the server acknowledges the write. Unsaved drafts stay on the device. A failed save retains the draft. If Obsidian changes the same note while it is dirty, saving pauses and offers **Copy draft** or **Discard draft & reload**. Discard loads the latest note without writing. Revision checks protect completion, Undo and recovery as well as editing.

Trash is reversible. Completing a repeating task keeps the completed note and creates one linked future occurrence. Daily, weekly and monthly intervals are supported. Reminders offer snooze/dismiss and catch up after reconnect; either Todo or Mini must remain open. Browser suspension, device sleep and server downtime can delay alerts.

## Mini and Obsidian

[Mini Today](mini-today.md) keeps a compact list of remaining work with completion/Undo and links to full task details. Adding, rescheduling, notes and settings stay in the full workspace. Mini shares the vault, login and same-device appearance settings.

Open in Obsidian uses the configured device-specific vault name. A remote browser needs the corresponding vault on that device for the URI to work. Tasks remain readable directly through the [vault format](vault-format.md), with private authentication and recovery state stored separately.

## Responsive and accessible behavior

Narrow layouts use Today / Inbox / Upcoming / More navigation and a single task column. Keep task names readable, focus visible, controls named and status understandable without color alone. Keyboard shortcuts must respect editable fields and the user's shortcut setting. Completion and Undo must remain accessible by keyboard, and motion must respect the user's preference.

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
