import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspace } from "../core/sqlite-workspace";
import { createServer } from "../server/app";
import { Auth } from "../server/auth";
import { openWorkspace } from "../server/runtime";
import { handleMcp } from "../server/mcp";
import { defaultPreferences, type Task } from "../core/model";

async function temp(t: test.TestContext) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "todo-sqlite-test-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixture(t: test.TestContext) {
  const dir = await temp(t);
  let clock = new Date("2026-11-27T20:00:00Z");
  const workspace = new SqliteWorkspace(
    path.join(dir, "todo.sqlite"),
    () => clock,
  ).start();
  t.after(() => workspace.close());
  await workspace.setPreferences({
    ...defaultPreferences,
    autoRollover: false,
  });
  const create = (title: string, values: Record<string, unknown> = {}) =>
    workspace.createTask({ requestId: randomUUID(), title, ...values });
  return {
    workspace,
    dir,
    create,
    setClock: (time: string) => {
      clock = new Date(time);
    },
  };
}

const key = ({ id, revision }: Task) => ({ id, revision });

test("startup gates a legacy vault before creating SQLite and keeps one workspace writer", async (t) => {
  const dir = await temp(t);
  const root = path.join(dir, "Legacy");
  const state = path.join(dir, "state");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "Home.md"), "# Existing\n");
  await assert.rejects(openWorkspace(root, state), /needs migration/);
  assert.deepEqual(await fs.readdir(state), []);
  assert.equal(
    await fs.readFile(path.join(root, "Home.md"), "utf8"),
    "# Existing\n",
  );
  const fresh = path.join(dir, "missing");
  const first = await openWorkspace(fresh, state);
  const snapshot = await first.workspace.snapshot();
  assert.equal(snapshot.storage, "sqlite");
  assert.equal(snapshot.tasks.length, 0);
  await assert.rejects(openWorkspace(fresh, state), /active Todo writer/);
  await first.close();
  const reopened = await openWorkspace(fresh, state);
  t.after(() => reopened.close());
  assert.equal(
    (await reopened.workspace.snapshot()).vaultKey,
    snapshot.vaultKey,
  );
});

test("SQLite backups keep structured records, idempotency, stale-write checks and exact Undo", async (t) => {
  const { workspace, dir } = await fixture(t);
  const project = await workspace.createProject({
    requestId: randomUUID(),
    title: "Reading",
  });
  const requestId = randomUUID();
  const first = await workspace.createTask({
    requestId,
    title: "Draft",
    notes: "Original",
    projectId: project.id,
  });
  assert.deepEqual(
    await workspace.createTask({ requestId, title: "Retry" }),
    first,
  );
  const edited = await workspace.updateTask(first.id, first.revision, {
    notes: "Updated",
  });
  await assert.rejects(
    workspace.updateTask(first.id, first.revision, { notes: "Stale" }),
    { code: "CONFLICT" },
  );
  const file = path.join(dir, "backup.sqlite");
  await workspace.backupTo(file);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
  assert.equal(
    db.prepare("SELECT content FROM notes WHERE id = ?").get(first.id)?.content,
    "Updated",
  );
  db.close();
  const backup = new SqliteWorkspace(file).start();
  t.after(() => backup.close());
  const restored = await backup.restore(
    edited.id,
    edited.revision,
    edited.undoVersion!,
  );
  assert.equal(restored.notes, first.notes);
  assert.equal(restored.projectId, project.id);
  assert.equal((await backup.versions(first.id)).length, 2);
});

test("bulk rescheduling is all-or-nothing and keeps deadlines and Undo history", async (t) => {
  const { workspace, create } = await fixture(t);
  const a = await create("First", { due: "2026-11-28" });
  const b = await create("Second", { due: "2026-12-01" });
  const changed = await workspace.updateTask(b.id, b.revision, {
    notes: "Edit after selection",
  });
  await assert.rejects(
    workspace.bulkSchedule({
      scheduled: "2026-12-02",
      tasks: [key(a), key(b)],
    }),
    { code: "CONFLICT" },
  );
  assert.equal((await workspace.versions(a.id)).length, 0);
  assert.equal(
    (await workspace.snapshot()).tasks.find(({ id }) => id === a.id)?.scheduled,
    null,
  );
  const tasks = await workspace.bulkSchedule({
    scheduled: "2026-12-02",
    tasks: [key(a), key(changed)],
  });
  assert.deepEqual(
    tasks.map(({ due }) => due),
    [a.due, b.due],
  );
  assert.ok(
    tasks.every(
      ({ scheduled, undoVersion }) => scheduled === "2026-12-02" && undoVersion,
    ),
  );
  const cleared = await workspace.bulkSchedule({
    scheduled: null,
    tasks: tasks.map(key),
  });
  assert.ok(cleared.every(({ scheduled }) => scheduled === null));
});

