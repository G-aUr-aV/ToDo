import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { defaultPreferences } from "../core/model";
import { freshNote, hash } from "../core/notes";
import { SqliteWorkspace } from "../core/sqlite-workspace";
import { acquire, databaseFile, exists, legacyLock, restorePending, storageLock } from "../migration/files";
import { backupStorage, migrate, restoreStorage } from "../migration/storage";
import { Auth } from "../server/auth";
import { openWorkspace } from "../server/runtime";

const projectId = "c0bd49a4-58d6-4f85-b7bb-664d730c9026";
const otherProjectId = "2ae44386-4a01-441c-9775-9e279191442b";
const taskId = "edf6599f-480e-47fd-88cd-51d2a5dfd082";
const successorId = "b7f636f3-216f-4625-9b10-ecbbac23b025";
const trashId = "69de6194-9216-4a20-b837-7970e3ae4604";
const versionId = "2025-01-05T14-00-00-123Z--legacy";
const fixed = new Date("2025-01-05T14:00:00.123Z");
const versionDate = new Date("2025-01-05T14:12:00.432Z");
const note = (type: "project" | "task", id: string, title: string, data: Record<string, unknown> = {}, body = "") =>
  freshNote({ schema_version: 1, type, id, title, ...data }, body);

async function fixture(t: test.TestContext) {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-migration-"));
  const vault = path.join(parent, "Original Vault");
  const state = path.join(parent, "private state");
  await fs.mkdir(path.join(vault, "Tasks"), { recursive: true });
  await fs.mkdir(path.join(vault, "Projects"));
  await fs.mkdir(state);
  t.after(() => fs.rm(parent, { force: true, recursive: true }));
  return { parent, vault, state };
}

async function put(folder: string, relative: string, raw: string, modified = fixed) {
  const file = path.join(folder, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, raw);
  await fs.utimes(file, modified, modified);
  return file;
}

test("empty rehearsal is read-only and empty cutover is valid", async (t) => {
  const { parent, vault, state } = await fixture(t);
  const report = await migrate({ vault, state, dryRun: true });
  assert.deepEqual(report.counts.statuses, { inbox: 0, todo: 0, doing: 0, done: 0, trash: 0 });
  assert.equal(report.key, hash(vault).slice(0, 16));
  assert.deepEqual(await fs.readdir(state), []);
  assert.deepEqual((await fs.readdir(vault)).sort(), ["Projects", "Tasks"]);
  const archive = path.join(parent, "first archive");
  const actual = await migrate({ vault, state, archive, dryRun: false });
  assert.equal(actual.published, true);
  assert.equal((await fs.readdir(vault)).includes(legacyLock), false);
  assert.equal(await exists(path.join(state, databaseFile)), true);
  await assert.rejects(migrate({ vault, state, archive: path.join(parent, "another archive"), dryRun: false }), /Existing database/);
});

