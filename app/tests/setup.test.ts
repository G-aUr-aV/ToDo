import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareVault, runtimeConfig, validateStoragePaths } from "../server/runtime";
import { Auth } from "../server/auth";

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-setup-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("first launch creates a complete dedicated vault once without replacing notes", async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, "nested", "My Tasks");
  assert.equal(await prepareVault(root), true);
  for (const name of ["Tasks", "Projects", "Days", "Attachments", "Templates", ".obsidian"])
    assert.ok((await fs.stat(path.join(root, name))).isDirectory());
  await fs.writeFile(path.join(root, "Home.md"), "# My own home note\n");
  await fs.writeFile(path.join(root, "Tasks", "personal.md"), "Keep my existing note\n");
  assert.equal(await prepareVault(root), false);
  assert.equal(await fs.readFile(path.join(root, "Home.md"), "utf8"), "# My own home note\n");
  assert.equal(await fs.readFile(path.join(root, "Tasks", "personal.md"), "utf8"), "Keep my existing note\n");
});

test("an empty Docker bind mount becomes a complete Obsidian vault", async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, "Mount");
  await fs.mkdir(root);
  assert.equal(await prepareVault(root), true);
  assert.match(await fs.readFile(path.join(root, "Home.md"), "utf8"), /Todo Vault/);
  assert.ok((await fs.stat(path.join(root, "Templates", "Task.md"))).isFile());
  assert.equal(await prepareVault(root), false);
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
  assert.throws(() => runtimeConfig({ VAULT_PATH: "/tmp/vault", STATE_PATH: "/tmp/vault/private" }, cwd), /outside/);
});

test("setup rejects vault/state symlinks before creating private account files", async (t) => {
  const dir = await fixture(t);
  const outside = path.join(dir, "outside");
  await fs.mkdir(outside);
  const linked = path.join(dir, "link");
  await fs.symlink(outside, linked, "dir");
  await assert.rejects(prepareVault(linked), /symlink/);
  const root = path.join(dir, "Vault");
  await prepareVault(root);
  await assert.rejects(validateStoragePaths(root, linked), /symlink/);
  await assert.rejects(new Auth(linked).initialize(), /symlink/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("canonical storage validation keeps account files outside an aliased vault", async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, "Vault");
  await prepareVault(root);
  const alias = path.join(dir, "parent-alias");
  await fs.symlink(dir, alias, "dir");
  await assert.rejects(validateStoragePaths(root, path.join(alias, "Vault", "private")), /outside/);
  await assert.rejects(fs.access(path.join(root, "private", "owner.json")));
});

test("an orphan initial login never causes an inaccessible new owner account", async (t) => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, "initial-login.txt"), "A previous interrupted setup\n", { mode: 0o600 });
  await assert.rejects(new Auth(dir).initialize(), /without owner.json/);
  await assert.rejects(fs.access(path.join(dir, "owner.json")));
  assert.equal(await fs.readFile(path.join(dir, "initial-login.txt"), "utf8"), "A previous interrupted setup\n");
});
