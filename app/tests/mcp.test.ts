import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Vault, createVault } from "../core/vault";
import { Auth } from "../server/auth";
import { createServer } from "../server/app";
import { addProgress, progressStamp } from "../server/mcp";

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "todo-mcp-test-"),
  );
  const root = await createVault(path.join(dir, "Vault"));
  const vault = await new Vault(root, path.join(dir, "state")).start();
  const auth = new Auth(path.join(dir, "state"));
  await auth.initialize();
  const app = await createServer({
    vault,
    auth,
    publicOrigin: "http://localhost:4310",
  });
  const { token } = await auth.createToken("test");
  t.after(async () => {
    await app.close();
    await auth.flush();
    await vault.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const headers = {
    host: "localhost:4310",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer " + token,
  };
  let next = 1;
  const rpc = async (method: string, params?: unknown, extra = {}) =>
    app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...headers, ...extra },
      payload: { jsonrpc: "2.0", id: next++, method, params },
    });
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    assert.equal(r.statusCode, 200, r.body);
    const result = r.json().result;
    return {
      error: !!result.isError,
      text: result.content[0].text as string,
      data: result.structuredContent as any,
    };
  };
  return { app, vault, root, headers, rpc, tool };
}

test("MCP handshake and tool list", async (t) => {
  const f = await fixture(t);
  const init = await f.rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.statusCode, 200);
  assert.equal(init.json().result.protocolVersion, "2025-06-18");
  assert.ok(init.json().result.capabilities.tools);
  assert.match(init.json().result.instructions, /Outcome/);
  const note = await f.app.inject({
    method: "POST",
    url: "/mcp",
    headers: f.headers,
    payload: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(note.statusCode, 202);
  const list = await f.rpc("tools/list");
  assert.deepEqual(
    list.json().result.tools.map((t: { name: string }) => t.name).sort(),
    [
      "add_project",
      "add_task",
      "complete_task",
      "find_tasks",
      "get_task",
      "list_projects",
      "reopen_task",
      "update_task",
    ],
  );
  const unknown = await f.rpc("nope");
  assert.equal(unknown.json().error.code, -32601);
});

test("MCP requires a valid token and rejects browser cross-origin calls", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.rpc("ping", {}, { authorization: "" })).statusCode, 401);
  assert.equal(
    (await f.rpc("ping", {}, { authorization: "Bearer todo_pat_" + "x".repeat(43) }))
      .statusCode,
    401,
  );
  assert.equal(
    (await f.rpc("ping", {}, { origin: "https://evil.example" })).statusCode,
    403,
  );
  assert.equal((await f.rpc("ping")).statusCode, 200);
  const get = await f.app.inject({ url: "/mcp", headers: f.headers });
  assert.equal(get.statusCode, 405);
});

test("agents can file, find, note and close a task with an outcome", async (t) => {
  const f = await fixture(t);
  const missing = await f.tool("add_task", { title: "x", project: "web-api" });
  assert.equal(missing.error, true);
  assert.match(missing.text, /list_projects|add_project/);
  const project = await f.tool("add_project", {
    title: "web-api",
    description: "Repo: web-api",
  });
  assert.equal(project.error, false);
  const dupe = await f.tool("add_project", { title: "Web-Api", description: "" });
  assert.equal(dupe.error, true);
  const added = await f.tool("add_task", {
    title: "Debug why traces are missing in QA",
    project: "WEB-API",
    notes: "From the QA channel.",
  });
  assert.equal(added.error, false, added.text);
  const id = added.data.task.id;
  assert.equal(added.data.task.project, "web-api");
  await f.tool("add_task", { title: "Unrelated chore" });

  const found = await f.tool("find_tasks", { query: "trace qa" });
  assert.deepEqual(found.data.tasks.map((t: { id: string }) => t.id), [id]);
  const projects = await f.tool("list_projects");
  assert.equal(projects.data.projects[0].description, "Repo: web-api");
  assert.equal(projects.data.projects[0].openCount, 1);

  await f.tool("update_task", { id, progress: "Secret looks wrong." });
  await f.tool("update_task", { id, progress: "Confirmed." });
  const replaceWithoutRevision = await f.tool("update_task", { id, notes: "gone" });
  assert.equal(replaceWithoutRevision.error, true);

  const done = await f.tool("complete_task", { id, outcome: "Rotated the key." });
  assert.equal(done.data.task.status, "done");
  const again = await f.tool("complete_task", { id, outcome: "Rotated the key." });
  assert.equal(again.error, false);
  const task = (await f.tool("get_task", { id })).data.task;
  assert.match(
    task.notes.trim(),
    /^From the QA channel\.\n\n## Progress\n- \d{1,2} \w{3} \d\d:\d\d — Secret looks wrong\.\n- \d{1,2} \w{3} \d\d:\d\d — Confirmed\.\n\n## Outcome\nRotated the key\.$/,
  );
  const open = await f.tool("find_tasks", { query: "trace" });
  assert.equal(open.data.tasks.length, 0, "open is the default status filter");
  const all = await f.tool("find_tasks", { query: "trace", status: "done" });
  assert.equal(all.data.tasks.length, 1);

  const reopened = await f.tool("reopen_task", { id });
  assert.equal(reopened.data.task.status, "todo");
});

