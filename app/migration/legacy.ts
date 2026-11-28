import { isDeepStrictEqual } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { defaultPreferences, preferenceSchema, uuid, type Diagnostic } from "../core/model";
import { hash, MAX_NOTE_BYTES, parseNote } from "../core/notes";
import { legacyNote, readNote, writeNote, type StoredNote, type StoredProject } from "../core/sqlite-schema";
import { readJson, type Entry } from "./files";

type Issue = { path: string; message: string };
type VersionRow = { noteId: string; id: string; savedAt: string; raw: string; path: string };
type Resolutions = { archive: Set<string>; projects: Map<string, string | null> };

export async function readResolutions(file?: string): Promise<Resolutions> {
  const archives = new Set<string>();
  const projects = new Map<string, string | null>();
  if (!file) return { archive: archives, projects };
  const data = await readJson(file);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Resolution file must contain an object.");
  const { archive, projects: links, ...other } = data as Record<string, unknown>;
  if (Object.keys(other).length || (archive !== undefined && !Array.isArray(archive)) ||
    (links !== undefined && (!links || typeof links !== "object" || Array.isArray(links)))) {
    throw new Error("Use archive paths and project mappings in the resolution file.");
  }
  for (const value of (archive as unknown[] | undefined) ?? []) {
    if (typeof value !== "string" || !/^(vault\/|state\/versions\/)/.test(value) || archives.has(value)) {
      throw new Error("Each archive resolution needs a unique path from the migration report.");
    }
    archives.add(value);
  }
  for (const [relative, id] of Object.entries(links ?? {})) {
    if (id !== null && !uuid.safeParse(id).success) throw new Error(`Project resolution for ${relative} must be a UUID or null.`);
    projects.set(relative, id === null ? null : uuid.parse(id));
  }
  return { archive: archives, projects };
}

function noteKind(relative: string): StoredNote["kind"] | undefined {
  const parts = relative.split("/");
  if (parts.some((part) => part.startsWith("."))) return;
  if (parts[0] === "Tasks") return "task";
  if (parts[0] === "Projects") return "project";
}

async function readNoteFile(root: string, entry: Entry) {
  const file = path.join(root, entry.path);
  if ((await fs.stat(file)).size > MAX_NOTE_BYTES) throw new Error("This note is too large to import.");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await fs.readFile(file));
}

function projectMatches(projects: StoredProject[], link: string) {
  const target = link.replace(/^\[\[|\]\]$/g, "").split("|")[0].replace(/\.md$/, "");
  return projects.filter(({ entity }) =>
    entity.path.replace(/\.md$/, "") === target || entity.title === target || "Projects/" + entity.title === target,
  );
}

