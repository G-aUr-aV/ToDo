import { EventEmitter } from "node:events";
import { taskTemplate, taskBase } from "./templates";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { watch, type FSWatcher } from "chokidar";
import { Document } from "yaml";
import {
  addDays,
  daysBetween,
  nextOccurrence,
  shiftReminder,
} from "./recurrence";
import { checkItems, toggleCheck } from "./checklist";
import {
  AppError,
  defaultPreferences,
  dayInZone,
  preferenceSchema,
  taskCreateSchema,
  taskPatchSchema,
  projectCreateSchema,
  projectPatchSchema,
  uuid,
  type Task,
  type Project,
  type Snapshot,
  type Preferences,
  type Diagnostic,
  type Version,
} from "./model";
import {
  parseNote,
  serialize,
  freshNote,
  taskFrom,
  projectFrom,
  hash,
  MAX_NOTE_BYTES,
  type ParsedNote,
} from "./notes";
type RecordNote = {
  path: string;
  raw: string;
  mtimeMs: number;
  parsed: Pick<ParsedNote, "data">;
  entity: Task | Project;
  kind: "task" | "project";
};
export type ImportItem = { name: string; raw: string };
export type ImportPreview = {
  name: string;
  title: string;
  valid: boolean;
  message: string;
};
const slug = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "task";
const now = () => new Date();
const nextTaskId = (id: string) => {
  const hex = hash("todo-next-occurrence:" + id)
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
export class Vault extends EventEmitter {
  private rootPath: string;
  get root() {
    return this.rootPath;
  }
  readonly state: string;
  private release?: () => Promise<void>;
  private watcher?: FSWatcher;
  private interval?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private compromised = false;
  private queue: Promise<unknown> = Promise.resolve();
  private records = new Map<string, RecordNote>();
  private issues: Diagnostic[] = [];
  private candidates = new Map<
    string,
    { path: string; raw: string; parsed: ParsedNote }
  >();
  private preferences: Preferences = { ...defaultPreferences };
  private signature = "";
  private automationSignature = "";
  private scanQueue: Promise<unknown> = Promise.resolve();
  constructor(
    root: string,
    state?: string,
    private clock: () => Date = now,
  ) {
    super();
    this.rootPath = path.resolve(root);
    this.state = path.resolve(
      state ??
        path.join(
          path.dirname(this.root),
          ".todo-state",
          hash(this.root).slice(0, 16),
        ),
    );
  }
  async start() {
    const rootStat = await fs.lstat(this.root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
      throw new AppError(
        400,
        "VAULT_PATH",
        "Choose an ordinary vault folder, not a symlink.",
      );
    // macOS /var and some Windows directory selections contain parent aliases.
    // Reject a symlink vault itself, then use its canonical directory consistently.
    this.rootPath = await fs.realpath(this.rootPath);
    for (const folder of ["Tasks", "Projects"]) {
      await fs.mkdir(path.join(this.root, folder), { recursive: true });
      await this.safe(folder);
    }
    await fs.mkdir(this.state, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.state)).isSymbolicLink())
      throw new AppError(
        400,
        "STATE_PATH",
        "Recovery storage cannot be a symlink.",
      );
    try {
      this.release = await lockfile.lock(this.root, {
        lockfilePath: path.join(this.root, ".todo-writer.lock"),
        stale: 30_000,
        update: 10_000,
        retries: 0,
        onCompromised: () => {
          this.compromised = true;
          this.emit("changed");
        },
      });
    } catch {
      throw new AppError(
        423,
        "VAULT_BUSY",
        "Another Todo instance is using this vault. Connect to it or close it first.",
      );
    }
    try {
      const probe = await this.safe("Tasks/.todo-probe-" + randomUUID());
      await fs.writeFile(probe, "ready", { flag: "wx", mode: 0o600 });
      await fs.unlink(probe);
      try {
        this.preferences = preferenceSchema.parse(
          JSON.parse(
            await fs.readFile(
              path.join(this.state, "preferences.json"),
              "utf8",
            ),
          ),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new AppError(
            503,
            "PREFERENCES_INVALID",
            "Workspace preferences need repair before the vault can open.",
          );
      }
      await this.refresh();
      this.watcher = watch(
        [path.join(this.root, "Tasks"), path.join(this.root, "Projects")],
        {
          ignoreInitial: true,
          ignored: (p) => path.basename(p).startsWith("."),
          awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
        },
      );
      this.watcher.on("all", () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(
          () => void this.refresh().catch(() => this.emit("changed")),
          150,
        );
      });
      this.interval = setInterval(
        () => void this.refresh().catch(() => this.emit("changed")),
        15_000,
      );
      this.interval.unref();
    } catch (e) {
      await this.close();
      throw e;
    }
    return this;
  }
  async close() {
    clearTimeout(this.debounce);
    clearInterval(this.interval);
    await this.watcher?.close();
    await this.queue.catch(() => {});
    await this.release?.().catch(() => {});
    this.release = undefined;
  }
  private assertWritable() {
    if (!this.release || this.compromised)
      throw new AppError(
        423,
        "LOCK_LOST",
        "The vault writer lock is unavailable. Close and reopen this workspace.",
      );
  }
  private async safe(relative: string) {
    const pieces = relative.split(/[\\/]/);
    if (
      pieces.some((v) => v === ".." || v === "." || !v) ||
      !["Tasks", "Projects"].includes(pieces[0])
    )
      throw new AppError(
        400,
        "PATH_INVALID",
        "This note is outside the task folders.",
      );
    const canonical = await fs.realpath(this.root);
    if (canonical !== this.root)
      throw new AppError(
        503,
        "VAULT_MOVED",
        "The vault path changed. Choose the folder again.",
      );
    let resolved = this.root;
    for (const p of pieces) {
      resolved = path.join(resolved, p);
      try {
        if ((await fs.lstat(resolved)).isSymbolicLink())
          throw new AppError(
            400,
            "SYMLINK",
            "Symlink notes and folders are not supported.",
          );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return resolved;
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private async atomic(file: string, raw: string) {
    const temp = path.join(
      path.dirname(file),
      ".todo-" + randomUUID() + ".tmp",
    );
    let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600);
      await handle.writeFile(raw, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temp, file);
      if (process.platform !== "win32") {
        const dir = await fs.open(path.dirname(file), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(() => {});
    }
  }
  scan(): Promise<void> {
    const next = this.scanQueue.then(() => this.scanUnsafe());
    this.scanQueue = next.catch(() => {});
    return next;
  }
  private async scanUnsafe() {
    if ((await fs.realpath(this.root)) !== this.root)
      throw new AppError(
        503,
        "VAULT_MOVED",
        "Your vault is unavailable. Choose it again.",
      );
    const collected: RecordNote[] = [];
    const previousByPath = new Map(
      [...this.records.values()].map((record) => [record.path, record]),
    );
    const issues: Diagnostic[] = [];
    const candidates = new Map<
      string,
      { path: string; raw: string; parsed: ParsedNote }
    >();
    const walk = async (relative: string, kind: "task" | "project") => {
      const full = await this.safe(relative);
      const entries = await fs.readdir(full, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const rel = relative + "/" + entry.name;
        if (entry.isSymbolicLink()) {
          issues.push({
            id: hash(rel),
            path: rel,
            message: "Symlink skipped. Use an ordinary note file.",
            adoptable: false,
            revision: "",
          });
          continue;
        }
        if (entry.isDirectory()) {
          await walk(rel, kind);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md"))
          continue;
        let raw = "";
        try {
          const file = await this.safe(rel);
          const st = await fs.stat(file);
          if (st.size > MAX_NOTE_BYTES)
            throw new Error("This note is too large to edit safely.");
          raw = await fs.readFile(file, "utf8");
          const previous = previousByPath.get(rel);
          // Always read disk content so Obsidian edits are observed. Unchanged
          // bytes and mtime can reuse plain metadata without building another
          // YAML tree. Actual edits reparse raw text to preserve comments.
          if (
            previous?.kind === kind &&
            previous.raw === raw &&
            previous.mtimeMs === st.mtimeMs
          ) {
            collected.push(previous);
            continue;
          }
          const parsed = parseNote(raw);
          const revision = hash(raw);
          const entity =
            kind === "task"
              ? taskFrom(parsed, rel, revision, st.mtime.toISOString())
              : projectFrom(parsed, rel, revision, st.mtime.toISOString());
          if (!entity.id) {
            const id = hash(rel);
            if (kind === "task") {
              candidates.set(id, { path: rel, raw, parsed });
              issues.push({
                id,
                path: rel,
                message: "Ready to adopt: no stable task identity yet.",
                adoptable: true,
                revision,
              });
            } else
              issues.push({
                id: hash(rel),
                path: rel,
                message: "This project needs a stable UUID identity.",
                adoptable: false,
                revision,
              });
          } else
            collected.push({
              path: rel,
              raw,
              mtimeMs: st.mtimeMs,
              parsed: { data: parsed.data },
              entity,
              kind,
            });
        } catch (e) {
          issues.push({
            id: hash(rel),
            path: rel,
            message: (e as Error).message,
            adoptable: false,
            revision: hash(raw),
          });
        }
      }
    };
    await walk("Tasks", "task");
    await walk("Projects", "project");
    const grouped = new Map<string, RecordNote[]>();
    for (const r of collected)
      grouped.set(r.entity.id, [...(grouped.get(r.entity.id) ?? []), r]);
    const records = new Map<string, RecordNote>();
    for (const [id, group] of grouped) {
      if (group.length > 1) {
        for (const r of group)
          issues.push({
            id: hash(r.path),
            path: r.path,
            message:
              "Duplicate identity. These notes are read-only until each has a unique UUID.",
            adoptable: false,
            revision: r.entity.revision,
          });
      } else records.set(id, group[0]);
    }
    const projects = [...records.values()]
      .filter((r) => r.kind === "project")
      .map((r) => r.entity as Project);
    for (const r of records.values())
      if (r.kind === "task") {
        const task = r.entity as Task;
        if (task.project) {
          const target = task.project
            .replace(/^\[\[|\]\]$/g, "")
            .split("|")[0]
            .replace(/\.md$/, "");
          const matching = projects.filter(
            (p) =>
              p.path.replace(/\.md$/, "") === target ||
              p.title === target ||
              "Projects/" + p.title === target,
          );
          task.projectId = matching.length === 1 ? matching[0].id : null;
        }
      }
    const signature = hash(
      JSON.stringify(
        [...records.values()].map((r) => [r.path, r.entity.revision]),
      ) + JSON.stringify(issues),
    );
    this.records = records;
    this.issues = issues;
    this.candidates = candidates;
    if (signature !== this.signature) {
      this.signature = signature;
      this.emit("changed");
    }
  }
  // Reuse the existing scan cadence for midnight and restart catch-up. All
  // automatic writes share the same queue and revision checks as manual edits.
  private refresh(): Promise<void> {
    return this.exclusive(async () => {
      this.assertWritable();
      await this.scan();
      const today = dayInZone(this.clock(), this.preferences.timezone);
      const failures: Diagnostic[] = [];
      let rolled = false;
      for (const record of [...this.records.values()]) {
        if (record.kind !== "task") continue;
        const task = record.entity as Task;
        if (task.trashed) continue;
        try {
          if (
            this.preferences.autoRollover &&
            task.status !== "done" &&
            task.scheduled &&
            task.scheduled < today
          ) {
            await this.update(
              task.id,
              task.revision,
              "task",
              {
                scheduled: today,
                original_scheduled: task.originalScheduled ?? task.scheduled,
                rollover_count: Math.min(
                  Number.MAX_SAFE_INTEGER,
                  task.rolloverCount + 1,
                ),
                last_rolled_at: this.clock().toISOString(),
              },
              { rescan: false },
            );
            rolled = true;
          }
          if (task.status === "done" && task.repeat)
            await this.ensureRecurrence(task.id);
        } catch (error) {
          failures.push({
            id: hash("automation:" + record.path),
            path: record.path,
            message:
              "Automatic task update paused. " +
              (error instanceof AppError
                ? error.message
                : "Check this note's permissions and properties, then retry."),
            adoptable: false,
            revision: task.revision,
          });
        }
      }
      if (rolled) await this.scan();
      this.issues.push(...failures);
      const failureSignature = hash(JSON.stringify(failures));
      if (failureSignature !== this.automationSignature) {
        this.automationSignature = failureSignature;
        this.emit("changed");
      }
    });
  }
  private async ensureRecurrence(id: string) {
    let record = this.get(id, "task");
    let task = record.entity as Task;
    if (!task.repeat || task.status !== "done" || task.trashed) return;
    if (!task.nextOccurrenceId) {
      await this.update(id, task.revision, "task", {
        next_occurrence_id: nextTaskId(task.id),
        next_occurrence_created: false,
      });
      record = this.get(id, "task");
      task = record.entity as Task;
    }
    const childId = task.nextOccurrenceId!;
    const existing = this.records.get(childId);
    if (record.parsed.data.next_occurrence_created === true) {
      // Undo only cancels an untouched generated successor. Re-completing its
      // original restores that same note rather than creating another copy.
      if (
        record.parsed.data.next_occurrence_undone === true &&
        existing?.kind === "task" &&
        existing.entity.revision ===
          record.parsed.data.next_occurrence_revision &&
        (existing.entity as Task).recurrenceSourceId === id
      ) {
        const revived = await this.update(
          childId,
          existing.entity.revision,
          "task",
          { trashed: false },
        );
        const current = this.get(id, "task").entity;
        await this.update(id, current.revision, "task", {
          next_occurrence_undone: false,
          next_occurrence_revision: revived.revision,
        });
      }
      return;
    }
    if (existing) {
      if (
        existing.kind !== "task" ||
        (existing.entity as Task).recurrenceSourceId !== id
      )
        throw new AppError(
          409,
          "RECURRENCE_ID",
          "The next occurrence identity belongs to another note.",
        );
      await this.update(id, task.revision, "task", {
        next_occurrence_created: true,
        next_occurrence_revision: existing.entity.revision,
      });
      return;
    }
    if (
      this.issues.some((issue) =>
        issue.message.startsWith("Duplicate identity"),
      )
    )
      throw new AppError(
        409,
        "DUPLICATE_ID",
        "Resolve duplicate note identities before creating the next occurrence.",
      );
    const today = dayInZone(this.clock(), this.preferences.timezone);
    const planned =
      task.scheduled ??
      task.due ??
      dayInZone(
        task.completedAt ? new Date(task.completedAt) : this.clock(),
        this.preferences.timezone,
      );
    const originalPlan =
      typeof record.parsed.data.repeat_occurrence_scheduled === "string"
        ? record.parsed.data.repeat_occurrence_scheduled
        : (task.originalScheduled ?? planned);
    const anchor =
      typeof record.parsed.data.repeat_anchor === "string"
        ? record.parsed.data.repeat_anchor
        : (task.originalScheduled ?? planned);
    const scheduled = nextOccurrence(
      anchor,
      task.repeat!,
      planned > today ? planned : today,
    );
    const shift = daysBetween(originalPlan, scheduled);
    const generated = parseNote(record.raw);
    const time = this.clock().toISOString();
    const fields: Record<string, unknown> = {
      id: childId,
      status: "todo",
      scheduled,
      due: task.due ? addDays(task.due, shift) : null,
      reminder_at: task.reminder
        ? shiftReminder(task.reminder, shift, this.preferences.timezone)
        : null,
      focus: false,
      trashed: false,
      created_at: time,
      updated_at: time,
      completed_at: null,
      previous_status: "todo",
      repeat_anchor: anchor,
      repeat_occurrence_scheduled: scheduled,
      original_scheduled: null,
      rollover_count: 0,
      last_rolled_at: null,
      recurrence_source_id: id,
      next_occurrence_id: null,
      next_occurrence_created: false,
      next_occurrence_revision: null,
      next_occurrence_undone: false,
    };
    for (const [key, value] of Object.entries(fields))
      generated.document.set(key, value);
    for (const item of checkItems(generated.body)
      .filter((item) => item.checked)
      .reverse())
      generated.body = toggleCheck(generated.body, item);
    const raw = serialize(generated);
    if (Buffer.byteLength(raw) > MAX_NOTE_BYTES)
      throw new AppError(
        400,
        "NOTE_TOO_LARGE",
        "The next occurrence is too large to save.",
      );
    const file = await this.safe(`Tasks/recurring--${childId}.md`);
    try {
      await fs.access(file);
      throw new AppError(
        409,
        "PATH_EXISTS",
        "The next occurrence path is already occupied. Nothing was overwritten.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // The parent contains the deterministic successor identity before this
    // write. A crash here is recovered by finding that identity on restart.
    await this.atomic(file, raw);
    await this.scan();
    record = this.get(id, "task");
    await this.update(id, record.entity.revision, "task", {
      next_occurrence_created: true,
      next_occurrence_revision: hash(raw),
    });
  }
  private async cancelNextOccurrence(id: string) {
    const record = this.get(id, "task");
    const task = record.entity as Task;
    if (task.status === "done" || !task.nextOccurrenceId) return;
    const child = this.records.get(task.nextOccurrenceId);
    if (
      child?.kind !== "task" ||
      child.entity.revision !== record.parsed.data.next_occurrence_revision ||
      (child.entity as Task).recurrenceSourceId !== id ||
      (child.entity as Task).trashed ||
      (child.entity as Task).status === "done"
    )
      return;
    const canceled = await this.update(
      task.nextOccurrenceId,
      child.entity.revision,
      "task",
      { trashed: true },
    );
    const current = this.get(id, "task").entity;
    await this.update(id, current.revision, "task", {
      next_occurrence_undone: true,
      next_occurrence_revision: canceled.revision,
    });
  }
  async snapshot(): Promise<Snapshot> {
    this.assertWritable();
    await this.refresh();
    const current = this.clock();
    return {
      tasks: [...this.records.values()]
        .filter((r) => r.kind === "task")
        .map((r) => r.entity as Task),
      projects: [...this.records.values()]
        .filter((r) => r.kind === "project")
        .map((r) => r.entity as Project)
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.title.localeCompare(b.title),
        ),
      diagnostics: this.issues,
      preferences: this.preferences,
      vaultName: path.basename(this.root),
      vaultKey: hash(this.root).slice(0, 16),
      now: current.toISOString(),
      today: dayInZone(current, this.preferences.timezone),
      version: "0.1.0",
    };
  }
  private get(id: string, kind: "task" | "project") {
    uuid.parse(id);
    const r = this.records.get(id);
    if (!r || r.kind !== kind)
      throw new AppError(
        404,
        "NOTE_MISSING",
        "This note is no longer available. Rescan the vault.",
      );
    return r;
  }
  private projectLink(id: string | null) {
    if (!id) return null;
    const project = this.get(id, "project").entity as Project;
    if (project.archived)
      throw new AppError(
        400,
        "PROJECT_ARCHIVED",
        "Restore the project before assigning new tasks.",
      );
    return `[[${project.path.replace(/\.md$/, "")}]]`;
  }
  async createTask(input: unknown): Promise<Task> {
    const values = taskCreateSchema.parse(input);
    return this.exclusive(async () => {
      this.assertWritable();
      await this.scan();
      const existing = this.records.get(values.requestId);
      if (existing) {
        if (existing.kind !== "task")
          throw new AppError(
            409,
            "ID_EXISTS",
            "This identity belongs to another note.",
          );
        return existing.entity as Task;
      }
      if (this.issues.some((d) => d.message.startsWith("Duplicate identity")))
        throw new AppError(
          409,
          "DUPLICATE_ID",
          "Resolve duplicate note identities before creating new notes.",
        );
      const time = this.clock().toISOString();
      const { requestId, title, notes, projectId, ...rest } = values;
      const fields = {
        schema_version: 1,
        type: "task",
        id: requestId,
        title,
        status:
          rest.status ??
          (rest.scheduled || rest.due || projectId ? "todo" : "inbox"),
        scheduled: rest.scheduled ?? null,
        due: rest.due ?? null,
        project: this.projectLink(projectId ?? null),
        focus: rest.focus ?? false,
        trashed: rest.trashed ?? false,
        tags: rest.tags ?? [],
        created_at: time,
        updated_at: time,
        completed_at: rest.status === "done" ? time : null,
        reminder_at: rest.reminder ?? null,
        repeat: rest.repeat ?? null,
        repeat_anchor: rest.repeat
          ? (rest.scheduled ??
            rest.due ??
            dayInZone(this.clock(), this.preferences.timezone))
          : null,
        repeat_occurrence_scheduled: rest.repeat
          ? (rest.scheduled ??
            rest.due ??
            dayInZone(this.clock(), this.preferences.timezone))
          : null,
      };
      const rel = `Tasks/${slug(title)}--${requestId}.md`;
      const file = await this.safe(rel);
      try {
        await fs.access(file);
        throw new AppError(
          409,
          "PATH_EXISTS",
          "A file with this name already exists.",
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.atomic(file, freshNote(fields, notes ?? ""));
      await this.scan();
      return this.get(requestId, "task").entity as Task;
    });
  }
  async createProject(input: unknown): Promise<Project> {
    const values = projectCreateSchema.parse(input);
    return this.exclusive(async () => {
      this.assertWritable();
      await this.scan();
      const existing = this.records.get(values.requestId);
      if (existing) {
        if (existing.kind !== "project")
          throw new AppError(
            409,
            "ID_EXISTS",
            "This identity belongs to another note.",
          );
        return existing.entity as Project;
      }
      const time = this.clock().toISOString();
      const rel = `Projects/${slug(values.title)}--${values.requestId}.md`;
      const file = await this.safe(rel);
      try {
        await fs.access(file);
        throw new AppError(
          409,
          "PATH_EXISTS",
          "A file with this name already exists.",
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.atomic(
        file,
        freshNote(
          {
            schema_version: 1,
            type: "project",
            id: values.requestId,
            title: values.title,
            archived: false,
            created_at: time,
            updated_at: time,
          },
          values.notes ?? "",
        ),
      );
      await this.scan();
      return this.get(values.requestId, "project").entity as Project;
    });
  }
  private async snapshotVersion(record: RecordNote, raw: string) {
    const folder = path.join(this.state, "versions", record.entity.id);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const version =
      this.clock().toISOString().replace(/[:.]/g, "-") + "--" + randomUUID();
    await this.atomic(path.join(folder, version + ".md"), raw);
    return version;
  }
  private async update(
    id: string,
    revision: string,
    kind: "task" | "project",
    patch: Record<string, unknown>,
    options: { rescan?: boolean } = {},
  ) {
    this.assertWritable();
    if (options.rescan !== false) await this.scan();
    const r = this.get(id, kind);
    const file = await this.safe(r.path);
    const raw = await fs.readFile(file, "utf8");
    await fs.access(file, 2);
    if (hash(raw) !== revision) {
      await this.scan();
      throw new AppError(
        409,
        "CONFLICT",
        "This note changed while you were editing. Your draft is preserved.",
        this.get(id, kind).entity,
      );
    }
    const parsed = parseNote(raw);
    const time = this.clock().toISOString();
    if (kind === "task") {
      const task = r.entity as Task;
      if (Object.hasOwn(patch, "projectId")) {
        parsed.document.set(
          "project",
          this.projectLink(patch.projectId as string | null),
        );
        delete patch.projectId;
      }
      if (patch.status === "done" && task.status !== "done") {
        parsed.document.set("previous_status", task.status);
        parsed.document.set("completed_at", time);
        if (
          (Object.hasOwn(patch, "repeat") ? patch.repeat : task.repeat) &&
          !task.nextOccurrenceId
        ) {
          parsed.document.set("next_occurrence_id", nextTaskId(task.id));
          parsed.document.set("next_occurrence_created", false);
        }
      } else if (patch.status && patch.status !== "done")
        parsed.document.set("completed_at", null);
      if (Object.hasOwn(patch, "reminder")) {
        parsed.document.set("reminder_at", patch.reminder);
        delete patch.reminder;
      }
      if (
        Object.hasOwn(patch, "repeat") ||
        (Object.hasOwn(patch, "scheduled") &&
          !Object.hasOwn(patch, "last_rolled_at")) ||
        (!task.scheduled && Object.hasOwn(patch, "due"))
      ) {
        const repeat = Object.hasOwn(patch, "repeat")
          ? patch.repeat
          : task.repeat;
        const scheduled = Object.hasOwn(patch, "scheduled")
          ? patch.scheduled
          : task.scheduled;
        parsed.document.set(
          "repeat_anchor",
          repeat
            ? (scheduled ??
                patch.due ??
                task.due ??
                dayInZone(this.clock(), this.preferences.timezone))
            : null,
        );
        parsed.document.set(
          "repeat_occurrence_scheduled",
          repeat
            ? (scheduled ??
                patch.due ??
                task.due ??
                dayInZone(this.clock(), this.preferences.timezone))
            : null,
        );
      }
    }
    if (Object.hasOwn(patch, "notes")) {
      parsed.body = patch.notes as string;
      delete patch.notes;
    }
    for (const [key, value] of Object.entries(patch))
      parsed.document.set(key, value);
    parsed.document.set("updated_at", time);
    const updated = serialize(parsed);
    if (Buffer.byteLength(updated) > MAX_NOTE_BYTES)
      throw new AppError(
        400,
        "NOTE_TOO_LARGE",
        "This note is too large to save.",
      );
    const undoVersion = await this.snapshotVersion(r, raw);
    // Recheck after the recovery copy. Ordinary external editors still do not participate in an atomic transaction.
    const latest = await fs.readFile(await this.safe(r.path), "utf8");
    if (hash(latest) !== revision) {
      await this.scan();
      throw new AppError(
        409,
        "CONFLICT",
        "The vault changed during saving. Your draft is preserved.",
        this.get(id, kind).entity,
      );
    }
    await this.atomic(file, updated);
    if (options.rescan !== false) await this.scan();
    else {
      // Automatic batches already hold the write queue and did a full scan.
      // Keep just this record current; one final scan publishes the batch.
      const nextParsed = parseNote(updated);
      const entity =
        kind === "task"
          ? taskFrom(nextParsed, r.path, hash(updated), time)
          : projectFrom(nextParsed, r.path, hash(updated), time);
      if (kind === "task")
        (entity as Task).projectId = (r.entity as Task).projectId;
      this.records.set(id, {
        ...r,
        raw: updated,
        parsed: { data: nextParsed.data },
        entity,
        mtimeMs: (await fs.stat(file)).mtimeMs,
      });
    }
    return { ...this.get(id, kind).entity, undoVersion };
  }
  async updateTask(id: string, revision: string, input: unknown) {
    const patch = taskPatchSchema.parse(input);
    return this.exclusive(async () => {
      const updated = (await this.update(id, revision, "task", {
        ...patch,
      })) as Task;
      try {
        if (patch.status === "done") await this.ensureRecurrence(id);
        else if (patch.status) await this.cancelNextOccurrence(id);
      } catch (error) {
        // Completion itself has already been durably saved. Keep that success
        // visible; the diagnostic and next refresh recover the successor.
        this.issues.push({
          id: hash("automation:" + updated.path),
          path: updated.path,
          message:
            "Task saved. Repeating task update paused. " +
            (error instanceof AppError
              ? error.message
              : "Check this note's permissions and properties, then retry."),
          adoptable: false,
          revision: this.get(id, "task").entity.revision,
        });
        this.emit("changed");
      }
      return {
        ...this.get(id, "task").entity,
        undoVersion: updated.undoVersion,
      } as Task;
    });
  }
  async updateProject(id: string, revision: string, input: unknown) {
    const patch = projectPatchSchema.parse(input);
    return this.exclusive(() =>
      this.update(id, revision, "project", { ...patch }),
    ) as Promise<Project>;
  }
  async setPreferences(input: unknown) {
    const preferences = preferenceSchema.parse(input);
    return this.exclusive(async () => {
      this.assertWritable();
      await this.atomic(
        path.join(this.state, "preferences.json"),
        JSON.stringify(preferences, null, 2) + "\n",
      );
      this.preferences = preferences;
      this.emit("changed");
      return preferences;
    });
  }
  async versions(id: string): Promise<Version[]> {
    uuid.parse(id);
    let names: string[];
    try {
      names = await fs.readdir(path.join(this.state, "versions", id));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const versions = [];
    for (const name of names
      .filter((v) => /^[\w-]+\.md$/.test(v))
      .sort()
      .reverse()
      .slice(0, 100)) {
      const full = path.join(this.state, "versions", id, name);
      if ((await fs.lstat(full)).isSymbolicLink()) continue;
      const p = parseNote(await fs.readFile(full, "utf8"));
      versions.push({
        id: name.slice(0, -3),
        savedAt: (await fs.stat(full)).mtime.toISOString(),
        title: String(p.data.title),
        notes: p.body,
      });
    }
    return versions;
  }
  async restore(id: string, revision: string, version: string) {
    if (!/^[\w-]+$/.test(version))
      throw new AppError(400, "VERSION_INVALID", "Invalid recovery version.");
    uuid.parse(id);
    return this.exclusive(async () => {
      await this.scan();
      const r = this.get(id, "task");
      const versionFile = path.join(
        this.state,
        "versions",
        id,
        version + ".md",
      );
      if ((await fs.lstat(versionFile)).isSymbolicLink())
        throw new AppError(400, "SYMLINK", "Invalid recovery file.");
      const raw = await fs.readFile(versionFile, "utf8");
      const previous = taskFrom(
        parseNote(raw),
        r.path,
        hash(raw),
        this.clock().toISOString(),
      );
      if (previous.id !== id)
        throw new AppError(
          400,
          "VERSION_INVALID",
          "This recovery version belongs to another task.",
        );
      this.assertWritable();
      const file = await this.safe(r.path);
      const current = await fs.readFile(file, "utf8");
      if (hash(current) !== revision)
        throw new AppError(
          409,
          "CONFLICT",
          "The current note changed. Review it before restoring.",
          r.entity,
        );
      const restored = parseNote(raw);
      // Retain the successor identity even when restoring the pre-completion
      // note, so Undo/re-completion cannot fork a duplicate recurring series.
      if ((r.entity as Task).nextOccurrenceId) {
        for (const key of [
          "next_occurrence_id",
          "next_occurrence_created",
          "next_occurrence_revision",
          "next_occurrence_undone",
        ])
          if (r.parsed.data[key] !== undefined)
            restored.document.set(key, r.parsed.data[key]);
      }
      restored.document.set("updated_at", this.clock().toISOString());
      const undoVersion = await this.snapshotVersion(r, current);
      if (
        hash(await fs.readFile(await this.safe(r.path), "utf8")) !== revision
      ) {
        await this.scan();
        throw new AppError(
          409,
          "CONFLICT",
          "The note changed during restore. Nothing was replaced.",
          this.get(id, "task").entity,
        );
      }
      await this.atomic(file, serialize(restored));
      await this.scan();
      if (previous.status === "done") await this.ensureRecurrence(id);
      else await this.cancelNextOccurrence(id);
      return { ...this.get(id, "task").entity, undoVersion } as Task;
    });
  }
  async adopt(candidate: string, revision: string) {
    return this.exclusive(async () => {
      this.assertWritable();
      await this.scan();
      const c = this.candidates.get(candidate);
      if (!c)
        throw new AppError(
          404,
          "CANDIDATE_MISSING",
          "This note is no longer awaiting adoption.",
        );
      const file = await this.safe(c.path);
      const raw = await fs.readFile(file, "utf8");
      if (hash(raw) !== revision)
        throw new AppError(
          409,
          "CONFLICT",
          "The note changed. Rescan before adopting it.",
        );
      const parsed = parseNote(raw);
      const id = randomUUID();
      const time = this.clock().toISOString();
      parsed.document.set("id", id);
      if (!parsed.data.created_at) parsed.document.set("created_at", time);
      parsed.document.set("updated_at", time);
      await this.atomic(file, serialize(parsed));
      await this.scan();
      return this.get(id, "task").entity as Task;
    });
  }
  async previewImport(items: ImportItem[]): Promise<ImportPreview[]> {
    await this.scan();
    const ids = new Set<string>();
    return items.map((item) => {
      try {
        const p = parseNote(item.raw);
        const task = taskFrom(
          p,
          item.name,
          hash(item.raw),
          this.clock().toISOString(),
        );
        if (
          task.id &&
          (this.records.has(task.id) ||
            ids.has(task.id) ||
            this.issues.some((d) => d.message.startsWith("Duplicate identity")))
        )
          throw new Error("This task identity already exists.");
        if (task.id) ids.add(task.id);
        return {
          name: item.name,
          title: task.title,
          valid: true,
          message: "Ready — task note",
        };
      } catch (e) {
        return {
          name: item.name,
          title: item.name,
          valid: false,
          message: (e as Error).message,
        };
      }
    });
  }
  async importNotes(items: ImportItem[]) {
    return this.exclusive(async () => {
      this.assertWritable();
      const preview = await this.previewImport(items);
      const imported: Task[] = [];
      for (let i = 0; i < items.length; i++) {
        if (!preview[i].valid) continue;
        const p = parseNote(items[i].raw);
        const id = typeof p.data.id === "string" ? p.data.id : randomUUID();
        const time = this.clock().toISOString();
        p.document.set("id", id);
        if (!p.data.created_at) p.document.set("created_at", time);
        p.document.set("updated_at", time);
        const rel = `Tasks/${slug(String(p.data.title))}--${id}.md`;
        const file = await this.safe(rel);
        try {
          await fs.access(file);
          throw new AppError(
            409,
            "PATH_EXISTS",
            "An imported file would overwrite an existing note.",
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await this.atomic(file, serialize(p));
        await this.scan();
        imported.push(this.get(id, "task").entity as Task);
      }
      return { imported, skipped: preview.filter((p) => !p.valid) };
    });
  }
  async exportNotes() {
    await this.scan();
    const files: Record<string, string> = {};
    for (const r of this.records.values())
      files[r.path] = await fs.readFile(await this.safe(r.path), "utf8");
    return files;
  }
}
export async function createVault(
  folder: string,
  options: { existingEmpty?: boolean } = {},
) {
  const root = path.resolve(folder);
  const parent = await fs.realpath(path.dirname(root));
  if (parent !== path.dirname(root))
    throw new AppError(
      400,
      "VAULT_PATH",
      "Choose a folder inside an ordinary directory.",
    );
  if (options.existingEmpty) {
    const existing = await fs.lstat(root).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (
        existing.isSymbolicLink() ||
        !existing.isDirectory() ||
        (await fs.readdir(root)).length
      )
        throw new AppError(
          400,
          "VAULT_NOT_EMPTY",
          "Initialize only an empty ordinary vault folder.",
        );
    } else await fs.mkdir(root, { recursive: false });
  } else await fs.mkdir(root, { recursive: false });
  for (const name of [
    "Tasks",
    "Projects",
    "Attachments",
    "Templates",
    ".obsidian",
  ])
    await fs.mkdir(path.join(root, name));
  await fs.writeFile(
    path.join(root, "Home.md"),
    "# Todo Vault\n\nThis vault owns your Todo data. Tasks are ordinary Markdown notes in `Tasks/`; project context lives in `Projects/`. Open this folder in Obsidian or let your local assistant read these notes.\n\n## Reading progress\n\nEach task has YAML properties: `status` (`inbox`, `todo`, `doing`, `done`), `scheduled` (the planned work day), `due` (the deadline), `completed_at`, `tags`, and a project wiki link. The Markdown body holds notes and checklists. Completed and trashed tasks remain here for history; ignore `trashed: true` when reviewing active work. Keep each note's UUID `id` unchanged.\n\n## Planning and reminders\n\nUnfinished scheduled tasks roll forward to today in the workspace timezone by default. `original_scheduled`, `rollover_count`, and `last_rolled_at` explain the moves; deadlines are preserved. Turn this off in Todo settings if you prefer manual planning. `reminder_at` is an ISO timestamp with a timezone; browser reminders need Todo or Mini Today open.\n\n## Repeating tasks\n\nUse `repeat: { frequency: daily, interval: 1 }` (also `weekly` or `monthly`). Completing an occurrence retains its history and creates one future task, skipping missed occurrences. Month-end dates clamp to the last day and recover their original day in longer months. `recurrence_source_id` and `next_occurrence_id` link the history.\n\nYou can edit Markdown and custom YAML properties in Obsidian. Todo preserves unrelated properties, comments, and note content. Avoid editing the same note simultaneously in both apps; Todo pauses a stale save so you can keep your draft.\n",
    { flag: "wx" },
  );
  await fs.writeFile(path.join(root, ".obsidian/app.json"), "{}\n", {
    flag: "wx",
  });
  await fs.writeFile(path.join(root, "Templates/Task.md"), taskTemplate, {
    flag: "wx",
  });
  await fs.writeFile(path.join(root, "Tasks.base"), taskBase, { flag: "wx" });
  return root;
}
