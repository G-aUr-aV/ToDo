import test from "node:test";
import assert from "node:assert/strict";
import { inNow, isLater, byPriority } from "../core/task-views";
import type { Task } from "../core/model";
const today = "2026-11-21";
const task = (patch: Partial<Task>): Task =>
  ({
    id: "a",
    title: "a",
    status: "inbox",
    scheduled: null,
    due: null,
    trashed: false,
    createdAt: "2026-11-01T00:00:00Z",
    ...patch,
  }) as Task;

test("Now holds undated, current and overdue work; Later holds future plans", () => {
  assert.equal(inNow(task({}), today), true);
  assert.equal(inNow(task({ scheduled: today }), today), true);
  assert.equal(inNow(task({ scheduled: "2026-11-19" }), today), true);
  assert.equal(inNow(task({ scheduled: "2026-11-23" }), today), false);
  assert.equal(isLater(task({ scheduled: "2026-11-23" }), today), true);
  assert.equal(isLater(task({}), today), false);
});

test("a future plan date never hides a deadline that is due", () => {
  const due = task({ scheduled: "2026-11-25", due: today });
  assert.equal(inNow(due, today), true);
  assert.equal(isLater(due, today), false);
  const notYet = task({ scheduled: "2026-11-25", due: "2026-11-30" });
  assert.equal(inNow(notYet, today), false);
  assert.equal(isLater(notYet, today), true);
});

test("completed and trashed tasks are in neither list", () => {
  for (const t of [task({ status: "done" }), task({ trashed: true })]) {
    assert.equal(inNow(t, today), false);
    assert.equal(isLater(t, today), false);
  }
});

test("ordering puts deadlines first, then oldest", () => {
  const newer = task({ id: "n", createdAt: "2026-11-10T00:00:00Z" });
  const older = task({ id: "o", createdAt: "2026-11-02T00:00:00Z" });
  const due = task({ id: "d", due: "2026-11-30", createdAt: "2026-11-15T00:00:00Z" });
  assert.deepEqual(
    [newer, older, due].sort(byPriority).map((t) => t.id),
    ["d", "o", "n"],
  );
});
