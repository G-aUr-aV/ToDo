# Todo upgrade plan

Planning draft · 27 November 2026

Open Todo, see what needs attention today, and act on the first task without navigating away. The owner chose a Today-first home and has no need for Markdown files or Obsidian after migration. Todo stays a single-owner browser app served by one self-hosted server.

## The daily workspace

On a laptop, a narrow project sidebar sits beside one task list. A compact serif **Today** heading, the local date and an inline **Add a task** composer share the top of the workspace. The list starts immediately below. Replace the scenic banner and permanent Recently completed column. Keep the composer available while long lists scroll, even on days without upcoming or completed work. Keep titles within a comfortable reading width on wide displays.

| View | Behavior |
| --- | --- |
| Today | Show unfinished tasks planned for today or earlier, plus any due today or overdue. Show each task once. Give overdue deadlines a text label and first position. Use the existing due-date ordering within the remaining work. New captures here default to today and show that choice before saving. |
| All tasks | Expose every open task across projects, with a one-click Unscheduled filter. An empty Today offers **Choose from unscheduled**. Captures in All tasks start unscheduled. |
| Upcoming | Group future work by day. Add or move tasks to a visible date, and support moving several selected tasks in one operation. Moving a plan preserves its deadline. Display a deadline falling before the new plan at the point of rescheduling. |
| Projects | Reuse the same task rows, inline notes and composer in project context. Keep project switching and creation within reach when the project list is long. |
| Done and Trash | Keep all completion history searchable, including older entries, and preserve reopen, restore and Undo. On completing a task, leave keyboard focus on the next available row or on the composer. |

Use warm ivory with graphite text by day, matte charcoal with warm white text at night, and muted indigo for selection, focus and primary actions. Use one modest serif heading and a plain sans serif for work. Align the checkbox, title and deadline so dates can be scanned down the list. Clicking a title opens its note beneath the row. Keep project, repeat and reminder details available without filling every row with icons. On phones, use a single column with Today, Upcoming and More within thumb reach, an explicit row menu, and an editor that stays usable above the software keyboard. Preserve direct access to Search.

Check a task and the check appears immediately. Once the save succeeds, collapse the row over roughly 150 ms and offer Undo. If saving fails, keep the task in place with a retry action. Opening an editor should anchor the title in place. Reduced motion uses immediate state changes. Keep strong focus rings, text labels for urgent dates, and an Undo route that remains usable after the toast expires.

Things provides a precedent for separating the day you intend to work from the deadline. Todo already stores both. Todoist's date-grouped Upcoming view is a useful reference for rescheduling. The additions here are a distinct Today view, a discoverable unscheduled queue and moving several tasks together. Existing reminders, recurrence, checklists, shortcuts and history carry forward. [Things scheduling](https://culturedcode.com/things/support/articles/2803579/) · [Todoist Upcoming](https://www.todoist.com/help/todoist/get-started/plan-your-week-with-the-upcoming-view-OKOg1mR8)

## SQLite and the cutover

Use SQLite on a local persistent volume beside the Node server. The browser and agents already send writes through that server. Task/project relationships, due-date queries and atomic changes fit SQLite, and its embedded deployment avoids operating a MongoDB service. Start with the SQLite driver included in the supported Node 24 runtime and verify it on the pinned local and Docker builds. [SQLite deployment guidance](https://sqlite.org/whentouse.html)

1. **Keep one write path.** Put storage behind the operations shared by Fastify and MCP. Model tasks, projects, revision history and workspace preferences. Preserve IDs, project membership, editable note content, checklists, tags, plan dates, deadlines, completion instants and recurrence links. Store each edit, its history and dependent changes in a transaction. Check expected revisions on write and publish browser updates after commit. Keep owner authentication, sessions and MCP tokens working. Preserve the workspace identity used by browser drafts.
2. **Build a read-only importer.** Read source notes and private state from a snapshot. The current vault startup and snapshot paths can run rollover, recurrence and day-list generation, so use parsing functions directly. Import projects before resolving task links, account for earlier versions and fallbacks for missing timestamps, and report duplicate IDs, ambiguous links, unsupported notes and attachments. Retain existing duplicate project names by ID while enforcing current rules on new edits. Generate an inventory of imported, archived and unresolved items. Keep source-only files in the original backup.
3. **Rehearse before switching.** Use invented empty, populated and imperfect vaults. Compare IDs, values, history, counts by state, and representative browser/API/MCP results. Retry after an interrupted import without duplicating data. Run integrity and foreign-key checks and restore a database backup into a fresh instance. Verify that completing a recurring task twice on retry produces one successor, and a stale edit retains its draft.
4. **Switch with a recovery point.** Pause writers, back up the entire vault and private state, import into a fresh database, compare results, and smoke-test the new instance before reopening writes. The current ZIP export contains indexed notes only. If validation fails, resume the old instance from the frozen snapshot. After new writes begin, preserve and reconcile those changes before reverting storage. Back up SQLite using a consistent database backup and include the private authentication state in the restore procedure.
5. **Retire file workflows.** Remove Obsidian actions, day-file generation, filesystem watching and vault-repair settings from normal operation. Replace them with database backup and restore. Keep the original vault unmodified as an archive and the importer available for existing installations. Update setup, Docker mounts, project instructions and the personal-task skill so browser and agent workflows reach the same database. Direct the skill's day lookups through a supported server query.

## Delivery and acceptance

| Stage | Deliverable and exit check |
| --- | --- |
| 1 · Design | Astra owns design and orchestration. Review laptop and phone mockups for Today, Upcoming, Projects, Done, Trash, Search and Settings, in both themes. Walk through capture, edit, finish, undo and reschedule on a populated example before building the full interface. |
| 2 · Two independent builds | GPT‑6.2 Sol at medium effort handles exploration and coding. Prove the new Today view against the existing API. Independently prove the importer and SQLite operations on temporary data. Keep the interface releasable against the existing server so a design rollback never requires restoring the database. |
| 3 · Integration | Carry the approved design through the remaining views. Verify bulk rescheduling across UI, API and agent reads. Complete the migration and restore rehearsals, including local and Docker startup. Update instructions at the storage switch. |
| 4 · Release checks | In a real browser backed by a temporary server, exercise empty Today, only unscheduled work, 100 open tasks, long project names, overdue deadlines with future plans, and older Done history. Test keyboard-only use, reduced motion, large text and a narrow phone viewport with its keyboard open on a device. Compare load time, task-save latency, shipped assets and idle memory against the current app using the same fixture. Release the UI and storage changes separately. |

Implementation anchors include `app/core/task-views.ts` for current date semantics, `app/src/App.tsx` for the planner and shortcuts, `app/core/vault.ts` for revisions and lifecycle, and `app/server/app.ts` and `app/server/mcp.ts` for the two client contracts.
