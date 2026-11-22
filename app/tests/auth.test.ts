import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Auth } from "../server/auth";
const DAY = 24 * 60 * 60 * 1000;
async function fixture(t: test.TestContext) {
  const state = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "todo-auth-test-"),
  );
  let now = Date.parse("2026-11-21T10:00:00Z");
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const auth = new Auth(state, clock.now);
  t.after(async () => {
    await auth.flush();
    await fs.rm(state, { recursive: true, force: true });
  });
  const loginFile = (await auth.initialize())!;
  const password = (await fs.readFile(loginFile, "utf8"))
    .split("Password: ")[1]
    .split("\n")[0];
  return { state, auth, clock, password };
}

test("sessions slide for 7 days of use and expire after 7 idle days", async (t) => {
  const { auth, clock, password } = await fixture(t);
  const s = await auth.login("owner", password);
  clock.advance(6 * DAY);
  assert.ok(auth.session(s.id));
  clock.advance(6 * DAY);
  assert.ok(auth.session(s.id), "use within the week extends the session");
  clock.advance(8 * DAY);
  assert.equal(auth.session(s.id), null);
});

test("sessions survive a server restart", async (t) => {
  const { state, auth, clock, password } = await fixture(t);
  const s = await auth.login("owner", password);
  await auth.flush();
  const raw = await fs.readFile(path.join(state, "sessions.json"), "utf8");
  assert.doesNotMatch(raw, new RegExp(s.id), "only a hash of the id is stored");
  const restarted = new Auth(state, clock.now);
  await restarted.load();
  assert.equal(restarted.session(s.id)?.csrf, s.csrf);
  await restarted.flush();
});

test("corrupt session and token files do not stop the server and fail closed", async (t) => {
  const { state, clock } = await fixture(t);
  await fs.writeFile(path.join(state, "sessions.json"), "{not json");
  await fs.writeFile(path.join(state, "tokens.json"), "{not json");
  const restarted = new Auth(state, clock.now);
  await restarted.load();
  assert.equal(restarted.session("a".repeat(64)), null);
  assert.equal(restarted.verifyToken("Bearer todo_pat_x"), null);
  assert.deepEqual(restarted.listTokens(), []);
});

test("personal tokens authenticate until revoked and are stored hashed", async (t) => {
  const { state, auth } = await fixture(t);
  const { token, info } = await auth.createToken("Claude Code");
  assert.match(token, /^todo_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.verifyToken("Bearer " + token)?.id, info.id);
  assert.equal(auth.verifyToken("Bearer " + token + "x"), null);
  assert.equal(auth.verifyToken(token), null, "the Bearer scheme is required");
  const raw = await fs.readFile(path.join(state, "tokens.json"), "utf8");
  assert.doesNotMatch(raw, new RegExp(token.slice(9)));
  assert.equal(auth.listTokens()[0].name, "Claude Code");
  await auth.revokeToken(info.id);
  assert.equal(auth.verifyToken("Bearer " + token), null);
});

test("changing the password disconnects agents and other sessions", async (t) => {
  const { auth, password } = await fixture(t);
  const mine = await auth.login("owner", password);
  const other = await auth.login("owner", password);
  const { token } = await auth.createToken("Claude Code");
  await auth.changePassword(mine.id, password, "a much longer new password");
  assert.equal(auth.verifyToken("Bearer " + token), null);
  assert.equal(auth.session(other.id), null);
  assert.ok(auth.session(mine.id));
});

test("a session used all week is saved with its renewed expiry", async (t) => {
  const { state, auth, clock, password } = await fixture(t);
  const s = await auth.login("owner", password);
  for (let i = 0; i < 8 * 24 * 3; i++) {
    clock.advance(20 * 60 * 1000);
    assert.ok(auth.session(s.id));
  }
  await auth.flush();
  const restarted = new Auth(state, clock.now);
  await restarted.load();
  assert.ok(restarted.session(s.id), "the saved expiry follows use, not login time");
  await restarted.flush();
});
