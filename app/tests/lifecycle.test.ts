import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Vault, createVault } from "../core/vault";
import { parseNote, serialize, freshNote } from "../core/notes";
import {
  defaultPreferences,
  taskPatchSchema,
  validTimestamp,
} from "../core/model";
import { nextOccurrence, shiftReminder } from "../core/recurrence";
import { todaySummary } from "../core/today";

async function fixture(t: test.TestContext, initial = "2026-10-15T10:00:00Z") {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-lifecycle-"));
  const root = await createVault(path.join(dir, "Vault"));
  const state = path.join(dir, "state");
  let now = new Date(initial);
  let vault = await new Vault(root, state, () => now).start();
  t.after(async () => {
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    get vault() {
      return vault;
    },
    root,
    state,
    tick(value: string) {
      now = new Date(value);
    },
    async restart() {
      await vault.close();
      vault = await new Vault(root, state, () => now).start();
      return vault;
    },
  };
}
const create = (vault: Vault, extra: Record<string, unknown> = {}) =>
  vault.createTask({
    requestId: randomUUID(),
    title: "Read chapter",
    ...extra,
  });

test("rollover writes an actual plan date and readable history once, preserving due and Markdown", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-10",
    due: "2026-10-12",
    notes: "- [ ] Read\n\n[[Context]]",
  });
  const file = path.join(f.root, task.path);
  const parsed = parseNote(await fs.readFile(file, "utf8"));
  parsed.document.set("custom", { color: "blue" });
  parsed.document.commentBefore = " Preserve my comment";
  await fs.writeFile(file, serialize(parsed).replace(/\n/g, "\r\n"));
  const before = parseNote(await fs.readFile(file, "utf8")).body;
  const rolled = (await f.vault.snapshot()).tasks[0];
  assert.equal(rolled.scheduled, "2026-10-15");
  assert.equal(rolled.originalScheduled, "2026-10-10");
  assert.equal(rolled.rolloverCount, 1);
  assert.equal(rolled.lastRolledAt, "2026-10-15T10:00:00.000Z");
  assert.equal(rolled.due, "2026-10-12");
  const raw = await fs.readFile(file, "utf8");
  assert.equal(parseNote(raw).body, before);
  assert.deepEqual(parseNote(raw).data.custom, { color: "blue" });
  assert.match(raw, /Preserve my comment/);
  assert.ok(
    !/(?<!\r)\n/.test(raw),
    "CRLF line endings survive automatic metadata edits",
  );
  assert.equal((await f.vault.snapshot()).tasks[0].revision, rolled.revision);
  assert.equal((await f.vault.versions(task.id)).length, 1);
  f.tick("2026-10-18T10:00:00Z");
  const restarted = await f.restart();
  const caughtUp = (await restarted.snapshot()).tasks[0];
  assert.equal(caughtUp.scheduled, "2026-10-18");
  assert.equal(caughtUp.originalScheduled, "2026-10-10");
  assert.equal(caughtUp.rolloverCount, 2);
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

test("existing preference files acquire auto rollover default without repair", async (t) => {
  const f = await fixture(t);
  await f.vault.close();
  const { autoRollover: _, ...old } = defaultPreferences;
  await fs.writeFile(
    path.join(f.state, "preferences.json"),
    JSON.stringify(old),
  );
  await f.restart();
  assert.equal((await f.vault.snapshot()).preferences.autoRollover, true);
});

test("reminders persist through Obsidian notes and Mini includes reminders outside Today", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-11-01",
    reminder: "2026-10-15T16:00:00+05:30",
  });
  await f.restart();
  const snapshot = await f.vault.snapshot();
  assert.equal(snapshot.tasks[0].reminder, "2026-10-15T16:00:00+05:30");
  assert.equal(
    parseNote(await fs.readFile(path.join(f.root, task.path), "utf8")).data
      .reminder_at,
    task.reminder,
  );
  const mini = todaySummary(snapshot);
  assert.equal(mini.count, 0);
  assert.deepEqual(mini.reminders, [
    {
      id: task.id,
      title: task.title,
      revision: task.revision,
      reminder: task.reminder,
    },
  ]);
  const dismissed = await f.vault.updateTask(task.id, task.revision, {
    reminder: null,
  });
  assert.equal(dismissed.reminder, null);
  assert.equal(todaySummary(await f.vault.snapshot()).reminders.length, 0);
});

