// Tests the actual one-command Docker helper in a clean temporary checkout.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);
const workspace = path.resolve(import.meta.dirname, "../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "todo-compose-smoke-"));
const checkout = path.join(temporary, "checkout");
const project = "todo-setup-" + randomUUID().slice(0, 8);
const port = process.env.TODO_COMPOSE_SMOKE_PORT ?? "4314";
const origin = "http://localhost:" + port;
const env = { ...process.env, COMPOSE_PROJECT_NAME: project, TODO_PORT: port, TODO_PUBLIC_ORIGIN: origin, TODO_VAULT_PATH: "./Todo Vault", TODO_STATE_PATH: "./.todo-state/server" };
const options = { cwd: checkout, env, maxBuffer: 2_000_000 };
const excluded = new Set(["node_modules", "dist", "out", ".todo-state"]);
await fs.mkdir(checkout);
for (const file of ["Dockerfile", "compose.yaml", ".dockerignore", "start-docker.sh"])
  await fs.copyFile(path.join(workspace, file), path.join(checkout, file));
await fs.cp(path.join(workspace, "app"), path.join(checkout, "app"), {
  recursive: true,
  filter: (file) => !path.relative(path.join(workspace, "app"), file).split(path.sep).some((part) => excluded.has(part) || part.startsWith(".env")),
});
async function start() {
  await exec("sh", ["./start-docker.sh"], options);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + "/readyz", { signal: AbortSignal.timeout(3000) })).ok) return; } catch {}
    await delay(200);
  }
  throw new Error("Compose helper readiness timed out");
}
try {
  await start();
  const configuration = await fs.readFile(path.join(checkout, ".env"), "utf8");
  assert.match(configuration, new RegExp(`TODO_UID=${process.getuid()}\\b`));
  assert.equal((await fs.stat(path.join(checkout, ".env"))).mode & 0o777, 0o600);
  assert.match(await fs.readFile(path.join(checkout, "Todo Vault/Home.md"), "utf8"), /This vault owns your Todo data/);
  const loginText = await fs.readFile(path.join(checkout, ".todo-state/server/initial-login.txt"), "utf8");
  const password = loginText.match(/^Password: (.+)$/m)[1];
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const login = await fetch(origin + "/api/login", { method: "POST", headers, body: JSON.stringify({ username: "owner", password }) });
  assert.equal(login.status, 200);
  headers.Cookie = login.headers.get("set-cookie").split(";")[0];
  headers["X-Todo-CSRF"] = (await login.json()).csrf;
  const created = await fetch(origin + "/api/tasks", { method: "POST", headers, body: JSON.stringify({ requestId: randomUUID(), title: "Compose helper retains my note" }) });
  assert.equal(created.status, 200);
  const task = await created.json();
  const notePath = path.join(checkout, "Todo Vault", task.path);
  const note = await fs.readFile(notePath, "utf8");
  const ownerPath = path.join(checkout, ".todo-state/server/owner.json");
  const owner = await fs.readFile(ownerPath, "utf8");
  await start();
  assert.equal(await fs.readFile(path.join(checkout, ".env"), "utf8"), configuration);
  assert.equal(await fs.readFile(notePath, "utf8"), note);
  assert.equal(await fs.readFile(ownerPath, "utf8"), owner);
  const image = JSON.parse((await exec("docker", ["image", "inspect", "todo-daylight:0.1.0"], options)).stdout)[0];
  const result = { passed: true, checkedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, ownerVaultUsed: false, temporaryFixtureCleanedAfterRun: true, image: image.Id, imageUncompressedBytesIncludingNodeBase: image.Size, checks: ["one shell command from clean checkout", "absent private .env generated with host UID/GID", "missing bind folders created", "nondefault localhost port/origin", "full Obsidian scaffold created", "private generated owner login", "authenticated Markdown write", "repeat helper preserves configuration, note and account", "temporary Compose project removed"] };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await exec("docker", ["compose", "down", "--remove-orphans"], options).catch(() => {});
  await fs.rm(temporary, { recursive: true, force: true });
}
