import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openWorkspace, runtimeConfig } from "../server/runtime";
import { Auth } from "../server/auth";

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-setup-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("an empty legacy bind mount stays empty when the SQLite workspace starts", async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, "Mount");
  await fs.mkdir(root);
  const state = path.join(dir, "state");
  const opened = await openWorkspace(root, state);
  try {
    assert.equal((await opened.workspace.snapshot()).tasks.length, 0);
    assert.ok((await fs.stat(path.join(state, "todo.sqlite"))).isFile());
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await opened.close();
  }
});

test("configuration rejects invalid ports, non-origin URLs and credentials inside the vault", () => {
  const cwd = path.resolve("/tmp/todo-config/app");
  const valid = runtimeConfig({}, cwd);
  assert.equal(valid.port, 4310);
  assert.equal(valid.root, "/tmp/todo-config/Todo Vault");
  assert.equal(runtimeConfig({ PUBLIC_ORIGIN: "https://todo.example/" }, cwd).publicOrigin, "https://todo.example");
  for (const PORT of ["0", "-1", "65536", "4.5", "hello", ""])
    assert.throws(() => runtimeConfig({ PORT }, cwd), /PORT/);
  for (const PUBLIC_ORIGIN of ["bad", "file:///tmp", "https://user:pass@todo.example", "https://todo.example/tasks", "https://todo.example?token=x", "https://todo.example/#task"])
    assert.throws(() => runtimeConfig({ PUBLIC_ORIGIN }, cwd), /PUBLIC_ORIGIN/);
  assert.throws(() => runtimeConfig({ VAULT_PATH: "/tmp/vault", STATE_PATH: "/tmp/vault/private" }, cwd), /separate/);
});

test("setup rejects vault/state symlinks before creating private account files", async (t) => {
  const dir = await fixture(t);
  const outside = path.join(dir, "outside");
  await fs.mkdir(outside);
  const linked = path.join(dir, "link");
  await fs.symlink(outside, linked, "dir");
  const root = path.join(dir, "Vault");
  await fs.mkdir(root);
  await assert.rejects(openWorkspace(linked, path.join(dir, "state")), /ordinary directory/);
  await assert.rejects(openWorkspace(root, linked), /ordinary directory/);
  await assert.rejects(new Auth(linked).initialize(), /symlink/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("canonical storage validation keeps account files outside an aliased vault", async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, "Vault");
  await fs.mkdir(root);
  const alias = path.join(dir, "parent-alias");
  await fs.symlink(dir, alias, "dir");
  await assert.rejects(openWorkspace(root, path.join(alias, "Vault", "private")), /separate/);
  await assert.rejects(openWorkspace(path.join(alias, "Vault"), dir), /separate/);
  assert.deepEqual(await fs.readdir(root), []);
});

test("setup refuses to reinitialize an unrelated database at the destination", async (t) => {
  const dir = await fixture(t);
  const state = path.join(dir, "state");
  await fs.mkdir(state);
  const file = path.join(state, "todo.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE another_app (value TEXT)");
  db.close();
  await assert.rejects(openWorkspace(path.join(dir, "absent"), state), /without a Todo schema/);
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(source.prepare("SELECT name FROM sqlite_schema").all().map(({ name }) => name), ["another_app"]);
  } finally {
    source.close();
  }
});

test("setup detects missing databases in existing account and legacy state", async (t) => {
  const dir = await fixture(t);
  const state = path.join(dir, "state");
  const root = path.join(dir, "Legacy");
  await fs.mkdir(state);
  const owner = path.join(state, "owner.json");
  await fs.writeFile(owner, "existing fixture account");
  await assert.rejects(openWorkspace(root, state), /Existing Todo state has no todo.sqlite/);
  assert.deepEqual(await fs.readdir(state), ["owner.json"]);
  assert.equal(await fs.readFile(owner, "utf8"), "existing fixture account");
  await fs.unlink(owner);
  await fs.mkdir(root);
  await fs.mkdir(path.join(state, "versions"));
  await assert.rejects(openWorkspace(root, state), /restore a backup or migrate/);
  assert.deepEqual(await fs.readdir(state), ["versions"]);
  assert.deepEqual(await fs.readdir(root), []);
});

test("an orphan initial login never causes an inaccessible new owner account", async (t) => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, "initial-login.txt"), "A previous interrupted setup\n", { mode: 0o600 });
  await assert.rejects(new Auth(dir).initialize(), /without owner.json/);
  await assert.rejects(fs.access(path.join(dir, "owner.json")));
  assert.equal(await fs.readFile(path.join(dir, "initial-login.txt"), "utf8"), "A previous interrupted setup\n");
});
