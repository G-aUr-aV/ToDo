import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Vault, createVault } from "../core/vault";
import { Auth } from "../server/auth";
import { createServer } from "../server/app";
async function fixture(t: test.TestContext, withClient = false) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "todo-http-test-"));
  const root = await createVault(path.join(dir, "Vault"));
  const vault = await new Vault(root, path.join(dir, "state")).start();
  const auth = new Auth(path.join(dir, "state"));
  const loginFile = (await auth.initialize())!;
  const password = (await fs.readFile(loginFile, "utf8"))
    .split("Password: ")[1]
    .split("\n")[0];
  const origin = "http://localhost:4310";
  const clientDir = withClient ? path.join(dir, "client") : undefined;
  if (clientDir) {
    await fs.mkdir(clientDir);
    await fs.writeFile(
      path.join(clientDir, "index.html"),
      "<title>Full app</title>",
    );
    await fs.writeFile(
      path.join(clientDir, "mini.html"),
      "<title>Mini Today</title>",
    );
    await fs.writeFile(
      path.join(clientDir, "mini.webmanifest"),
      JSON.stringify({ id: "/mini", start_url: "/mini" }),
    );
  }
  const app = await createServer({
    vault,
    auth,
    publicOrigin: origin,
    clientDir,
  });
  t.after(async () => {
    await app.close();
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const headers = {
    host: "localhost:4310",
    origin,
    "content-type": "application/json",
  };
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers,
    payload: { username: "owner", password },
  });
  assert.equal(login.statusCode, 200);
  const session = login.json();
  const cookie = login.cookies[0].name + "=" + login.cookies[0].value;
  return {
    app,
    vault,
    auth,
    password,
    headers: { ...headers, cookie, "x-todo-csrf": session.csrf },
    cookie,
    dir,
  };
}
test("authentication protects vault data and uses HttpOnly SameSite session cookies", async (t) => {
  const f = await fixture(t);
  const unauth = await f.app.inject({
    url: "/api/workspace",
    headers: { host: "localhost:4310" },
  });
  assert.equal(unauth.statusCode, 401);
  const info = await f.app.inject({
    url: "/api/session",
    headers: { host: "localhost:4310", cookie: f.cookie },
  });
  assert.equal(info.json().authenticated, true);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/login",
    headers: {
      host: "localhost:4310",
      origin: "http://localhost:4310",
      "content-type": "application/json",
    },
    payload: { username: "owner", password: f.password },
  });
  assert.match(login.headers["set-cookie"] as string, /HttpOnly/);
  assert.match(login.headers["set-cookie"] as string, /SameSite=Strict/i);
});
test("wrong hosts, cross-origin writes and missing CSRF tokens are denied", async (t) => {
  const f = await fixture(t);
  const payload = { requestId: randomUUID(), title: "Blocked" };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { ...f.headers, host: "evil.example" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { ...f.headers, origin: "https://evil.example" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { ...f.headers, "x-todo-csrf": "" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal((await f.vault.snapshot()).tasks.length, 0);
});
test("HTTP mutations require revisions and reject stale updates", async (t) => {
  const f = await fixture(t);
  const create = await f.app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: f.headers,
    payload: { requestId: randomUUID(), title: "HTTP task" },
  });
  assert.equal(create.statusCode, 200);
  const task = create.json();
  const missing = await f.app.inject({
    method: "PATCH",
    url: "/api/tasks/" + task.id,
    headers: f.headers,
    payload: { focus: true },
  });
  assert.equal(missing.statusCode, 428);
  const updated = await f.app.inject({
    method: "PATCH",
    url: "/api/tasks/" + task.id,
    headers: { ...f.headers, "if-match": task.revision },
    payload: { focus: true },
  });
  assert.equal(updated.statusCode, 200);
  const stale = await f.app.inject({
    method: "PATCH",
    url: "/api/tasks/" + task.id,
    headers: { ...f.headers, "if-match": task.revision },
    payload: { title: "Old write" },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.current.focus, true);
});
test("request validation rejects unknown fields, traversal identities and invalid dates", async (t) => {
  const f = await fixture(t);
  for (const payload of [
    { requestId: randomUUID(), title: "Bad", path: "../outside.md" },
    { requestId: randomUUID(), title: "Bad date", due: "2026-02-31" },
    { requestId: "../../outside", title: "Traversal" },
  ])
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: f.headers,
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal((await f.vault.snapshot()).tasks.length, 0);
});
test("logout invalidates the server session", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/logout",
        headers: f.headers,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/workspace", headers: f.headers }))
      .statusCode,
    401,
  );
});
test("changing a password invalidates other sessions and removes the initial cleartext login file", async (t) => {
  const f = await fixture(t);
  const other = await f.auth.login("owner", f.password);
  const changed = await f.app.inject({
    method: "POST",
    url: "/api/account/password",
    headers: f.headers,
    payload: {
      currentPassword: f.password,
      newPassword: "A temporary test password 123",
    },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(f.auth.session(other.id), null);
  await assert.rejects(fs.access(path.join(f.dir, "state/initial-login.txt")));
  await assert.rejects(f.auth.login("owner", f.password), {
    code: "LOGIN_FAILED",
  });
  const fresh = await f.auth.login("owner", "A temporary test password 123");
  assert.ok(fresh.csrf);
});
test("health and readiness report process and vault state", async (t) => {
  const f = await fixture(t);
  const h = await f.app.inject({
    url: "/healthz",
    headers: { host: "localhost:4310" },
  });
  assert.equal(h.json().status, "ok");
  const r = await f.app.inject({
    url: "/readyz",
    headers: { host: "localhost:4310" },
  });
  assert.equal(r.json().ready, true);
});
test("Today summary is authenticated and omits Markdown bodies", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.app.inject({
        url: "/api/today",
        headers: { host: "localhost:4310" },
      })
    ).statusCode,
    401,
  );
  await f.vault.createTask({
    requestId: randomUUID(),
    title: "Today endpoint task",
    due: "2020-01-01",
    notes: "Private body must not be in the mini payload",
  });
  const res = await f.app.inject({ url: "/api/today", headers: f.headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.json().count, 1);
  assert.doesNotMatch(res.body, /Private body|"notes"/);
});
test("Mini deep links and install manifest are served without stale shell caching", async (t) => {
  const f = await fixture(t, true);
  const mini = await f.app.inject({ url: "/mini", headers: f.headers });
  assert.equal(mini.statusCode, 200);
  assert.match(mini.body, /Mini Today/);
  assert.equal(mini.headers["cache-control"], "no-cache");
  const manifest = await f.app.inject({
    url: "/mini.webmanifest",
    headers: f.headers,
  });
  assert.equal(manifest.json().start_url, "/mini");
  assert.equal(manifest.headers["cache-control"], "no-cache");
  const redirect = await f.app.inject({ url: "/mini/", headers: f.headers });
  assert.equal(redirect.headers.location, "/mini");
});

