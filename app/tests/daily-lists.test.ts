import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Vault, createVault } from "../core/vault";
import { parseNote, serialize } from "../core/notes";

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-days-"));
  const root = await createVault(path.join(dir, "Vault"));
  let now = new Date("2026-10-18T18:20:00Z"); // 23:50 IST
  let vault = await new Vault(root, path.join(dir, "state"), () => now).start();
  t.after(async () => {
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    root,
    get vault() {
      return vault;
    },
    advance: (instant: string) => (now = new Date(instant)),
    read: (day: string) =>
      fs.readFile(path.join(root, "Days", day + ".md"), "utf8"),
    async restart() {
      await vault.close();
      vault = await new Vault(root, path.join(dir, "state"), () => now).start();
    },
  };
}
const create = (vault: Vault, title: string, extra = {}) =>
  vault.createTask({ requestId: randomUUID(), title, ...extra });

test("day lists link to canonical notes, strike completed tasks and separate undated tasks", async (t) => {
  const f = await fixture(t);
  const open = await create(f.vault, "Write plan", { scheduled: "2026-10-18" });
  const done = await create(f.vault, "Review plan", {
    scheduled: "2026-10-22",
  });
  const completed = await f.vault.updateTask(done.id, done.revision, {
    status: "done",
  });
  const undated = await create(f.vault, "Unplanned idea");
  const due = await create(f.vault, "Pay invoice", { due: "2026-10-20" });
  const page = await f.read("2026-10-18");
  assert.ok(page.includes(`- [Write plan](../${open.path})`));
  assert.ok(page.includes(`- ~~[Review plan](../${completed.path})~~`));
  assert.ok(!(await f.read("2026-10-22")).includes(done.path));
  assert.ok((await f.read("Unscheduled")).includes(undated.path));
  assert.ok((await f.read("2026-10-20")).includes(due.path));
  const index = await f.read("README");
  assert.match(index, /\[2026-10-18\]\(2026-10-18.md\).*1 open, 1 completed/);
  assert.match(
    await fs.readFile(path.join(f.root, "Home.md"), "utf8"),
    /Days\/README/,
  );
  // Reading summaries must not introduce synthetic task notes into the app.
  assert.equal((await f.vault.snapshot()).tasks.length, 4);
});

test("rollover and rescheduling remove old links while retaining completed work and deadlines", async (t) => {
  const f = await fixture(t);
  const carried = await create(f.vault, "Carry me", {
    scheduled: "2026-10-18",
    due: "2026-10-18",
  });
  const done = await create(f.vault, "Finished yesterday", {
    scheduled: "2026-10-18",
    status: "done",
  });
  f.advance("2026-10-18T18:40:00Z"); // 00:10 IST on the 19th, still the 18th in UTC
  const snapshot = await f.vault.snapshot();
  const moved = snapshot.tasks.find((task) => task.id === carried.id)!;
  assert.equal(snapshot.today, "2026-10-19");
  assert.equal(moved.scheduled, "2026-10-19");
  assert.equal(moved.due, "2026-10-18");
  assert.equal(moved.originalScheduled, "2026-10-18");
  assert.ok(!(await f.read("2026-10-18")).includes(carried.path));
  assert.ok((await f.read("2026-10-18")).includes(`~~[${done.title}]`));
  assert.ok((await f.read("2026-10-19")).includes(carried.path));
  await f.vault.updateTask(moved.id, moved.revision, {
    scheduled: "2026-10-21",
  });
  assert.ok(!(await f.read("2026-10-19")).includes(carried.path));
  assert.ok((await f.read("2026-10-21")).includes(carried.path));
});

test("completion, Undo, Trash, recurring successors and restart rebuild the correct day lists", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, "Daily reading", {
    scheduled: "2026-10-18",
    repeat: { frequency: "daily", interval: 1 },
  });
  const completed = await f.vault.updateTask(task.id, task.revision, {
    status: "done",
  });
  let tasks = (await f.vault.snapshot()).tasks;
  const next = tasks.find((value) => value.recurrenceSourceId === task.id)!;
  assert.ok((await f.read("2026-10-18")).includes(`~~[Daily reading]`));
  assert.ok((await f.read("2026-10-19")).includes(next.path));
  const undone = await f.vault.restore(
    task.id,
    completed.revision,
    completed.undoVersion!,
  );
  assert.ok((await f.read("2026-10-18")).includes("- [Daily reading]"));
  assert.ok(!(await f.read("2026-10-19")).includes(next.path));
  await f.vault.updateTask(task.id, undone.revision, { trashed: true });
  assert.ok(!(await f.read("2026-10-18")).includes(task.path));
  await fs.unlink(path.join(f.root, "Days/2026-10-18.md"));
  await f.restart();
  assert.match(await f.read("2026-10-18"), /No tasks for this day/);
  tasks = (await f.vault.snapshot()).tasks;
  const trashed = tasks.find((value) => value.id === task.id)!;
  await f.vault.updateTask(task.id, trashed.revision, { trashed: false });
  assert.ok((await f.read("2026-10-18")).includes(task.path));
});