test("invalid reminders and repetition metadata cannot corrupt an existing note", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault);
  const file = path.join(f.root, task.path);
  const before = await fs.readFile(file, "utf8");
  for (const patch of [
    { reminder: "2026-10-15T08:00:00" },
    { reminder: "2026-02-30T08:00:00Z" },
    { reminder: "2026-10-15T24:00:00Z" },
    { repeat: { frequency: "daily", interval: 0 } },
    { repeat: { frequency: "daily", interval: 1, arbitrary: true } },
  ]) {
    assert.equal(taskPatchSchema.safeParse(patch).success, false);
    await assert.rejects(f.vault.updateTask(task.id, task.revision, patch));
    assert.equal(await fs.readFile(file, "utf8"), before);
  }
  assert.equal(validTimestamp("2024-02-29T23:59:59.123-05:00"), true);
  await fs.writeFile(
    path.join(f.root, "Tasks/invalid-reminder.md"),
    freshNote({
      schema_version: 1,
      type: "task",
      id: randomUUID(),
      title: "Invalid",
      reminder_at: "tomorrow",
    }),
  );
  const snapshot = await f.vault.snapshot();
  assert.equal(snapshot.tasks.length, 1);
  assert.match(snapshot.diagnostics[0].message, /reminder_at/);
});

test("a recurring completion preserves history, deadlines and unknown data and creates one successor", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-15",
    due: "2026-10-17",
    reminder: "2026-10-15T09:00:00+05:30",
    repeat: { frequency: "weekly", interval: 1 },
    focus: true,
    notes: "- [x] A checklist\n\n```md\n- [x] Code sample\n```\n",
  });
  const parsed = parseNote(
    await fs.readFile(path.join(f.root, task.path), "utf8"),
  );
  parsed.document.set("custom", "retain");
  await fs.writeFile(path.join(f.root, task.path), serialize(parsed));
  const current = (await f.vault.snapshot()).tasks[0];
  const completed = await f.vault.updateTask(task.id, current.revision, {
    status: "done",
  });
  let tasks = (await f.vault.snapshot()).tasks;
  const next = tasks.find((item) => item.id === completed.nextOccurrenceId)!;
  assert.equal(tasks.length, 2);
  assert.equal(completed.status, "done");
  assert.match(completed.notes, /\[x\] A checklist/);
  assert.equal(next.status, "todo");
  assert.equal(next.scheduled, "2026-10-22");
  assert.equal(next.due, "2026-10-24");
  assert.equal(next.reminder, "2026-10-22T03:30:00.000Z");
  assert.equal(next.recurrenceSourceId, task.id);
  assert.equal(next.focus, false);
  assert.match(next.notes, /\[ \] A checklist/);
  assert.match(next.notes, /```md\n- \[x\] Code sample/);
  assert.equal(
    parseNote(await fs.readFile(path.join(f.root, next.path), "utf8")).data
      .custom,
    "retain",
  );
  await f.vault.updateTask(completed.id, completed.revision, {
    status: "done",
  });
  await f.restart();
  tasks = (await f.vault.snapshot()).tasks;
  assert.equal(tasks.length, 2);
  assert.equal(
    tasks.find((item) => item.id === task.id)?.nextOccurrenceId,
    next.id,
  );
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

test("interrupted recurring creation reconciles once, and deliberate deletion stays deleted", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-15",
    repeat: { frequency: "daily", interval: 1 },
  });
  const done = await f.vault.updateTask(task.id, task.revision, {
    status: "done",
  });
  const parsed = parseNote(
    await fs.readFile(path.join(f.root, task.path), "utf8"),
  );
  parsed.document.set("next_occurrence_created", false);
  await fs.writeFile(path.join(f.root, task.path), serialize(parsed));
  await f.restart();
  const tasks = (await f.vault.snapshot()).tasks;
  assert.equal(tasks.length, 2);
  const successor = tasks.find((item) => item.id === done.nextOccurrenceId)!;
  await fs.unlink(path.join(f.root, successor.path));
  await f.restart();
  assert.equal((await f.vault.snapshot()).tasks.length, 1);
});

test("a completed recurring note resumes interrupted successor creation without replacing unrelated files", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-15",
    repeat: { frequency: "daily", interval: 1 },
  });
  const childId = randomUUID();
  const file = path.join(f.root, task.path);
  const parsed = parseNote(await fs.readFile(file, "utf8"));
  parsed.document.set("status", "done");
  parsed.document.set("completed_at", "2026-10-15T10:00:00Z");
  parsed.document.set("next_occurrence_id", childId);
  parsed.document.set("next_occurrence_created", false);
  await fs.writeFile(file, serialize(parsed));
  const occupied = path.join(f.root, `Tasks/recurring--${childId}.md`);
  await fs.writeFile(occupied, "My unrelated Markdown note\n");
  const blocked = await f.vault.snapshot();
  assert.equal(blocked.tasks.length, 1);
  assert.ok(
    blocked.diagnostics.some((issue) =>
      /path is already occupied/.test(issue.message),
    ),
  );
  assert.equal(
    await fs.readFile(occupied, "utf8"),
    "My unrelated Markdown note\n",
  );
  await fs.rename(occupied, path.join(f.root, "unrelated.md"));
  await f.restart();
  const recovered = await f.vault.snapshot();
  assert.equal(recovered.tasks.length, 2);
  assert.equal(
    recovered.tasks.find((item) => item.id === childId)?.recurrenceSourceId,
    task.id,
  );
  assert.equal((await f.vault.snapshot()).tasks.length, 2);
});

test("the existing background scan rolls over at midnight without a browser snapshot", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = await fixture(t, "2026-10-14T18:29:59Z");
  const task = await create(f.vault, { scheduled: "2026-10-14" });
  const changed = new Promise<void>((resolve) =>
    f.vault.once("changed", resolve),
  );
  f.tick("2026-10-14T18:30:00Z");
  t.mock.timers.tick(15_000);
  await changed;
  const note = parseNote(
    await fs.readFile(path.join(f.root, task.path), "utf8"),
  );
  assert.equal(note.data.scheduled, "2026-10-15");
  assert.equal(note.data.rollover_count, 1);
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

test(
  "a read-only rollover note surfaces a diagnostic without hiding the rest of the vault",
  {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  },
  async (t) => {
    const f = await fixture(t);
    const task = await create(f.vault, { scheduled: "2026-10-01" });
    const file = path.join(f.root, task.path);
    const raw = await fs.readFile(file, "utf8");
    await fs.chmod(file, 0o400);
    try {
      const snapshot = await f.vault.snapshot();
      assert.equal(snapshot.tasks.length, 1);
      assert.match(
        snapshot.diagnostics[0].message,
        /Automatic task update paused/,
      );
      assert.equal(await fs.readFile(file, "utf8"), raw);
    } finally {
      await fs.chmod(file, 0o600);
    }
  },
);

test("a large overdue batch uses linear file reads while retaining every deadline and recovery copy", async (t) => {
  const f = await fixture(t);
  await f.vault.close();
  const count = 100;
  for (let index = 0; index < count; index++) {
    await fs.writeFile(
      path.join(f.root, `Tasks/overdue-${index}.md`),
      freshNote(
        {
          schema_version: 1,
          type: "task",
          id: randomUUID(),
          title: `Overdue ${index}`,
          status: "todo",
          scheduled: "2026-10-01",
          due: "2026-10-03",
          created_at: "2026-10-01T08:00:00Z",
          updated_at: "2026-10-01T08:00:00Z",
        },
        `## Context\n\nOwned Markdown ${index}.\n\n- [ ] Next action\n`,
      ),
    );
  }
  const originalRead = fs.readFile;
  let reads = 0;
  t.mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).startsWith(f.root) && String(args[0]).endsWith(".md"))
        reads++;
      return originalRead(...args);
    },
  );
  const started = Date.now();
  await f.restart();
  const startupReads = reads;
  const startupMs = Date.now() - started;
  assert.ok(
    startupReads <= count * 6,
    `Expected linear reads; observed ${startupReads} for ${count} notes`,
  );
  const snapshot = await f.vault.snapshot();
  assert.equal(snapshot.tasks.length, count);
  assert.ok(
    snapshot.tasks.every(
      (task) =>
        task.scheduled === "2026-10-15" &&
        task.due === "2026-10-03" &&
        task.rolloverCount === 1,
    ),
  );
  assert.equal(
    (await fs.readdir(path.join(f.state, "versions"))).length,
    count,
  );
  t.diagnostic(
    `${count} overdue notes: ${startupMs} ms startup, ${startupReads} Markdown reads`,
  );
});

