// Exercises the real packaged launcher, HTTP API and restart in a disposable vault.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "todo-local-smoke-"));
const cleanInstall = process.env.TODO_SMOKE_CLEAN_INSTALL === "1";
let launcher = path.resolve(import.meta.dirname, "start.mjs");
if (cleanInstall) {
  const source = path.resolve(import.meta.dirname, "..");
  const copy = path.join(directory, "clean-checkout", "app");
  const excluded = new Set(["node_modules", "dist", "out", ".todo-state"]);
  await fs.cp(source, copy, {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(source, file);
      return !relative.split(path.sep).some((part) => excluded.has(part) || part.startsWith(".env"));
    },
  });
  launcher = path.join(copy, "scripts", "start.mjs");
}
const root = path.join(directory, "Fresh Vault");
const state = path.join(directory, "private");
const listener = net.createServer();
await new Promise((resolve, reject) => {
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://localhost:${port}`;
let child, output = "", cookie = "", csrf = "";
async function request(route, method = "GET", body, revision) {
  return fetch(origin + route, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie, "X-Todo-CSRF": csrf, ...(revision ? { "If-Match": revision } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function start() {
  output = "";
  child = spawn(process.execPath, [launcher], {
    cwd: directory,
    env: { ...process.env, VAULT_PATH: root, STATE_PATH: state, PORT: String(port), HOST: "127.0.0.1", PUBLIC_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  for (let i = 0; i < (cleanInstall ? 600 : 100); i++) {
    if (child.exitCode !== null) throw new Error("Launcher exited: " + output);
    try { if ((await request("/readyz")).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Launcher readiness timed out: " + output);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timer;
  try {
    await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Server did not stop cleanly")), 5000);
    })]);
  } finally { clearTimeout(timer); }
  assert.equal(child.exitCode, 0);
}
async function login() {
  const loginFile = await fs.readFile(path.join(state, "initial-login.txt"), "utf8");
  const password = loginFile.match(/^Password: (.+)$/m)[1];
  assert.ok(!output.includes(password), "Generated password must stay out of console output");
  const response = await request("/api/login", "POST", { username: "owner", password });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie").split(";")[0];
  csrf = (await response.json()).csrf;
}
try {
  await start();
  if (cleanInstall) {
    assert.match(output, /Installing Todo's locked dependencies/);
    assert.match(output, /Building Todo/);
  }
  assert.ok((await fs.stat(path.join(root, "Home.md"))).isFile());
  assert.ok((await fs.stat(path.join(root, "Days/README.md"))).isFile());
  assert.equal((await fs.stat(path.join(state, "owner.json"))).mode & 0o777, 0o600);
  assert.equal((await request("/api/workspace")).status, 401);
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/mini")).status, 200);
  await login();
  const events = await request("/api/events");
  assert.equal(events.status, 200);
  const eventReader = events.body.getReader();
  assert.match(new TextDecoder().decode((await eventReader.read()).value), /connected/);
  const created = await request("/api/tasks", "POST", { requestId: randomUUID(), title: "Setup smoke task", notes: "- [x] Data stays in my vault\n\n```md\n- [x] Example remains checked\n```", scheduled: "2030-10-20", reminder: "2030-10-20T09:00:00+05:30", repeat: { frequency: "daily", interval: 1 } });
  assert.equal(created.status, 200);
  assert.match(new TextDecoder().decode((await eventReader.read()).value), /event: changed/);
  const task = await created.json();
  const plannedList = path.join(root, "Days/2030-10-20.md");
  assert.ok((await fs.readFile(plannedList, "utf8")).includes(`- [Setup smoke task](../${task.path})`));
  assert.match(await fs.readFile(path.join(root, task.path), "utf8"), /Data stays in my vault/);
  const completed = await request(`/api/tasks/${task.id}`, "PATCH", { status: "done" }, task.revision);
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).status, "done");
  const afterComplete = await (await request("/api/workspace")).json();
  const completionList = path.join(root, "Days", afterComplete.today + ".md");
  assert.ok((await fs.readFile(completionList, "utf8")).includes(`- ~~[Setup smoke task](../${task.path})~~`));
  assert.ok(!(await fs.readFile(plannedList, "utf8")).includes(task.path));
  const successors = afterComplete.tasks.filter((t) => t.recurrenceSourceId === task.id);
  assert.equal(successors.length, 1, "Packaged runtime must create one repeating successor");
  assert.match(successors[0].notes, /- \[ \] Data stays in my vault/);
  assert.match(successors[0].notes, /- \[x\] Example remains checked/);
  assert.equal(Date.parse(successors[0].reminder) - Date.parse(task.reminder), 86_400_000);
  assert.match(await fs.readFile(path.join(root, task.path), "utf8"), /- \[x\] Data stays in my vault/);
  // Keep the live event connection open: normal browser use must not block shutdown.
  await stop();
  while (!(await eventReader.read()).done) {}
  await start();
  assert.equal((await request("/api/workspace")).status, 401);
  await login();
  const snapshot = await (await request("/api/workspace")).json();
  assert.equal(snapshot.tasks.find((t) => t.id === task.id)?.status, "done");
  assert.ok((await fs.readFile(completionList, "utf8")).includes(`- ~~[Setup smoke task](../${task.path})~~`));
  const versions = await (await request(`/api/tasks/${task.id}/versions`)).json();
  assert.ok(versions.length > 0);
  assert.ok(!output.includes("Created your task vault"), "Restart must preserve the existing vault");
  console.log(`${cleanInstall ? "Clean-install and local" : "Local"} setup smoke passed: fresh vault, private login, HTTP writes, Markdown ownership, linked day lists, restart persistence, recovery, repeating checklist reset, live events, clean shutdown and session expiry.`);
} finally {
  await stop().catch(() => { child?.kill("SIGKILL"); });
  await fs.rm(directory, { recursive: true, force: true });
}