test("populated cutover, backup and both restore modes retain records and account access", async (t) => {
  const { parent, vault, state } = await fixture(t);
  await put(vault, "Projects/alpha.md", note("project", projectId, "Shared name", { archived: true }));
  const secondProject = note("project", otherProjectId, "Shared name");
  await put(vault, "Projects/beta.md", secondProject);
  const raw = note("task", taskId, "Repeat me", {
    status: "done", completed_at: "2025-01-04T10:43:00+05:30",
    scheduled: "2025-01-02", due: "2025-01-04", project: "[[Projects/beta|Shared name]]",
    repeat: { frequency: "daily", interval: 2 }, next_occurrence_id: successorId, next_occurrence_created: true,
    reminder_at: "2025-01-03T10:30:00+05:30", tags: ["home", "later"],
  }, "- [x] Keep this check");
  const file = await put(vault, "Tasks/deep/name.md", raw);
  await put(vault, "Tasks/successor.md", note("task", successorId, "Repeat me", { recurrence_source_id: taskId }));
  await put(vault, "Tasks/trashed.md", note("task", trashId, "Trashed", { trashed: true, status: "done" }));
  await put(vault, "Days/2025-01-02.md", "original generated file");
  await put(vault, "Attachments/example.bin", "original attachment");
  await put(vault, ".obsidian/metadata", "private legacy editor metadata");
  if (process.platform !== "win32") await fs.symlink("Attachments/example.bin", path.join(vault, "attachment-link"));
  const earlier = note("task", taskId, "Earlier title", { project: "[[Projects/beta]]" }, "Earlier notes");
  const version = await put(state, `versions/${taskId}/${versionId}.md`, earlier, versionDate);
  await put(state, `versions/${otherProjectId}/project-edit.md`, secondProject);
  const prefs = { ...defaultPreferences, autoRollover: false, timezone: "America/Denver" };
  await put(state, "preferences.json", JSON.stringify(prefs));
  const auth = new Auth(state);
  const loginFile = (await auth.initialize())!;
  const password = (await fs.readFile(loginFile, "utf8")).split("Password: ")[1].split("\n")[0];
  const session = await auth.login("owner", password);
  const { token, info } = await auth.createToken("Migration fixture");
  await auth.flush();

  const report = await migrate({ vault, state, archive: path.join(parent, "cutover"), dryRun: false });
  assert.equal(report.published, true);
  assert.deepEqual(report.counts.statuses, { inbox: 1, todo: 0, doing: 0, done: 1, trash: 1 });
  assert.equal(report.counts.versions, 2);
  assert.equal(report.counts.archivedProjects, 1);
  assert.equal(await fs.readFile(file, "utf8"), raw);
  assert.equal(await fs.readFile(path.join(report.archive!, "vault", "Attachments", "example.bin"), "utf8"), "original attachment");
  assert.equal(await fs.readFile(path.join(report.archive!, "state", "versions", taskId, versionId + ".md"), "utf8"), earlier);
  if (process.platform !== "win32") assert.equal(await fs.readlink(path.join(report.archive!, "vault", "attachment-link")), "Attachments/example.bin");
  const handle = await openWorkspace(vault, state);
  const workspace = handle.workspace;
  try {
    const snapshot = await workspace.snapshot();
    assert.equal(snapshot.vaultKey, hash(vault).slice(0, 16));
    assert.equal(snapshot.vaultName, "Original Vault");
    assert.deepEqual(snapshot.preferences, prefs);
    assert.equal(snapshot.projects.length, 2, "duplicate project names preserve both identities");
    const task = snapshot.tasks.find(({ id }) => id === taskId)!;
    assert.equal(task.createdAt, (await fs.stat(file)).mtime.toISOString());
    assert.equal(task.completedAt, "2025-01-04T10:43:00+05:30");
    assert.equal(task.revision, hash(raw));
    assert.equal(task.path, "Tasks/deep/name.md");
    assert.equal(task.projectId, otherProjectId);
    assert.equal(task.nextOccurrenceId, successorId);
    assert.match(task.notes, /\[x\] Keep this check/);
    assert.deepEqual(await workspace.versions(taskId), [{
      id: versionId, savedAt: (await fs.stat(version)).mtime.toISOString(), title: "Earlier title", notes: "\nEarlier notes\n",
    }]);
    const restored = await workspace.restore(taskId, task.revision, versionId);
    assert.equal(restored.title, "Earlier title");
    assert.equal(restored.projectId, otherProjectId);
    assert.ok(restored.undoVersion);
    await assert.rejects(backupStorage({ state, archive: path.join(parent, "while-running") }), /active Todo writer/);
    await workspace.backupTo(path.join(parent, "browser-download.sqlite"));
  } finally {
    await handle.close();
  }

  const archive = path.join(parent, "sqlite-full");
  await backupStorage({ state, archive });
  const target = path.join(parent, "restored");
  await fs.mkdir(target);
  const restore = await restoreStorage({ state: target, archive });
  assert.equal(restore.restoredOwner, true);
  const reopened = new SqliteWorkspace(restore.database);
  try {
    assert.equal((await reopened.snapshot()).tasks.find((task) => task.id === taskId)?.title, "Earlier title");
    assert.equal((await reopened.versions(taskId)).length, 2);
  } finally {
    reopened.close();
  }
  for (const [folder, withAuth] of [["restored", true], ["database-only", false], ["database-with-auth", true]] as const) {
    const destination = path.join(parent, folder);
    if (folder !== "restored") {
      const restored = await restoreStorage({ state: destination, database: path.join(parent, "browser-download.sqlite"), authState: withAuth ? state : undefined });
      assert.equal(restored.restoredOwner, withAuth);
    }
    const auth = new Auth(destination);
    if (!withAuth) {
      assert.equal(await exists(path.join(destination, "owner.json")), false);
      assert.ok(await auth.initialize());
      continue;
    }
    await auth.load();
    assert.equal(auth.session(session.id)?.csrf, session.csrf);
    assert.equal(auth.verifyToken("Bearer " + token)?.id, info.id);
    await auth.flush();
  }
  await assert.rejects(restoreStorage({ state: target, archive }), /Existing data was kept/);
  await fs.appendFile(path.join(archive, "state", "tokens.json"), "tampering");
  const tamperedTarget = path.join(parent, "tampered target");
  await assert.rejects(restoreStorage({ state: tamperedTarget, archive }), /Archive contents do not match/);
  assert.deepEqual(await fs.readdir(tamperedTarget), []);
});

