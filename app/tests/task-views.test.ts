import test from "node:test";
import assert from "node:assert/strict";
import { inNow, isLater, inToday, inUpcoming, isUnscheduled, byPriority } from "../core/task-views";
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

test("Today includes past plans and urgent deadlines while undated work remains discoverable", () => {
  const scheduled = task({ scheduled: today });
  const past = task({ scheduled: "2026-11-20" });
  const unplanned = task({ due: "2026-11-28" });
  const overdue = task({ scheduled: "2026-11-25", due: "2026-11-20" });
  const dueToday = task({ due: today });
  assert.equal(inToday(scheduled, today), true);
  assert.equal(inToday(past, today), true);
  assert.equal(inToday(unplanned, today), false);
  assert.equal(inToday(overdue, today), true);
  assert.equal(inToday(dueToday, today), true);
  assert.equal(inUpcoming(overdue, today), true);
  assert.equal(inUpcoming(dueToday, today), false);
  assert.equal(isUnscheduled(unplanned), true);
  assert.equal(isUnscheduled(dueToday), true);
  assert.equal(isUnscheduled(scheduled), false);
});

test("planner views exclude done and trashed tasks even when the date matches", () => {
  for (const state of [{ status: "done" as const }, { trashed: true }]) {
    assert.equal(inToday(task({ ...state, scheduled: today }), today), false);
    assert.equal(inUpcoming(task({ ...state, scheduled: "2026-11-24" }), today), false);
    assert.equal(isUnscheduled(task(state)), false);
  }
});
