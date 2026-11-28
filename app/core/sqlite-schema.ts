import type { DatabaseSync } from "node:sqlite";
import type { Project, Task } from "./model";
import { hash, parseNote, projectFrom, taskFrom } from "./notes";

export type RecurrenceState = {
  anchor: string | null;
  planned: string | null;
  created: boolean;
  revision: string | null;
  undone: boolean;
};

export type StoredTask = {
  kind: "task";
  entity: Task;
  recurrence: RecurrenceState;
};
export type StoredProject = { kind: "project"; entity: Project };
export type StoredNote = StoredTask | StoredProject;

export const emptyRecurrence: RecurrenceState = {
  anchor: null,
  planned: null,
  created: false,
  revision: null,
  undone: false,
};

export function initializeSchema(db: DatabaseSync) {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version === 1) return;
  if (version !== 0)
    throw new Error("This database uses an unsupported Todo schema.");
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1",
      )
      .get()
  ) {
    throw new Error("This file contains a database without a Todo schema.");
  }
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'project')),
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT CHECK (status IN ('inbox', 'todo', 'doing', 'done')),
      scheduled TEXT,
      due TEXT,
      completed_at TEXT,
      trashed INTEGER NOT NULL CHECK (trashed IN (0, 1)),
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      project_id TEXT REFERENCES notes(id),
      project_link TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision TEXT NOT NULL,
      metadata TEXT NOT NULL CHECK (json_valid(metadata))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS notes_title ON notes(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id, trashed, status);
    CREATE INDEX IF NOT EXISTS notes_planned ON notes(scheduled) WHERE kind = 'task' AND trashed = 0 AND status <> 'done';
    CREATE INDEX IF NOT EXISTS notes_due ON notes(due) WHERE kind = 'task' AND trashed = 0 AND status <> 'done';
    CREATE INDEX IF NOT EXISTS notes_completed ON notes(completed_at) WHERE kind = 'task' AND status = 'done';
    CREATE INDEX IF NOT EXISTS notes_status ON notes(status, trashed) WHERE kind = 'task';
    CREATE TABLE IF NOT EXISTS versions (
      note_id TEXT NOT NULL,
      id TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      state TEXT,
      legacy_raw TEXT,
      PRIMARY KEY (note_id, id),
      CHECK ((state IS NULL) <> (legacy_raw IS NULL)),
      CHECK (state IS NULL OR json_valid(state))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 1;
    COMMIT;
  `);
}

type TaskMetadata = Pick<
  Task,
  | "tags"
  | "previousStatus"
  | "reminder"
  | "repeat"
  | "originalScheduled"
  | "rolloverCount"
  | "lastRolledAt"
  | "recurrenceSourceId"
  | "nextOccurrenceId"
> & { recurrence: RecurrenceState };

type NoteRow = {
  id: string;
  kind: StoredNote["kind"];
  path: string;
  title: string;
  content: string;
  status: Task["status"];
  scheduled: string | null;
  due: string | null;
  completed_at: string | null;
  trashed: number;
  archived: number;
  project_id: string | null;
  project_link: string | null;
  created_at: string;
  updated_at: string;
  revision: string;
  metadata: string;
};

export function readNote(row: unknown): StoredNote {
  const r = row as NoteRow;
  const common = {
    id: r.id,
    path: r.path,
    title: r.title,
    notes: r.content,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.kind === "project") {
    return {
      kind: "project",
      entity: { ...common, archived: r.archived === 1 },
    };
  }
  const { recurrence, ...meta } = JSON.parse(r.metadata) as TaskMetadata;
  return {
    kind: "task",
    recurrence,
    entity: {
      ...common,
      ...meta,
      status: r.status,
      scheduled: r.scheduled,
      due: r.due,
      completedAt: r.completed_at,
      projectId: r.project_id,
      project: r.project_link,
      trashed: r.trashed === 1,
    },
  };
}

export function writeNote(db: DatabaseSync, note: StoredNote) {
  const entity = note.entity;
  const task = note.kind === "task" ? note.entity : null;
  const metadata: TaskMetadata | object =
    note.kind === "task"
      ? {
          tags: note.entity.tags,
          previousStatus: note.entity.previousStatus,
          reminder: note.entity.reminder,
          repeat: note.entity.repeat,
          originalScheduled: note.entity.originalScheduled,
          rolloverCount: note.entity.rolloverCount,
          lastRolledAt: note.entity.lastRolledAt,
          recurrenceSourceId: note.entity.recurrenceSourceId,
          nextOccurrenceId: note.entity.nextOccurrenceId,
          recurrence: note.recurrence,
        }
      : {};
  db.prepare(
    `
    INSERT INTO notes (
      id, kind, path, title, content, status, scheduled, due, completed_at, trashed,
      archived, project_id, project_link, created_at, updated_at, revision, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      kind = excluded.kind, path = excluded.path, title = excluded.title,
      content = excluded.content, status = excluded.status, scheduled = excluded.scheduled,
      due = excluded.due, completed_at = excluded.completed_at, trashed = excluded.trashed,
      archived = excluded.archived, project_id = excluded.project_id,
      project_link = excluded.project_link, created_at = excluded.created_at,
      updated_at = excluded.updated_at, revision = excluded.revision, metadata = excluded.metadata
  `,
  ).run(
    entity.id,
    note.kind,
    entity.path,
    entity.title,
    entity.notes,
    task?.status ?? null,
    task?.scheduled ?? null,
    task?.due ?? null,
    task?.completedAt ?? null,
    Number(task?.trashed ?? false),
    Number(note.kind === "project" && note.entity.archived),
    task?.projectId ?? null,
    task?.project ?? null,
    entity.createdAt,
    entity.updatedAt,
    entity.revision,
    JSON.stringify(metadata),
  );
}

export function legacyNote(
  kind: StoredNote["kind"],
  path: string,
  raw: string,
  fallbackTime: string,
  projectId: string | null = null,
): StoredNote {
  const parsed = parseNote(raw);
  const revision = hash(raw);
  if (kind === "project") {
    return { kind, entity: projectFrom(parsed, path, revision, fallbackTime) };
  }
  const stringOrNull = (value: unknown) =>
    typeof value === "string" ? value : null;
  return {
    kind,
    entity: { ...taskFrom(parsed, path, revision, fallbackTime), projectId },
    recurrence: {
      anchor: stringOrNull(parsed.data.repeat_anchor),
      planned: stringOrNull(parsed.data.repeat_occurrence_scheduled),
      created: parsed.data.next_occurrence_created === true,
      revision: stringOrNull(parsed.data.next_occurrence_revision),
      undone: parsed.data.next_occurrence_undone === true,
    },
  };
}