test("ambiguous and invalid notes abort publication and can be explicitly resolved before retry", async (t) => {
  const { parent, vault, state } = await fixture(t);
  await put(vault, "Projects/alpha.md", note("project", projectId, "Same"));
  await put(vault, "Projects/beta.md", note("project", otherProjectId, "Same"));
  const raw = note("task", taskId, "Task", { project: "[[Same]]" });
  await put(vault, "Tasks/real.md", raw);
  await put(vault, "Tasks/duplicate.md", raw);
  await put(vault, "Tasks/plain.md", "handwritten content");
  await put(vault, "Tasks/with-missing-project.md", note("task", trashId, "Missing", { project: "[[Missing]]" }));
  if (process.platform !== "win32") await fs.symlink("real.md", path.join(vault, "Tasks", "symlink.md"));
  const writer = await acquire(vault, legacyLock);
  try {
    await assert.rejects(migrate({ vault, state, archive: path.join(parent, "occupied"), dryRun: false }), /active Todo writer/);
  } finally {
    await writer.release();
  }
  const blocked = await migrate({ vault, state, archive: path.join(parent, "issues"), dryRun: false });
  assert.equal(blocked.published, false);
  assert.equal(blocked.counts.unresolved, process.platform === "win32" ? 4 : 5);
  assert.equal(await exists(path.join(state, databaseFile)), false);
  assert.equal(await fs.readFile(path.join(blocked.archive!, "vault", "Tasks", "plain.md"), "utf8"), "handwritten content");

  const resolutions = path.join(parent, "choices.json");
  const archive = ["vault/Tasks/duplicate.md", "vault/Tasks/plain.md"];
  if (process.platform !== "win32") archive.push("vault/Tasks/symlink.md");
  await fs.writeFile(resolutions, JSON.stringify({
    archive, projects: { "Tasks/real.md": projectId, "Tasks/with-missing-project.md": null },
  }));
  const interrupted = await fs.mkdtemp(path.join(state, ".todo-import-"));
  await fs.writeFile(path.join(interrupted, databaseFile), "interrupted attempt");
  const dryRun = await migrate({ vault, state, resolutions, dryRun: true });
  assert.equal(dryRun.counts.unresolved, 0);
  assert.equal(dryRun.resolved.length, 2);
  const done = await migrate({ vault, state, archive: path.join(parent, "rehearsal"), resolutions, dryRun: false });
  assert.equal(done.published, true);
  const db = new DatabaseSync(path.join(state, databaseFile), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT project_id FROM notes WHERE id = ?").get(taskId)?.project_id, projectId);
    assert.equal(db.prepare("SELECT project_id FROM notes WHERE id = ?").get(trashId)?.project_id, null);
    assert.equal(db.prepare("SELECT count(*) AS total FROM notes").get()?.total, 4);
  } finally {
    db.close();
  }
  assert.equal(await fs.readFile(path.join(interrupted, databaseFile), "utf8"), "interrupted attempt");

  const empty = path.join(parent, "pending");
  await fs.mkdir(path.join(empty, restorePending), { recursive: true });
  await assert.rejects(openWorkspace(path.join(parent, "absent-vault"), empty), /restore is pending/);
  assert.equal(await exists(path.join(empty, storageLock)), false);
});
