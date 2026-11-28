import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { checkItems, toggleCheck } from "./checklist";
import {
  AppError,
  dayInZone,
  defaultPreferences,
  preferenceSchema,
  projectCreateSchema,
  projectPatchSchema,
  taskCreateSchema,
  taskPatchSchema,
  uuid,
  type Diagnostic,
  type Preferences,
  type Project,
  type Snapshot,
  type Task,
  type TaskPatch,
  type Version,
} from "./model";
import { hash, MAX_NOTE_BYTES, parseNote } from "./notes";
import {
  addDays,
  daysBetween,
  nextOccurrence,
  shiftReminder,
} from "./recurrence";
import {
  emptyRecurrence,
  initializeSchema,
  legacyNote,
  readNote,
  writeNote,
  type StoredNote,
  type StoredProject,
  type StoredTask,
} from "./sqlite-schema";
import { active } from "./task-views";

export type BulkSchedule = {
  scheduled: string | null;
  tasks: Array<{ id: string; revision: string }>;
};

const slug = (title: string) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "task";
const projectNameKey = (title: string) =>
  title.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
const newRevision = () => hash(randomUUID());
const nextTaskId = (id: string) => {
  const hex = hash("todo-next-occurrence:" + id)
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

type VersionRow = {
  id: string;
  saved_at: string;
  state: string | null;
  legacy_raw: string | null;
};

export class SqliteWorkspace extends EventEmitter {
  private readonly db: DatabaseSync;
  private interval?: NodeJS.Timeout;
  private automationIssues: Diagnostic[] = [];

  constructor(
    private readonly database: string,
    private readonly clock = () => new Date(),
    private readonly checkLease = () => {},
  ) {
    super();
    this.db = new DatabaseSync(database);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      initializeSchema(this.db);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.prepare("SELECT 1 FROM settings LIMIT 1").get();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  start() {
    if (!this.setting("vaultKey")) {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO settings (key, value) VALUES ('vaultKey', ?)",
        )
        .run(randomUUID());
    }
    this.refresh();
    this.interval = setInterval(() => {
      try {
        this.refresh();
      } catch (error) {
        console.error(
          "Todo could not refresh planned tasks:",
          (error as Error).message,
        );
      }
    }, 15_000);
    this.interval.unref();
    return this;
  }

  close() {
    clearInterval(this.interval);
    this.db.close();
  }

  async ready() {
    this.checkLease();
    if (this.database !== ":memory:") {
      await Promise.all([
        access(this.database, constants.R_OK | constants.W_OK),
        access(
          path.dirname(this.database),
          constants.R_OK | constants.W_OK | constants.X_OK,
        ),
      ]);
    }
    this.db.prepare("SELECT 1 FROM settings LIMIT 1").get();
  }

  async backupTo(destination: string) {
    this.checkLease();
    await backup(this.db, destination);
  }

  private setting(key: string): string | undefined {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)
      ?.value as string | undefined;
  }

  private preferences() {
    const value = this.setting("preferences");
    return value
      ? preferenceSchema.strip().parse(JSON.parse(value))
      : { ...defaultPreferences };
  }

  private transact<T>(fn: () => T): T {
    this.checkLease();
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.emit("changed");
    return result;
  }

  private find(id: string) {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
    return row && readNote(row);
  }

  private get(id: string, kind: "task"): StoredTask;
  private get(id: string, kind: "project"): StoredProject;
  private get(id: string, kind: StoredNote["kind"]) {
    const note = this.find(id);
    if (!note || note.kind !== kind) {
      throw new AppError(
        404,
        "NOTE_MISSING",
        "This item is no longer in the workspace.",
      );
    }
    return note;
  }

  private requireRevision(current: StoredNote, revision: string) {
    if (current.entity.revision !== revision) {
      throw new AppError(
        409,
        "CONFLICT",
        "This item changed while you were editing. Your draft is preserved.",
        current.entity,
      );
    }
  }

  private projects() {
    return this.db
      .prepare(
        "SELECT * FROM notes WHERE kind = 'project' ORDER BY created_at, title",
      )
      .all()
      .map((row) => (readNote(row) as StoredProject).entity);
  }

  private assignProject(id: string | null) {
    if (!id) return { projectId: null, project: null };
    const project = this.get(id, "project").entity;
    if (project.archived) {
      throw new AppError(
        400,
        "PROJECT_ARCHIVED",
        "Restore this project before assigning tasks to it.",
      );
    }
    return {
      projectId: id,
      project: "[[" + project.path.replace(/\.md$/, "") + "]]",
    };
  }

  private resolveLegacyProject(entity: Task) {
    if (!entity.project) return null;
    const target = entity.project
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0]
      .replace(/\.md$/, "");
    const matching = this.projects().filter(
      (project) =>
        project.path.replace(/\.md$/, "") === target ||
        project.title === target ||
        "Projects/" + project.title === target,
    );
    return matching.length === 1 ? matching[0].id : null;
  }

  private uniqueProjectName(title: string, except?: string) {
    const key = projectNameKey(title);
    if (
      this.projects().some(
        (project) =>
          project.id !== except && projectNameKey(project.title) === key,
      )
    ) {
      throw new AppError(
        409,
        "PROJECT_EXISTS",
        "A project with this name already exists.",
      );
    }
  }

  private put(note: StoredNote) {
    if (Buffer.byteLength(note.entity.notes) > MAX_NOTE_BYTES) {
      throw new AppError(
        400,
        "NOTE_TOO_LARGE",
        "This item is too large to save.",
      );
    }
    writeNote(this.db, note);
  }

  private save(current: StoredNote, next: StoredNote) {
    const stamp = this.clock().toISOString();
    const undoVersion = stamp.replace(/[:.]/g, "-") + "--" + randomUUID();
    this.db
      .prepare(
        "INSERT INTO versions (note_id, id, saved_at, state) VALUES (?, ?, ?, ?)",
      )
      .run(current.entity.id, undoVersion, stamp, JSON.stringify(current));
    next.entity.updatedAt = stamp;
    next.entity.revision = newRevision();
    this.put(next);
    return undoVersion;
  }

  async snapshot(): Promise<Snapshot> {
    this.checkLease();
    this.refresh();
    const preferences = this.preferences();
    const current = this.clock();
    const legacyDiagnostics = this.setting("migrationDiagnostics");
    const diagnostics: Diagnostic[] = legacyDiagnostics
      ? JSON.parse(legacyDiagnostics)
      : [];
    return {
      tasks: this.db
        .prepare("SELECT * FROM notes WHERE kind = 'task'")
        .all()
        .map((row) => (readNote(row) as StoredTask).entity),
      projects: this.projects(),
      diagnostics: [...diagnostics, ...this.automationIssues],
      preferences,
      vaultName: this.setting("vaultName") ?? "Todo",
      vaultKey: this.setting("vaultKey") ?? "",
      storage: "sqlite",
      now: current.toISOString(),
      today: dayInZone(current, preferences.timezone),
      version: "0.1.0",
    };
  }

  async createTask(input: unknown): Promise<Task> {
    const values = taskCreateSchema.parse(input);
    return this.transact(() => {
      const existing = this.find(values.requestId);
      if (existing) {
        if (existing.kind === "task") return existing.entity;
        throw new AppError(
          409,
          "ID_EXISTS",
          "This identity belongs to another item.",
        );
      }
      const time = this.clock();
      const stamp = time.toISOString();
      const status =
        values.status ??
        (values.scheduled || values.due || values.projectId ? "todo" : "inbox");
      const planned = values.repeat
        ? (values.scheduled ??
          values.due ??
          dayInZone(time, this.preferences().timezone))
        : null;
      const entity: Task = {
        id: values.requestId,
        title: values.title,
        status,
        scheduled: values.scheduled ?? null,
        due: values.due ?? null,
        ...this.assignProject(values.projectId ?? null),
        trashed: values.trashed ?? false,
        tags: values.tags ?? [],
        createdAt: stamp,
        updatedAt: stamp,
        completedAt: status === "done" ? stamp : null,
        previousStatus: "todo",
        notes: values.notes ?? "",
        revision: newRevision(),
        path: `Tasks/${slug(values.title)}--${values.requestId}.md`,
        reminder: values.reminder ?? null,
        repeat: values.repeat ?? null,
        originalScheduled: null,
        rolloverCount: 0,
        lastRolledAt: null,
        recurrenceSourceId: null,
        nextOccurrenceId: null,
      };
      this.put({
        kind: "task",
        entity,
        recurrence: { ...emptyRecurrence, anchor: planned, planned },
      });
      if (status === "done") this.ensureRecurrence(entity.id);
      return this.get(entity.id, "task").entity;
    });
  }

  async createProject(input: unknown): Promise<Project> {
    const values = projectCreateSchema.parse(input);
    return this.transact(() => {
      const existing = this.find(values.requestId);
      if (existing) {
        if (existing.kind === "project") return existing.entity;
        throw new AppError(
          409,
          "ID_EXISTS",
          "This identity belongs to another item.",
        );
      }
      this.uniqueProjectName(values.title);
      const time = this.clock().toISOString();
      const entity: Project = {
        id: values.requestId,
        title: values.title,
        notes: values.notes ?? "",
        archived: false,
        path: `Projects/${slug(values.title)}--${values.requestId}.md`,
        revision: newRevision(),
        createdAt: time,
        updatedAt: time,
      };
      this.put({ kind: "project", entity });
      return entity;
    });
  }

  private saveTaskPatch(current: StoredTask, patch: TaskPatch) {
    const { projectId, ...values } = patch;
    const next: StoredTask = {
      kind: "task",
      entity: { ...current.entity, ...values },
      recurrence: { ...current.recurrence },
    };
    const { entity, recurrence } = next;
    if (projectId !== undefined)
      Object.assign(entity, this.assignProject(projectId));
    if (patch.status === "done" && current.entity.status !== "done") {
      entity.previousStatus = current.entity.status;
      entity.completedAt = this.clock().toISOString();
    } else if (patch.status && patch.status !== "done") {
      entity.completedAt = null;
    }
    if (
      patch.repeat !== undefined ||
      patch.scheduled !== undefined ||
      (!current.entity.scheduled && patch.due !== undefined)
    ) {
      const planned = entity.repeat
        ? (entity.scheduled ??
          entity.due ??
          dayInZone(this.clock(), this.preferences().timezone))
        : null;
      recurrence.anchor = planned;
      recurrence.planned = planned;
    }
    const undoVersion = this.save(current, next);
    return { ...entity, undoVersion };
  }

  async updateTask(id: string, revision: string, input: unknown) {
    const patch = taskPatchSchema.parse(input);
    return this.transact(() => {
      const current = this.get(id, "task");
      this.requireRevision(current, revision);
      const { undoVersion } = this.saveTaskPatch(current, patch);
      if (patch.status === "done") this.ensureRecurrence(id);
      else if (patch.status) this.cancelRecurrence(id);
      return { ...this.get(id, "task").entity, undoVersion };
    });
  }

  async updateProject(id: string, revision: string, input: unknown) {
    const patch = projectPatchSchema.parse(input);
    return this.transact(() => {
      const current = this.get(id, "project");
      this.requireRevision(current, revision);
      if (patch.title && patch.title !== current.entity.title)
        this.uniqueProjectName(patch.title, id);
      const next: StoredProject = {
        kind: "project",
        entity: { ...current.entity, ...patch },
      };
      const undoVersion = this.save(current, next);
      return { ...next.entity, undoVersion };
    });
  }

  async bulkSchedule(input: BulkSchedule) {
    return this.transact(() => {
      const tasks = input.tasks.map(({ id, revision }) => {
        const current = this.get(id, "task");
        this.requireRevision(current, revision);
        if (!active(current.entity)) {
          throw new AppError(
            409,
            "TASK_NOT_OPEN",
            "Only open tasks can be rescheduled.",
            current.entity,
          );
        }
        return current;
      });
      return tasks.map((current) =>
        current.entity.scheduled === input.scheduled
          ? current.entity
          : this.saveTaskPatch(current, { scheduled: input.scheduled }),
      );
    });
  }

  async setPreferences(input: unknown) {
    const preferences = preferenceSchema.parse(input);
    return this.transact(() => {
      this.db
        .prepare(
          `
        INSERT INTO settings (key, value) VALUES ('preferences', ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `,
        )
        .run(JSON.stringify(preferences));
      return preferences;
    });
  }

  private versionRecord(row: VersionRow, task?: Task): StoredNote {
    if (row.state) return JSON.parse(row.state) as StoredNote;
    const note = legacyNote(
      "task",
      task?.path ?? "",
      row.legacy_raw!,
      row.saved_at,
    ) as StoredTask;
    note.entity.projectId = this.resolveLegacyProject(note.entity);
    return note;
  }

  async versions(id: string): Promise<Version[]> {
    uuid.parse(id);
    const rows = this.db
      .prepare(
        `
      SELECT id, saved_at, state, legacy_raw FROM versions WHERE note_id = ? ORDER BY id DESC LIMIT 100
    `,
      )
      .all(id) as unknown as VersionRow[];
    return rows.map((row) => {
      if (row.legacy_raw !== null) {
        const previous = parseNote(row.legacy_raw);
        return {
          id: row.id,
          savedAt: row.saved_at,
          title: String(previous.data.title),
          notes: previous.body,
        };
      }
      const { entity } = this.versionRecord(row);
      return {
        id: row.id,
        savedAt: row.saved_at,
        title: entity.title,
        notes: entity.notes,
      };
    });
  }

  async restore(id: string, revision: string, version: string) {
    if (!/^[\w-]+$/.test(version))
      throw new AppError(400, "VERSION_INVALID", "Invalid recovery version.");
    return this.transact(() => {
      const current = this.get(id, "task");
      this.requireRevision(current, revision);
      const row = this.db
        .prepare(
          `
        SELECT id, saved_at, state, legacy_raw FROM versions WHERE note_id = ? AND id = ?
      `,
        )
        .get(id, version) as VersionRow | undefined;
      if (!row)
        throw new AppError(
          404,
          "VERSION_MISSING",
          "This recovery version is unavailable.",
        );
      const previous = this.versionRecord(row, current.entity);
      if (previous.kind !== "task" || previous.entity.id !== id) {
        throw new AppError(
          400,
          "VERSION_INVALID",
          "This recovery version belongs to another task.",
        );
      }
      if (current.entity.nextOccurrenceId) {
        previous.entity.nextOccurrenceId = current.entity.nextOccurrenceId;
        previous.recurrence.created = current.recurrence.created;
        previous.recurrence.revision = current.recurrence.revision;
        previous.recurrence.undone = current.recurrence.undone;
      }
      const undoVersion = this.save(current, previous);
      if (previous.entity.status === "done") this.ensureRecurrence(id);
      else this.cancelRecurrence(id);
      return { ...this.get(id, "task").entity, undoVersion };
    });
  }

  private ensureRecurrence(id: string) {
    const previous = this.get(id, "task");
    const { entity, recurrence } = previous;
    if (!entity.repeat || entity.status !== "done" || entity.trashed) return;
    const childId = entity.nextOccurrenceId ?? nextTaskId(id);
    const existing = this.find(childId);
    if (recurrence.created) {
      if (
        recurrence.undone &&
        existing?.kind === "task" &&
        existing.entity.revision === recurrence.revision &&
        existing.entity.recurrenceSourceId === id
      ) {
        const revived = this.saveTaskPatch(existing, { trashed: false });
        this.save(previous, {
          ...previous,
          entity: { ...entity },
          recurrence: {
            ...recurrence,
            undone: false,
            revision: revived.revision,
          },
        });
      }
      return;
    }
    if (
      existing &&
      (existing.kind !== "task" || existing.entity.recurrenceSourceId !== id)
    ) {
      throw new AppError(
        409,
        "RECURRENCE_ID",
        "The next occurrence identity belongs to another item.",
      );
    }
    const child =
      existing?.entity ?? this.generateRecurrence(previous, childId);
    this.save(previous, {
      ...previous,
      entity: { ...entity, nextOccurrenceId: childId },
      recurrence: { ...recurrence, created: true, revision: child.revision },
    });
  }

  private generateRecurrence(parent: StoredTask, childId: string) {
    const { entity, recurrence } = parent;
    const { timezone } = this.preferences();
    const now = this.clock();
    const today = dayInZone(now, timezone);
    const planned =
      entity.scheduled ??
      entity.due ??
      dayInZone(
        entity.completedAt ? new Date(entity.completedAt) : now,
        timezone,
      );
    const originalPlan =
      recurrence.planned ?? entity.originalScheduled ?? planned;
    const anchor = recurrence.anchor ?? entity.originalScheduled ?? planned;
    const scheduled = nextOccurrence(
      anchor,
      entity.repeat!,
      planned > today ? planned : today,
    );
    const shift = daysBetween(originalPlan, scheduled);
    let body = entity.notes;
    for (const item of checkItems(body)
      .filter((item) => item.checked)
      .reverse())
      body = toggleCheck(body, item);
    const child: Task = {
      ...entity,
      id: childId,
      status: "todo",
      scheduled,
      due: entity.due ? addDays(entity.due, shift) : null,
      reminder: entity.reminder
        ? shiftReminder(entity.reminder, shift, timezone)
        : null,
      trashed: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      previousStatus: "todo",
      originalScheduled: null,
      rolloverCount: 0,
      lastRolledAt: null,
      recurrenceSourceId: entity.id,
      nextOccurrenceId: null,
      revision: newRevision(),
      path: `Tasks/recurring--${childId}.md`,
      notes: body,
    };
    this.put({
      kind: "task",
      entity: child,
      recurrence: { ...emptyRecurrence, anchor, planned: scheduled },
    });
    return child;
  }

  private cancelRecurrence(id: string) {
    const previous = this.get(id, "task");
    const { entity, recurrence } = previous;
    if (entity.status === "done" || !entity.nextOccurrenceId) return;
    const child = this.find(entity.nextOccurrenceId);
    if (
      child?.kind !== "task" ||
      child.entity.revision !== recurrence.revision ||
      child.entity.recurrenceSourceId !== id ||
      !active(child.entity)
    )
      return;
    const canceled = this.saveTaskPatch(child, { trashed: true });
    this.save(previous, {
      ...previous,
      entity: { ...entity },
      recurrence: { ...recurrence, undone: true, revision: canceled.revision },
    });
  }

  private refresh() {
    const preferences = this.preferences();
    const time = this.clock();
    const today = dayInZone(time, preferences.timezone);
    const overdue = preferences.autoRollover
      ? this.db
          .prepare(
            `
      SELECT id FROM notes WHERE kind = 'task' AND trashed = 0 AND status <> 'done' AND scheduled < ?
    `,
          )
          .all(today)
      : [];
    if (overdue.length) {
      this.transact(() => {
        for (const { id } of overdue) {
          const current = this.get(String(id), "task");
          const task = current.entity;
          if (!active(task) || !task.scheduled || task.scheduled >= today)
            continue;
          this.save(current, {
            ...current,
            entity: {
              ...task,
              scheduled: today,
              originalScheduled: task.originalScheduled ?? task.scheduled,
              rolloverCount: Math.min(
                Number.MAX_SAFE_INTEGER,
                task.rolloverCount + 1,
              ),
              lastRolledAt: time.toISOString(),
            },
          });
        }
      });
    }
    const pending = this.db
      .prepare(
        `
      SELECT parent.id FROM notes AS parent
      LEFT JOIN notes AS child ON child.id = json_extract(parent.metadata, '$.nextOccurrenceId')
      WHERE parent.kind = 'task' AND parent.status = 'done' AND parent.trashed = 0
      AND json_extract(parent.metadata, '$.repeat') IS NOT NULL
      AND (json_extract(parent.metadata, '$.recurrence.created') <> 1
        OR (json_extract(parent.metadata, '$.recurrence.undone') = 1
          AND child.kind = 'task' AND child.revision = json_extract(parent.metadata, '$.recurrence.revision')
          AND json_extract(child.metadata, '$.recurrenceSourceId') = parent.id))
    `,
      )
      .all();
    const issues: Diagnostic[] = [];
    for (const { id } of pending) {
      try {
        this.transact(() => this.ensureRecurrence(String(id)));
      } catch (error) {
        const { entity } = this.get(String(id), "task");
        issues.push({
          id: hash("automation:" + entity.id),
          path: entity.path,
          message: "Repeating task update paused. " + (error as Error).message,
          adoptable: false,
          revision: entity.revision,
        });
      }
    }
    this.automationIssues = issues;
  }
}