test("unchanged-note cache still observes Obsidian edits even when size and modification time are unchanged", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, { title: "First" });
  const file = path.join(f.root, task.path);
  const original = await fs.readFile(file, "utf8");
  const st = await fs.stat(file);
  const external = original.replace("title: First", "title: Other");
  assert.equal(external.length, original.length);
  await fs.writeFile(file, external);
  await fs.utimes(file, st.atime, st.mtime);
  const loaded = (await f.vault.snapshot()).tasks[0];
  assert.equal(loaded.title, "Other");
  assert.notEqual(loaded.revision, task.revision);
  await assert.rejects(
    f.vault.updateTask(task.id, task.revision, { title: "Stale" }),
    { code: "CONFLICT" },
  );
  assert.equal(await fs.readFile(file, "utf8"), external);
});

test("automatic batches retain the final revision check after writing the recovery copy", async (t) => {
  const f = await fixture(t);
  const task = await create(f.vault, {
    scheduled: "2026-10-01",
    notes: "Owner context",
  });
  const file = path.join(f.root, task.path);
  const originalRead = fs.readFile;
  let taskReads = 0;
  let external = "";
  t.mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      const value = await originalRead(...args);
      if (args[0] === file && ++taskReads === 2) {
        external = String(value).replace(
          "Owner context",
          "Changed concurrently in Obsidian",
        );
        await fs.writeFile(file, external);
      }
      return value;
    },
  );
  const snapshot = await f.vault.snapshot();
  assert.ok(external);
  assert.equal(await originalRead(file, "utf8"), external);
  assert.match(snapshot.tasks[0].notes, /Changed concurrently in Obsidian/);
  assert.ok(
    snapshot.diagnostics.some((issue) =>
      /Automatic task update paused/.test(issue.message),
    ),
  );
  assert.equal((await f.vault.versions(task.id)).length, 1);
});