test("recurrence, exact Undo and rollover preserve schedule and deadline independently", async (t) => {
  const { workspace, create, setClock } = await fixture(t);
  const first = await create("Monthly", {
    status: "doing",
    scheduled: "2026-11-30",
    due: "2026-12-01",
    notes: "- [x] Reset this\n\n```md\n- [x] Example\n```",
    repeat: { frequency: "monthly", interval: 1 },
  });
  const done = await workspace.updateTask(first.id, first.revision, {
    status: "done",
  });
  const child = async () =>
    (await workspace.snapshot()).tasks.find(
      ({ id }) => id === done.nextOccurrenceId,
    )!;
  const successor = await child();
  assert.equal(successor.scheduled, "2026-12-30");
  assert.equal(successor.due, "2026-12-31");
  assert.match(successor.notes, /\[ \] Reset this/);
  assert.match(successor.notes, /\[x\] Example/);
  const reopened = await workspace.restore(
    first.id,
    done.revision,
    done.undoVersion!,
  );
  assert.equal(reopened.status, "doing");
  assert.equal((await child()).trashed, true);
  await workspace.updateTask(first.id, reopened.revision, { status: "done" });
  assert.equal((await child()).trashed, false);
  assert.equal((await workspace.snapshot()).tasks.length, 2);
  setClock("2026-12-31T20:00:00Z");
  await workspace.setPreferences({ ...defaultPreferences, autoRollover: true });
  const rolled = await child();
  assert.equal(rolled.scheduled, "2027-01-01");
  assert.equal(rolled.due, successor.due);
  assert.equal(rolled.originalScheduled, successor.scheduled);
});

test("MCP day uses planned work, deadline fallback, and local completion day", async (t) => {
  const { workspace, create } = await fixture(t);
  const fallback = await create("Only due", { due: "2026-11-28" });
  await create("Plan wins", { scheduled: "2026-11-29", due: "2026-11-28" });
  const done = await create("Local midnight", {
    status: "done",
    scheduled: "2026-11-29",
  });
  await create("Trash", { due: "2026-11-28", trashed: true });
  const result = (await handleMcp(workspace, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "find_tasks",
      arguments: { day: "2026-11-28", status: "all", limit: 2 },
    },
  })) as { result: { structuredContent: { total: number; tasks: Task[] } } };
  assert.equal(result.result.structuredContent.total, 2);
  assert.deepEqual(
    result.result.structuredContent.tasks.map(({ id }) => id).sort(),
    [fallback.id, done.id].sort(),
  );
});

test("HTTP protects SQLite backups and registers database routes only", async (t) => {
  const { workspace, dir, create } = await fixture(t);
  const auth = new Auth(dir);
  const loginFile = (await auth.initialize())!;
  const password = (await fs.readFile(loginFile, "utf8"))
    .split("Password: ")[1]
    .split("\n")[0];
  const origin = "http://localhost:4310";
  const app = await createServer({
    vault: workspace,
    auth,
    publicOrigin: origin,
  });
  t.after(async () => {
    await app.close();
    await auth.flush();
  });
  const headers = {
    host: "localhost:4310",
    origin,
    "content-type": "application/json",
  };
  assert.equal(
    (await app.inject({ url: "/api/backup", headers })).statusCode,
    401,
  );
  const session = await app.inject({
    url: "/api/login",
    method: "POST",
    headers,
    payload: { username: "owner", password },
  });
  assert.equal(session.statusCode, 200);
  const cookie = session.cookies[0].name + "=" + session.cookies[0].value;
  const signed = { ...headers, cookie, "x-todo-csrf": session.json().csrf };
  const task = await create("Backup entry");
  const bulk = (tasks: ReturnType<typeof key>[]) =>
    app.inject({
      url: "/api/tasks/bulk-schedule",
      method: "POST",
      headers: signed,
      payload: { scheduled: "2026-11-30", tasks },
    });
  assert.equal((await bulk([key(task), key(task)])).statusCode, 400);
  assert.equal((await bulk([key(task)])).json()[0].scheduled, "2026-11-30");
  const backup = await app.inject({ url: "/api/backup", headers: signed });
  assert.equal(backup.statusCode, 200);
  assert.equal(backup.headers["cache-control"], "no-store");
  assert.match(
    backup.headers["content-disposition"] as string,
    /attachment; filename="todo-.*\.sqlite"/,
  );
  assert.ok(
    backup.rawPayload.subarray(0, 16).equals(Buffer.from("SQLite format 3\0")),
  );
  assert.equal(
    (await app.inject({ url: "/api/export", headers: signed })).statusCode,
    404,
  );
});