test("an agent note is not lost when the owner saved the task in between", async (t) => {
  const f = await fixture(t);
  const added = await f.tool("add_task", { title: "Review the PR" });
  const id = added.data.task.id;
  const latest = (await f.vault.snapshot()).tasks.find((t) => t.id === id)!;
  await f.vault.updateTask(id, latest.revision, { title: "Review PR 218" });
  const appended = await f.tool("update_task", { id, append_notes: "Looks good." });
  assert.equal(appended.error, false, appended.text);
  const task = (await f.tool("get_task", { id })).data.task;
  assert.equal(task.title, "Review PR 218");
  assert.equal(task.notes.trim(), "Looks good.");
});

test("progress lines join their section, before any later section", () => {
  const body = "\nContext.\n\n## Progress\n- 1 Nov 09:00 — First.\n\n## Links\n- PR 12\n";
  assert.equal(
    addProgress(body, "Second.", "2 Nov 10:30"),
    "\nContext.\n\n## Progress\n- 1 Nov 09:00 — First.\n- 2 Nov 10:30 — Second.\n\n## Links\n- PR 12\n",
  );
  assert.equal(addProgress("\n", "Only.", "2 Nov 10:30"), "\n## Progress\n- 2 Nov 10:30 — Only.\n");
  assert.equal(progressStamp("2026-11-20T19:12:00Z", "Asia/Kolkata"), "21 Nov 00:42");
});

test("links gather under one Links section and search splits on separators", async (t) => {
  const f = await fixture(t);
  const id = (await f.tool("add_task", { title: "Fix the schema builder crash" })).data.task.id;
  await f.tool("update_task", { id, link: "PR 57: https://git.example.test/pr/57" });
  await f.tool("update_task", { id, progress: "Guard added." });
  await f.tool("update_task", { id, link: "https://trace.example.test/t/1" });
  const notes = (await f.tool("get_task", { id })).data.task.notes;
  assert.equal(notes.match(/## Links/g)?.length, 1);
  assert.match(notes, /## Links\n- PR 57: https:\/\/git\.example\.test\/pr\/57\n- https:\/\/trace\.example\.test\/t\/1\n/);
  const found = await f.tool("find_tasks", { query: "schema_builder" });
  assert.equal(found.data.tasks[0]?.id, id);
  assert.equal(found.data.timezone, "Asia/Kolkata");
});

test("archived projects stay searchable and an empty project name is refused", async (t) => {
  const f = await fixture(t);
  const project = (await f.tool("add_project", { title: "old-repo", description: "Repo: old-repo" })).data.project;
  const id = (await f.tool("add_task", { title: "Legacy cleanup", project: "old-repo" })).data.task.id;
  const p = (await f.vault.snapshot()).projects.find((x) => x.id === project.id)!;
  await f.vault.updateProject(p.id, p.revision, { archived: true });
  const found = await f.tool("find_tasks", { project: "old-repo" });
  assert.equal(found.error, false, found.text);
  assert.equal(found.data.tasks[0].id, id);
  const blank = await f.tool("update_task", { id, project: "" });
  assert.equal(blank.error, true);
  assert.equal((await f.tool("get_task", { id })).data.task.project, "old-repo");
});