test("malformed/oversized JSON receives a bounded client error", async (t) => {
  const f = await fixture(t);
  const malformed = await f.app.inject({ method: "POST", url: "/api/tasks", headers: f.headers, payload: "{bad json" });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, "REQUEST_INVALID");
  const tooLarge = await f.app.inject({ method: "POST", url: "/api/tasks", headers: f.headers, payload: JSON.stringify({ notes: "x".repeat(2_100_001) }) });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal((await f.vault.snapshot()).tasks.length, 0);
});

test("repeated failed logins are throttled", async (t) => {
  const f = await fixture(t);
  let throttled = false;
  for (let i = 0; i < 11; i++) {
    const result = await f.app.inject({ method: "POST", url: "/api/login", headers: f.headers, payload: { username: "owner", password: "incorrect password" } });
    if (result.statusCode === 429) {
      throttled = true;
      assert.equal(result.json().error.code, "RATE_LIMIT");
    } else assert.equal(result.statusCode, 401);
  }
  assert.ok(throttled);
});

test("readiness becomes unavailable when task storage loses write access", async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.vault.root, "Tasks");
  await fs.chmod(directory, 0o500);
  t.after(() => fs.chmod(directory, 0o700).catch(() => {}));
  const result = await f.app.inject({ url: "/readyz", headers: f.headers });
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().ready, false);
  assert.equal((await f.app.inject({ url: "/healthz", headers: f.headers })).statusCode, 200);
  await fs.chmod(directory, 0o700);
});
