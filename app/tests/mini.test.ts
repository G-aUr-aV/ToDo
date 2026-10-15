import test from "node:test";
import assert from "node:assert/strict";
import { todaySummary } from "../core/today";
import type { Snapshot, Task } from "../core/model";
const task = (id: string, patch: Partial<Task>): Task => ({
  id,
  title: id,
  status: "todo",
  scheduled: null,
  due: null,
  projectId: null,
  project: null,
  focus: false,
  trashed: false,
  notes: "Private note body",
  tags: ["private"],
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
  completedAt: null,
  previousStatus: "todo",
  revision: "a".repeat(64),
  path: `Tasks/${id}.md`,
  reminder: null,
  repeat: null,
  originalScheduled: null,
  rolloverCount: 0,
  lastRolledAt: null,
  recurrenceSourceId: null,
  nextOccurrenceId: null,
  ...patch,
});
test("mini summary uses Today rules, surfaces overdue work and excludes note content", () => {
  const s: Snapshot = {
    vaultKey: "v",
    vaultName: "Vault",
    today: "2026-10-15",
    now: "2026-10-15T12:00:00Z",
    version: "0.1.0",
    preferences: {
      timezone: "Asia/Kolkata",
      weekStartsOn: 1,
      startPage: "today",
      obsidianVault: "private device name",
      autoRollover: true,
    },
    projects: [
      {
        id: "work",
        title: "Work",
        notes: "Private project body",
        archived: true,
        createdAt: "",
        updatedAt: "",
        path: "Projects/work.md",
        revision: "",
      },
    ],
    diagnostics: [],
    tasks: [
      task("focus", {
        scheduled: "2026-10-15",
        focus: true,
        projectId: "work",
      }),
      task("overdue", { due: "2026-10-14", scheduled: "2026-10-20" }),
      task("carry", { scheduled: "2026-10-13" }),
      task("future", { scheduled: "2026-10-16" }),
      task("done", { scheduled: "2026-10-15", status: "done" }),
      task("trashed", { due: "2026-10-15", trashed: true }),
      task("inbox", {}),
    ],
  };
  const result = todaySummary(s);
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.groups.map((g) => g.key),
    ["overdue", "focus", "other"],
  );
  assert.equal(result.groups[1].tasks[0].project, "Work");
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private|private|notes|tags|Tasks\//,
  );
});
