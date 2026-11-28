import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SqliteWorkspace } from "../core/sqlite-workspace";
import { dayInZone } from "../core/dates";
import { inNow } from "../core/task-views";
import {
  defaultPreferences,
  taskPatchSchema,
  validTimestamp,
  validDate,
} from "../core/model";
import { nextOccurrence, shiftReminder } from "../core/recurrence";

async function fixture(t: test.TestContext, initial = "2026-10-15T10:00:00Z") {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-lifecycle-"));
  const database = path.join(dir, "todo.sqlite");
  let now = new Date(initial);
  let vault = new SqliteWorkspace(database, () => now).start();
  t.after(async () => {
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    get vault() {
      return vault;
    },
    tick(value: string) {
      now = new Date(value);
    },
    async restart() {
      await vault.close();
      vault = new SqliteWorkspace(database, () => now).start();
      return vault;
    },
  };
}
const create = (vault: SqliteWorkspace, extra: Record<string, unknown> = {}) =>
  vault.createTask({
    requestId: randomUUID(),
    title: "Read chapter",
    ...extra,
  });

test("rollover ignores completed, trashed, unscheduled and future tasks", async (t) => {
  const f = await fixture(t);
  await create(f.vault, { scheduled: "2026-10-01", status: "done" });
  await create(f.vault, { scheduled: "2026-10-01", trashed: true });
  await create(f.vault, { due: "2026-10-01" });
  await create(f.vault, { scheduled: "2026-10-20" });
  const tasks = (await f.vault.snapshot()).tasks;
  assert.equal(
    tasks.filter((task) => task.scheduled === "2026-10-01").length,
    2,
  );
  assert.equal(
    tasks.find((task) => task.scheduled === null)?.due,
    "2026-10-01",
  );
  assert.ok(tasks.every((task) => task.rolloverCount === 0));
});

test("rollover uses workspace midnight, not UTC, and preference can disable it", async (t) => {
  const f = await fixture(t, "2026-10-14T18:29:59Z");
  const task = await create(f.vault, { scheduled: "2026-10-14" });
  assert.equal((await f.vault.snapshot()).tasks[0].revision, task.revision);
  f.tick("2026-10-14T18:30:00Z");
  assert.equal((await f.vault.snapshot()).tasks[0].scheduled, "2026-10-15");
  await f.vault.setPreferences({ ...defaultPreferences, autoRollover: false });
  f.tick("2026-11-01T00:00:00Z");
  await f.restart();
  assert.equal((await f.vault.snapshot()).tasks[0].scheduled, "2026-10-15");
});

test("reminders on future tasks persist across SQLite restart", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-11-01",
    reminder: "2026-10-15T16:00:00+05:30",
  });
  await f.restart();
  const snapshot = await f.vault.snapshot();
  assert.equal(snapshot.tasks[0].reminder, "2026-10-15T16:00:00+05:30");
  const dismissed = await f.vault.updateTask(task.id, task.revision, {
    reminder: null,
  });
  assert.equal(dismissed.reminder, null);
  assert.equal((await f.vault.snapshot()).tasks[0].reminder, null);
});

test("invalid reminders and repetition metadata cannot corrupt an existing note", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault);
  const before = (await f.vault.snapshot()).tasks[0];
  for (const patch of [
    { reminder: "2026-10-15T08:00:00" },
    { reminder: "2026-02-30T08:00:00Z" },
    { reminder: "2026-10-15T24:00:00Z" },
    { repeat: { frequency: "daily", interval: 0 } },
    { repeat: { frequency: "daily", interval: 1, arbitrary: true } },
  ]) {
    assert.equal(taskPatchSchema.safeParse(patch).success, false);
    await assert.rejects(f.vault.updateTask(task.id, task.revision, patch));
    assert.deepEqual((await f.vault.snapshot()).tasks[0], before);
  }
  assert.equal(validTimestamp("2024-02-29T23:59:59.123-05:00"), true);
});

test("recurrence skips missed days and preserves a monthly anchor through February", async (t) => {
  const f = await fixture(t, "2027-01-31T10:00:00Z");
  const task = await create(f.vault, {
    scheduled: "2027-01-31",
    repeat: { frequency: "monthly", interval: 1 },
  });
  const completed = await f.vault.updateTask(task.id, task.revision, {
    status: "done",
  });
  let next = (await f.vault.snapshot()).tasks.find(
    (item) => item.id === completed.nextOccurrenceId,
  )!;
  assert.equal(next.scheduled, "2027-02-28");
  f.tick("2027-02-28T10:00:00Z");
  const february = await f.vault.updateTask(next.id, next.revision, {
    status: "done",
  });
  next = (await f.vault.snapshot()).tasks.find(
    (item) => item.id === february.nextOccurrenceId,
  )!;
  assert.equal(next.scheduled, "2027-03-31");
  assert.equal(
    nextOccurrence(
      "2026-10-01",
      { frequency: "weekly", interval: 2 },
      "2026-11-11",
    ),
    "2026-11-12",
  );
});

