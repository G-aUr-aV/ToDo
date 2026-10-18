import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Vault, createVault } from "../core/vault";
import { parseNote, serialize, hash, freshNote } from "../core/notes";
import { AppError, dayInZone, inToday, validDate } from "../core/model";
async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "todo-test-"));
  const root = await createVault(path.join(dir, "Vault"));
  const vault = await new Vault(root, path.join(dir, "state")).start();
  t.after(async () => {
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, root, vault };
}
const create = (vault: Vault, extra = {}) =>
  vault.createTask({
    requestId: randomUUID(),
    title: "Read a chapter",
    ...extra,
  });
test("task lifecycle persists through engine restart and creates ordinary Markdown", async (t) => {
  const { root, vault, dir } = await fixture(t);
  const task = await create(vault);
  assert.equal(task.status, "inbox");
  assert.ok(task.path.startsWith("Tasks/"));
  const planned = await vault.updateTask(task.id, task.revision, {
    scheduled: "2026-10-16",
    due: "2026-10-18",
    status: "todo",
  });
  const completed = await vault.updateTask(task.id, planned.revision, {
    status: "done",
  });
  assert.ok(completed.completedAt);
  assert.equal(completed.previousStatus, "todo");
  const reopened = await vault.updateTask(task.id, completed.revision, {
    status: completed.previousStatus,
  });
  assert.equal(reopened.completedAt, null);
  const trashed = await vault.updateTask(task.id, reopened.revision, {
    trashed: true,
  });
  assert.equal(trashed.path, task.path);
  await vault.close();
  const second = await new Vault(root, path.join(dir, "state")).start();
  try {
    const loaded = (await second.snapshot()).tasks[0];
    assert.equal(loaded.trashed, true);
    assert.equal(loaded.due, "2026-10-18");
    assert.equal(loaded.scheduled, "2026-10-16");
  } finally {
    await second.close();
  }
});
test("retrying a create request does not duplicate a task", async (t) => {
  const { vault } = await fixture(t);
  const input = { requestId: randomUUID(), title: "One task" };
  const first = await vault.createTask(input);
  const retry = await vault.createTask(input);
  assert.equal(first.id, retry.id);
  assert.equal((await vault.snapshot()).tasks.length, 1);
});
test("unknown YAML properties, comments and untouched Markdown body survive a metadata edit", async (t) => {
  const { vault, root } = await fixture(t);
  const id = randomUUID();
  const raw = `---\nschema_version: 1\ntype: task\nid: ${id}\ntitle: Test\nstatus: todo\n# keep this comment\ncustom:\n  color: blue # also keep\nscheduled:\ndue:\n---\n\n## A custom heading\n\n- [ ] Original checklist\n\nLiteral <tag> and [[Other note]].\n`;
  await fs.writeFile(path.join(root, "Tasks/custom.md"), raw);
  const task = (await vault.snapshot()).tasks[0];
  await vault.updateTask(id, task.revision, { focus: true });
  const after = await fs.readFile(path.join(root, "Tasks/custom.md"), "utf8");
  assert.equal(parseNote(after).body, parseNote(raw).body);
  assert.deepEqual(parseNote(after).data.custom, { color: "blue" });
  assert.match(after, /# keep this comment/);
  assert.match(after, /# also keep/);
});
test("stale revisions reject writes and preserve the external version", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault, { notes: "Original" });
  const file = path.join(root, task.path);
  const external = (await fs.readFile(file, "utf8")).replace(
    "Original",
    "Changed in Obsidian",
  );
  await fs.writeFile(file, external);
  await assert.rejects(
    vault.updateTask(task.id, task.revision, { notes: "Unsaved app draft" }),
    (e: unknown) =>
      e instanceof AppError &&
      e.status === 409 &&
      e.current?.revision === hash(external),
  );
  assert.equal(await fs.readFile(file, "utf8"), external);
});
test("a stale restore also preserves the current note", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault, { notes: "Old" });
  const updated = await vault.updateTask(task.id, task.revision, {
    notes: "New",
  });
  const versions = await vault.versions(task.id);
  assert.equal(versions.length, 1);
  const file = path.join(root, updated.path);
  const external = (await fs.readFile(file, "utf8")).replace(
    "New",
    "External latest",
  );
  await fs.writeFile(file, external);
  await assert.rejects(
    vault.restore(task.id, updated.revision, versions[0].id),
    { code: "CONFLICT" },
  );
  assert.equal(await fs.readFile(file, "utf8"), external);
});
test("recovery restores previous properties and body while retaining a copy of the replaced version", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault, { notes: "Before" });
  const file = path.join(root, task.path);
  let p = parseNote(await fs.readFile(file, "utf8"));
  p.document.set("custom", "old");
  await fs.writeFile(file, serialize(p));
  const baseline = (await vault.snapshot()).tasks[0];
  const updated = await vault.updateTask(task.id, baseline.revision, {
    notes: "After",
    due: "2026-11-01",
  });
  p = parseNote(await fs.readFile(file, "utf8"));
  p.document.set("custom", "new");
  await fs.writeFile(file, serialize(p));
  const current = (await vault.snapshot()).tasks[0];
  const version = (await vault.versions(task.id))[0];
  const restored = await vault.restore(task.id, current.revision, version.id);
  assert.match(restored.notes, /Before/);
  assert.equal(restored.due, null);
  assert.equal(parseNote(await fs.readFile(file, "utf8")).data.custom, "old");
  assert.equal((await vault.versions(task.id)).length, 2);
});
test("external rename follows stable identity and title changes retain the note path", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault);
  await fs.rename(
    path.join(root, task.path),
    path.join(root, "Tasks/Renamed in Obsidian.md"),
  );
  const loaded = (await vault.snapshot()).tasks[0];
  assert.equal(loaded.id, task.id);
  const edited = await vault.updateTask(task.id, loaded.revision, {
    title: "Different title",
  });
  assert.equal(edited.path, "Tasks/Renamed in Obsidian.md");
});
test("duplicate IDs are reported and neither duplicate is writable", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault);
  await fs.copyFile(
    path.join(root, task.path),
    path.join(root, "Tasks/duplicate.md"),
  );
  const s = await vault.snapshot();
  assert.equal(s.tasks.length, 0);
  assert.equal(s.diagnostics.length, 2);
  await assert.rejects(
    vault.updateTask(task.id, task.revision, { title: "Do not write" }),
    { code: "NOTE_MISSING" },
  );
});
test("invalid dates and malformed YAML stay untouched", async (t) => {
  const { vault, root } = await fixture(t);
  const id = randomUUID();
  const invalid = freshNote({
    schema_version: 1,
    type: "task",
    id,
    title: "Invalid date",
    due: "2026-02-31",
  });
  await fs.writeFile(path.join(root, "Tasks/invalid.md"), invalid);
  const malformed = "---\ntype: task\ntitle: [broken\n---\nkeep";
  await fs.writeFile(path.join(root, "Tasks/malformed.md"), malformed);
  const s = await vault.snapshot();
  assert.equal(s.tasks.length, 0);
  assert.equal(s.diagnostics.length, 2);
  assert.equal(
    await fs.readFile(path.join(root, "Tasks/invalid.md"), "utf8"),
    invalid,
  );
  assert.equal(
    await fs.readFile(path.join(root, "Tasks/malformed.md"), "utf8"),
    malformed,
  );
});
test("symlink notes are skipped and the outside file is preserved", async (t) => {
  const { vault, root, dir } = await fixture(t);
  const outside = path.join(dir, "outside.md");
  await fs.writeFile(outside, "Outside data");
  await fs.symlink(outside, path.join(root, "Tasks/link.md"));
  const s = await vault.snapshot();
  assert.equal(s.tasks.length, 0);
  assert.match(s.diagnostics[0].message, /Symlink/);
  assert.equal(await fs.readFile(outside, "utf8"), "Outside data");
});
test("one app writer per vault, even with a different state directory", async (t) => {
  const { vault, root, dir } = await fixture(t);
  const other = new Vault(root, path.join(dir, "other-state"));
  await assert.rejects(other.start(), { code: "VAULT_BUSY" });
  assert.equal((await vault.snapshot()).tasks.length, 0);
});
test("manual adoption is explicit and revision checked", async (t) => {
  const { vault, root } = await fixture(t);
  const raw = freshNote(
    {
      schema_version: 1,
      type: "task",
      title: "A manual note",
      status: "inbox",
    },
    "[[Context]]",
  );
  await fs.writeFile(path.join(root, "Tasks/manual.md"), raw);
  const s = await vault.snapshot();
  assert.equal(s.tasks.length, 0);
  const candidate = s.diagnostics[0];
  assert.equal(candidate.adoptable, true);
  const task = await vault.adopt(candidate.id, candidate.revision);
  assert.match(task.id, /^[a-f0-9-]+$/);
  assert.equal(task.path, "Tasks/manual.md");
  assert.equal(
    parseNote(await fs.readFile(path.join(root, task.path), "utf8")).body,
    parseNote(raw).body,
  );
});
test("imports preview duplicates, skip invalid notes and preserve source properties", async (t) => {
  const { vault } = await fixture(t);
  const id = randomUUID();
  const good = freshNote(
    {
      schema_version: 1,
      type: "task",
      id,
      title: "Imported",
      status: "todo",
      custom: "kept",
    },
    "Body",
  );
  const items = [
    { name: "good.md", raw: good },
    { name: "duplicate.md", raw: good },
    { name: "bad.md", raw: "not a task note" },
  ];
  const preview = await vault.previewImport(items);
  assert.deepEqual(
    preview.map((i) => i.valid),
    [true, false, false],
  );
  const result = await vault.importNotes(items);
  assert.equal(result.imported.length, 1);
  assert.equal(result.skipped.length, 2);
  const exported = await vault.exportNotes();
  assert.equal(parseNote(Object.values(exported)[0]).data.custom, "kept");
});
test("archiving a project retains task links and date membership", async (t) => {
  const { vault } = await fixture(t);
  const project = await vault.createProject({
    requestId: randomUUID(),
    title: "Work",
  });
  const task = await create(vault, {
    projectId: project.id,
    scheduled: "2026-10-14",
  });
  await vault.updateProject(project.id, project.revision, { archived: true });
  const s = await vault.snapshot();
  assert.equal(s.tasks[0].projectId, project.id);
  assert.equal(s.projects[0].archived, true);
  assert.equal(inToday(s.tasks[0], s.today), true);
  assert.match(task.project!, /^\[\[Projects\//);
});
test("planning changes never implicitly change deadlines", async (t) => {
  const { vault } = await fixture(t);
  const task = await create(vault, {
    due: "2026-10-15",
    scheduled: "2026-10-14",
  });
  const updated = await vault.updateTask(task.id, task.revision, {
    scheduled: "2026-10-20",
  });
  assert.equal(updated.due, "2026-10-15");
  assert.equal(inToday(updated, "2026-10-15"), true);
});
test(
  "a read-only task rejects changes without replacing the note",
  {
    skip:
      process.platform === "win32" || process.getuid?.() === 0
        ? "Requires POSIX permissions with an unprivileged owner"
        : false,
  },
  async (t) => {
    const { vault, root } = await fixture(t);
    const task = await create(vault);
    const file = path.join(root, task.path);
    const original = await fs.readFile(file, "utf8");
    await fs.chmod(file, 0o400);
    try {
      await assert.rejects(
        vault.updateTask(task.id, task.revision, { title: "Changed" }),
        { code: "EACCES" },
      );
      assert.equal(await fs.readFile(file, "utf8"), original);
    } finally {
      await fs.chmod(file, 0o600);
    }
  },
);
test("date validation and timezone boundaries handle calendar dates without shifting them", () => {
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(
    dayInZone(new Date("2026-10-14T20:00:00Z"), "Asia/Kolkata"),
    "2026-10-15",
  );
  assert.equal(
    dayInZone(new Date("2026-10-14T20:00:00Z"), "America/Los_Angeles"),
    "2026-10-14",
  );
});
test(
  "a vault through a parent directory alias uses its canonical path",
  {
    skip:
      process.platform === "win32" ? "Requires POSIX symlink creation" : false,
  },
  async (t) => {
    const { vault, dir, root } = await fixture(t);
    await vault.close();
    const alias = path.join(dir, "parent-alias");
    await fs.symlink(dir, alias, "dir");
    const reopened = await new Vault(
      path.join(alias, "Vault"),
      path.join(dir, "alias-state"),
    ).start();
    try {
      assert.equal(reopened.root, await fs.realpath(root));
      const task = await create(reopened);
      assert.ok(await fs.readFile(path.join(root, task.path), "utf8"));
    } finally {
      await reopened.close();
    }
  },
);
test("UUID letter case cannot hide a duplicate note identity", async (t) => {
  const { vault, root } = await fixture(t);
  const task = await create(vault);
  const raw = await fs.readFile(path.join(root, task.path), "utf8");
  await fs.writeFile(
    path.join(root, "Tasks", "case-duplicate.md"),
    raw.replace(task.id, task.id.toUpperCase()),
  );
  const snapshot = await vault.snapshot();
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(
    snapshot.diagnostics.filter((d) =>
      d.message.startsWith("Duplicate identity"),
    ).length,
    2,
  );
});