export async function scanLegacy(
  vault: string, state: string, vaultEntries: Entry[], stateEntries: Entry[], resolutions: Resolutions,
) {
  const notes: StoredNote[] = [];
  const versions: VersionRow[] = [];
  const archived: Issue[] = [];
  const unresolved: Issue[] = [];
  const diagnostics: Diagnostic[] = [];
  const usedArchive = new Set<string>();
  const usedProjects = new Set<string>();
  const resolved: Issue[] = [];
  function archiveEntry(relative: string) {
    if (!resolutions.archive.has(relative)) return false;
    usedArchive.add(relative);
    archived.push({ path: relative, message: "Archive only by explicit resolution." });
    return true;
  }
  for (const entry of vaultEntries) {
    const relative = "vault/" + entry.path;
    if (entry.type === "directory" || archiveEntry(relative)) continue;
    const kind = noteKind(entry.path);
    if (entry.path === "Tasks" || entry.path === "Projects") {
      unresolved.push({ path: relative, message: "Expected a directory at this indexed path. Resolve as archive-only or correct the snapshot layout." });
    } else if (kind && entry.type === "symlink") {
      unresolved.push({ path: relative, message: "Symlink inside an indexed folder. Resolve as archive-only or supply an ordinary note." });
    } else if (!kind || !entry.path.toLowerCase().endsWith(".md")) {
      archived.push({ path: relative, message: "Source-only file, attachment or generated note." });
    } else {
      try {
        const raw = await readNoteFile(vault, entry);
        const note = legacyNote(kind, entry.path, raw, entry.mtime!);
        if (!note.entity.id) throw new Error("The note has no stable UUID.");
        notes.push(note);
      } catch (error) {
        unresolved.push({ path: relative, message: (error as Error).message });
      }
    }
  }

  const byId = new Map<string, StoredNote[]>();
  for (const note of notes) {
    const group = byId.get(note.entity.id) ?? [];
    group.push(note);
    byId.set(note.entity.id, group);
  }
  const unique = notes.filter((note) => {
    if (byId.get(note.entity.id)!.length === 1) return true;
    unresolved.push({ path: "vault/" + note.entity.path, message: `Duplicate UUID ${note.entity.id}. Explicitly archive the extra copies or resolve the identities in a snapshot.` });
    return false;
  });
  const projects = unique.filter((note): note is StoredProject => note.kind === "project");
  const projectIds = new Set(projects.map(({ entity }) => entity.id));
  const taskIds = new Set(unique.filter((note) => note.kind === "task").map(({ entity }) => entity.id));
  const versionIds = new Set<string>();
  for (const note of unique) {
    if (note.kind !== "task") continue;
    if (resolutions.projects.has(note.entity.path)) {
      usedProjects.add(note.entity.path);
      const id = resolutions.projects.get(note.entity.path)!;
      if (id && !projectIds.has(id)) {
        unresolved.push({ path: "vault/" + note.entity.path, message: `Project resolution ${id} does not identify an imported project.` });
      } else {
        note.entity.projectId = id;
        resolved.push({ path: "vault/" + note.entity.path, message: id ? `Linked to project ${id} by explicit resolution.` : "Project association removed by explicit resolution; source link preserved." });
      }
    } else if (note.entity.project) {
      const matches = projectMatches(projects, note.entity.project);
      if (matches.length === 1) note.entity.projectId = matches[0].entity.id;
      else unresolved.push({ path: "vault/" + note.entity.path, message: matches.length
        ? `Ambiguous project link ${note.entity.project}. Matches ${matches.map(({ entity }) => entity.id).join(", ")}.`
        : `Project link ${note.entity.project} has no matching project.` });
    }
    for (const id of [note.entity.nextOccurrenceId, note.entity.recurrenceSourceId]) {
      if (id && !taskIds.has(id)) diagnostics.push({
        id: hash(note.entity.path + id), path: note.entity.path,
        message: `Preserved recurrence link to a task with no current note (${id}).`,
        revision: note.entity.revision, adoptable: false,
      });
    }
  }

  let preferences = defaultPreferences;
  if (stateEntries.some((entry) => entry.path === "preferences.json")) {
    try {
      preferences = preferenceSchema.strip().parse(await readJson(path.join(state, "preferences.json")));
    } catch {
      unresolved.push({ path: "state/preferences.json", message: "Invalid workspace preferences. Provide corrected preferences in the legacy snapshot." });
    }
  }
  for (const entry of stateEntries) {
    const relative = "state/" + entry.path;
    if (entry.type === "directory" || archiveEntry(relative)) continue;
    if (entry.path === "preferences.json") continue;
    const match = /^versions\/([^/]+)\/([\w-]+)\.md$/.exec(entry.path);
    if (!match) {
      archived.push({ path: relative, message: "Private state or source-only recovery file." });
      continue;
    }
    try {
      const noteId = uuid.parse(match[1]);
      const raw = await readNoteFile(state, entry);
      const kind = parseNote(raw).data.type;
      if (kind !== "task" && kind !== "project") throw new Error("Unknown recovery note type.");
      const version = legacyNote(kind, entry.path, raw, entry.mtime!);
      if (version.entity.id !== noteId) throw new Error("Recovery version belongs to a different note.");
      const id = match[2];
      const key = noteId + "/" + id;
      if (versionIds.has(key)) throw new Error("Duplicate recovery version.");
      const current = byId.get(noteId)?.[0];
      if (current && current.kind !== kind) throw new Error("Recovery type differs from the current note.");
      versionIds.add(key);
      versions.push({ noteId, id, savedAt: entry.mtime!, raw, path: relative });
    } catch {
      unresolved.push({ path: relative, message: "Invalid recovery version. Review the file or explicitly archive it." });
    }
  }
  for (const relative of resolutions.archive) {
    if (!usedArchive.has(relative)) unresolved.push({ path: relative, message: "Archive resolution matches no eligible source file." });
  }
  for (const relative of resolutions.projects.keys()) {
    if (!usedProjects.has(relative)) unresolved.push({ path: relative, message: "Project resolution matches no imported task." });
  }
  const tasks = unique.filter((note) => note.kind === "task");
  return {
    notes: [...projects, ...tasks], versions, preferences, diagnostics,
    report: {
      counts: {
        tasks: tasks.length, projects: projects.length, versions: versions.length,
        archivedProjects: projects.filter(({ entity }) => entity.archived).length,
        statuses: Object.fromEntries(["inbox", "todo", "doing", "done", "trash"].map((status) => [
          status, tasks.filter(({ entity }) => status === "trash" ? entity.trashed : !entity.trashed && entity.status === status).length,
        ])),
        archived: archived.length, unresolved: unresolved.length,
      },
      imported: [
        ...unique.map(({ entity }) => ({ path: "vault/" + entity.path, id: entity.id, revision: entity.revision })),
        ...versions.map((version) => ({ path: version.path, id: version.id })),
      ],
      archived, unresolved, resolved, diagnostics,
    },
  };
}