test("recurrence after rollover preserves the original deadline and reminder offsets", async (t) => {
  const f = await fixture(t, "2026-10-01T10:00:00Z");
  const task = await create(f.vault, {
    scheduled: "2026-10-01",
    due: "2026-10-02",
    reminder: "2026-10-01T09:00:00+05:30",
    repeat: { frequency: "weekly", interval: 1 },
  });
  f.tick("2026-10-15T10:00:00Z");
  const rolled = (await f.vault.snapshot()).tasks[0];
  assert.equal(rolled.scheduled, "2026-10-15");
  assert.equal(rolled.due, "2026-10-02");
  const done = await f.vault.updateTask(task.id, rolled.revision, {
    status: "done",
  });
  const next = (await f.vault.snapshot()).tasks.find(
    (item) => item.id === done.nextOccurrenceId,
  )!;
  assert.equal(next.scheduled, "2026-10-22");
  assert.equal(next.due, "2026-10-23");
  assert.equal(next.reminder, "2026-10-22T03:30:00.000Z");
});

test("undo completion cancels only the pristine successor and recompletion revives the same identity", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-15",
    repeat: { frequency: "daily", interval: 1 },
  });
  const done = await f.vault.updateTask(task.id, task.revision, {
    status: "done",
  });
  const restored = await f.vault.restore(
    task.id,
    done.revision,
    done.undoVersion!,
  );
  assert.equal(restored.status, "todo");
  let tasks = (await f.vault.snapshot()).tasks;
  assert.equal(
    tasks.find((item) => item.id === done.nextOccurrenceId)?.trashed,
    true,
  );
  const redone = await f.vault.updateTask(task.id, restored.revision, {
    status: "done",
  });
  tasks = (await f.vault.snapshot()).tasks;
  assert.equal(tasks.length, 2);
  assert.equal(redone.nextOccurrenceId, done.nextOccurrenceId);
  assert.equal(
    tasks.find((item) => item.id === redone.nextOccurrenceId)?.trashed,
    false,
  );
});

test("undo never cancels an independently edited successor and still prevents duplicate series", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-15",
    repeat: { frequency: "daily", interval: 1 },
  });
  const done = await f.vault.updateTask(task.id, task.revision, {
    status: "done",
  });
  const successor = (await f.vault.snapshot()).tasks.find(
    (item) => item.id === done.nextOccurrenceId,
  )!;
  await f.vault.updateTask(successor.id, successor.revision, {
    notes: "An independent plan",
  });
  const restored = await f.vault.restore(
    task.id,
    done.revision,
    done.undoVersion!,
  );
  await f.vault.updateTask(task.id, restored.revision, { status: "done" });
  const tasks = (await f.vault.snapshot()).tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((item) => item.id === successor.id)?.trashed, false);
  assert.equal(
    tasks.find((item) => item.id === successor.id)?.notes,
    "An independent plan",
  );
});

test("recurring reminder preserves timezone wall time through DST and moves skipped hour forward", () => {
  assert.equal(
    shiftReminder("2026-03-07T09:00:00-05:00", 1, "America/New_York"),
    "2026-03-08T13:00:00.000Z",
  );
  assert.equal(
    shiftReminder("2026-03-07T02:30:00-05:00", 1, "America/New_York"),
    "2026-03-08T07:30:00.000Z",
  );
  assert.equal(
    shiftReminder("2026-10-31T09:00:00-04:00", 1, "America/New_York"),
    "2026-11-01T14:00:00.000Z",
  );
  assert.equal(
    shiftReminder("2026-03-09T09:00:00-04:00", -1, "America/New_York"),
    "2026-03-08T13:00:00.000Z",
  );
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
  assert.equal(inNow(s.tasks[0], s.today), true);
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
  assert.equal(inNow(updated, "2026-10-15"), true);
});

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

test("an issue link template must contain {key}", async (t) => {
  const { vault } = await fixture(t);
  const base = (await vault.snapshot()).preferences;
  await assert.rejects(() =>
    vault.setPreferences({ ...base, issueLinkTemplate: "https://x.test/browse" }),
  );
  const saved = await vault.setPreferences({
    ...base,
    issueLinkTemplate: "https://x.test/browse/{key}",
  });
  assert.equal(saved.issueLinkTemplate, "https://x.test/browse/{key}");
});
