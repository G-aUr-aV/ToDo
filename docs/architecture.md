# Storage and server architecture

The browser and MCP clients connect to the same Fastify server. The server owns a SQLite database on a persistent local volume. Each task and project has a stable UUID. The database holds task fields, project relationships, note content, revisions, recovery history and workspace preferences. Owner credentials, sessions and hashed agent tokens live alongside the database in private state.

Task edits carry an expected revision. Concurrent edits pause autosave and preserve the browser draft. Task changes, recoverable history and dependent changes such as a recurring successor are committed together. Bulk rescheduling changes plan dates and preserves deadlines. After commit the server notifies open browsers. Browser drafts and appearance preferences use device storage.

Plan dates and deadlines are calendar dates in the workspace timezone. Completion and reminder timestamps are instants. Rollover retains the original plan and the number of moves. Monthly repeating tasks retain their intended day through shorter months. Completing a task keeps its outcome and history.

The previous release stored notes in a dedicated Obsidian vault. Its [format reference](vault-format.md) documents migration input. The importer reads source notes, settings and versions and preserves the original vault and private state in a cutover backup. Ongoing task operations use SQLite. See [setup and recovery](setup.md).

The optional Sites client can serve static assets. Full planner operation requires the Node server and its database.