test("external edits and renames refresh links, escape Markdown and preserve task content", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, "Original", { scheduled: "2026-10-18" });
  const target = "Tasks/Renamed [task] (日本語)#1.md";
  await fs.rename(path.join(f.root, task.path), path.join(f.root, target));
  const parsed = parseNote(
    await fs.readFile(path.join(f.root, target), "utf8"),
  );
  parsed.document.set("title", "A [link] ~~strike~~ <tag>\nsecond line");
  parsed.document.set("scheduled", "2026-10-20");
  const raw = serialize(parsed);
  await fs.writeFile(path.join(f.root, target), raw);
  await f.vault.snapshot();
  const day = await f.read("2026-10-20");
  assert.ok(
    day.includes("A \\[link\\] \\~\\~strike\\~\\~ \\<tag\\> second line"),
  );
  assert.ok(
    day.includes(
      "../Tasks/Renamed%20%5Btask%5D%20%28%E6%97%A5%E6%9C%AC%E8%AA%9E%29%231.md",
    ),
  );
  assert.ok(!(await f.read("2026-10-18")).includes(task.path));
  assert.equal(await fs.readFile(path.join(f.root, target), "utf8"), raw);
  const before = await fs.stat(path.join(f.root, "Days/2026-10-20.md"));
  await f.vault.snapshot();
  const after = await fs.stat(path.join(f.root, "Days/2026-10-20.md"));
  assert.equal(before.mtimeMs, after.mtimeMs);
});

test("timezone changes regroup completion dates, and invalid notes never produce a false all-clear", async (t) => {
  const f = await fixture(t);
  f.advance("2026-10-18T19:00:00Z");
  const task = await create(f.vault, "Late finish", { status: "done" });
  assert.ok((await f.read("2026-10-19")).includes(task.path));
  const { preferences } = await f.vault.snapshot();
  await f.vault.setPreferences({ ...preferences, timezone: "UTC" });
  assert.ok((await f.read("2026-10-18")).includes(task.path));
  assert.ok(!(await f.read("2026-10-19")).includes(task.path));
  await fs.writeFile(
    path.join(f.root, "Tasks/broken.md"),
    "---\ntype: task\nstatus: broken\n---\n",
  );
  await f.vault.snapshot();
  assert.match(await f.read("2026-10-18"), /list may be incomplete/);
  assert.match(await f.read("README"), /Tasks\/broken.md/);
});

test("generated lists cannot overwrite personal notes or follow symlinks", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "Days/2026-10-20.md");
  await fs.writeFile(file, "My personal day note\n");
  await create(f.vault, "Blocked day", { scheduled: "2026-10-20" });
  assert.equal(await fs.readFile(file, "utf8"), "My personal day note\n");
  let snapshot = await f.vault.snapshot();
  assert.ok(snapshot.diagnostics.some((d) => d.path === "Days/2026-10-20.md"));
  const outside = path.join(f.root, "outside.md");
  await fs.writeFile(outside, "Do not touch\n");
  await fs.symlink(outside, path.join(f.root, "Days/2026-10-21.md"));
  await create(f.vault, "Symlink day", { scheduled: "2026-10-21" });
  assert.equal(await fs.readFile(outside, "utf8"), "Do not touch\n");
  snapshot = await f.vault.snapshot();
  assert.ok(snapshot.diagnostics.some((d) => d.path === "Days/2026-10-21.md"));
});

test("a lost vault writer lock also prevents generated list writes", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "Days/2026-10-18.md");
  const raw = (await f.read("2026-10-18")) + "A concurrent writer's version\n";
  await fs.writeFile(file, raw);
  (f.vault as unknown as { compromised: boolean }).compromised = true;
  await f.vault.scan();
  assert.equal(await fs.readFile(file, "utf8"), raw);
});