export function importLegacy(db: DatabaseSync, result: Awaited<ReturnType<typeof scanLegacy>>, vaultKey: string, vaultName: string) {
  if (result.report.unresolved.length) throw new Error("Resolve every blocking migration item before importing.");
  const settings = {
    preferences: JSON.stringify(result.preferences), vaultKey, vaultName,
    legacyMigration: JSON.stringify({ completedAt: new Date().toISOString(), counts: result.report.counts }),
    migrationDiagnostics: JSON.stringify(result.diagnostics),
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const note of result.notes) writeNote(db, note);
    const insert = db.prepare("INSERT INTO versions (note_id, id, saved_at, legacy_raw) VALUES (?, ?, ?, ?)");
    for (const row of result.versions) insert.run(row.noteId, row.id, row.savedAt, row.raw);
    const setting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(settings)) setting.run(key, value);

    const actual = db.prepare("SELECT * FROM notes").all();
    const notes = new Map(result.notes.map((note) => [note.entity.id, note]));
    if (actual.length !== notes.size || actual.some((row) => !isDeepStrictEqual(readNote(row), notes.get(row.id as string)))) {
      throw new Error("Imported notes differ from the source.");
    }
    const versions = new Map(result.versions.map(({ path: _path, ...row }) => [row.noteId + "/" + row.id, row]));
    const actualVersions = db.prepare("SELECT * FROM versions").all();
    if (actualVersions.length !== versions.size || actualVersions.some((row) => !isDeepStrictEqual({
      noteId: row.note_id, id: row.id, savedAt: row.saved_at, raw: row.legacy_raw,
    }, versions.get(row.note_id + "/" + row.id)))) throw new Error("Imported recovery versions differ from the source.");
    const actualSettings = db.prepare("SELECT key,value FROM settings").all();
    if (actualSettings.length !== Object.keys(settings).length ||
      actualSettings.some((row) => settings[row.key as keyof typeof settings] !== row.value)) throw new Error("Imported settings differ from the source.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
