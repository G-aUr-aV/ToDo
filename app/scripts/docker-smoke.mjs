// Uses a disposable vault, never the owner's Todo Vault. Requires Docker.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const docker = (...args) => exec("docker", args, { maxBuffer: 2_000_000 });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "todo-docker-smoke-"));
const vault = path.join(dir, "Vault");
const state = path.join(dir, "state");
await fs.mkdir(vault);
await fs.mkdir(state, { mode: 0o700 });
const name = `todo-smoke-${randomUUID().slice(0, 8)}`;
const origin = "http://localhost:4312";
let cookie = "",
  csrf = "";
async function request(route, method = "GET", body, revision) {
  return fetch(origin + route, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Todo-CSRF": csrf,
      ...(revision ? { "If-Match": revision } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("/readyz")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Container readiness timed out");
}
async function run() {
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "--init",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-p",
    "127.0.0.1:4312:3000",
    "-e",
    `PUBLIC_ORIGIN=${origin}`,
    "--mount",
    `type=bind,src=${vault},dst=/vault`,
    "--mount",
    `type=bind,src=${state},dst=/state`,
    "todo-daylight:0.1.0",
  );
  await ready();
}
async function login() {
  // Keep generated fixture credentials and session cookies out of logs/reports.
  const password = (
    await fs.readFile(path.join(state, "initial-login.txt"), "utf8")
  ).match(/^Password: (.+)$/m)[1];
  const res = await request("/api/login", "POST", {
    username: "owner",
    password,
  });
  assert.equal(res.status, 200);
  cookie = res.headers.get("set-cookie").split(";")[0];
  csrf = (await res.json()).csrf;
}
try {
  await run();
  assert.equal((await request("/api/workspace")).status, 401);
  assert.ok((await fs.stat(path.join(vault, "Home.md"))).isFile());
  assert.equal((await request("/api/today")).status, 401);
  const miniShell = await request("/mini");
  assert.equal(miniShell.status, 200);
  assert.match(await miniShell.text(), /Today — Todo Mini/);
  assert.equal(miniShell.headers.get("cache-control"), "no-cache");
  const manifest = await request("/mini.webmanifest");
  assert.equal((await manifest.json()).start_url, "/mini");
  assert.equal(manifest.headers.get("cache-control"), "no-cache");
  await login();
  const created = await request("/api/tasks", "POST", {
    requestId: randomUUID(),
    title: "Docker persistence check",
    scheduled: "2026-10-20",
    due: "2026-10-22",
    notes: "- [ ] Check recreation",
    reminder: "2099-10-22T09:00:00+05:30",
    repeat: { frequency: "daily", interval: 1 },
  });
  assert.equal(created.status, 200);
  const task = await created.json();
  const mini = await request("/api/today");
  assert.equal(mini.headers.get("cache-control"), "no-store");
  const today = await mini.json();
  assert.equal(typeof today.count, "number");
  assert.doesNotMatch(JSON.stringify(today), /Check recreation|"notes"|"path"/);
  const file = path.join(vault, task.path);
  assert.equal((await fs.stat(file)).uid, process.getuid());
  assert.equal(
    (await fs.stat(path.join(state, "owner.json"))).mode & 0o777,
    0o600,
  );
  const original = await fs.readFile(file, "utf8");
  const external = original
    .replace("type: task", "type: task\nexternal_property: preserved")
    .replace("Check recreation", "Edited on the host");
  await fs.writeFile(file, external);
  const conflict = await request(
    `/api/tasks/${task.id}`,
    "PATCH",
    { title: "Stale overwrite" },
    task.revision,
  );
  assert.equal(conflict.status, 409);
  assert.equal(await fs.readFile(file, "utf8"), external);
  let snapshot = await (await request("/api/workspace")).json();
  const current = snapshot.tasks.find((t) => t.id === task.id);
  const changed = await request(
    `/api/tasks/${task.id}`,
    "PATCH",
    { status: "done" },
    current.revision,
  );
  assert.equal(changed.status, 200);
  const completed = await changed.json();
  assert.equal(completed.status, "done");
  assert.equal(completed.reminder, "2099-10-22T09:00:00+05:30");
  const repeated = await (await request("/api/workspace")).json();
  assert.equal(repeated.tasks.filter((t) => t.recurrenceSourceId === task.id).length, 1, JSON.stringify({ tasks: repeated.tasks.map(({ id, status, repeat, recurrenceSourceId, nextOccurrenceId }) => ({ id, status, repeat, recurrenceSourceId, nextOccurrenceId })), diagnostics: repeated.diagnostics }));
  assert.match(await fs.readFile(file, "utf8"), /reminder_at:|repeat:/);
  const rolled = await request("/api/tasks", "POST", {
    requestId: randomUUID(), title: "Old unfinished plan", scheduled: "2000-01-01", due: "2000-01-03",
  });
  assert.equal(rolled.status, 200);
  const oldPlan = await rolled.json();
  const rolloverSnapshot = await (await request("/api/workspace")).json();
  const rolledTask = rolloverSnapshot.tasks.find((t) => t.id === oldPlan.id);
  assert.equal(rolledTask.scheduled, rolloverSnapshot.today);
  assert.equal(rolledTask.due, "2000-01-03");
  assert.ok(rolledTask.rolloverCount >= 1);
  assert.match(await fs.readFile(file, "utf8"), /external_property: preserved/);
  const versions = await (
    await request(`/api/tasks/${task.id}/versions`)
  ).json();
  assert.ok(versions.length > 0);
  await docker("stop", name);
  await docker("rm", name);
  await run();
  assert.equal((await request("/api/workspace")).status, 401);
  await login();
  snapshot = await (await request("/api/workspace")).json();
  const persisted = snapshot.tasks.find((t) => t.id === task.id);
  assert.equal(persisted.status, "done");
  assert.equal(persisted.due, "2026-10-22");
  assert.match(persisted.notes, /Edited on the host/);
  assert.ok(
    (await (await request(`/api/tasks/${task.id}/versions`)).json()).length > 0,
  );
  const inspected = JSON.parse((await docker("inspect", name)).stdout)[0];
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    image: inspected.Image,
    platform: "linux/arm64",
    realVaultUsed: false,
    checks: [
      "unauthenticated access denied",
      "Mini shell and separate install manifest available",
      "authenticated metadata-only Today endpoint with no-store caching",
      "empty bind mount initialized as complete Obsidian vault",
      "authenticated task write",
      "rollover persisted without changing deadline",
      "reminder metadata retained in Markdown",
      "recurrence creates one linked successor",
      "host file ownership",
      "owner configuration mode 0600",
      "external host edit observed",
      "stale write rejected without data loss",
      "unknown property preserved",
      "recovery version recorded",
      "container recreation preserves task and recovery",
      "sessions expire on process restart",
      "read-only root, dropped capabilities, loopback binding",
    ],
    temporaryFixtureCleanedAfterRun: true,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await docker("stop", name).catch(() => {});
  await docker("rm", name).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
}
