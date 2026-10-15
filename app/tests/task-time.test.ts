import test from "node:test";
import assert from "node:assert/strict";
import {
  reminderInput,
  reminderInstant,
  dueReminders,
  completedOn,
} from "../src/task-time";

test("reminders use the vault timezone rather than the browser timezone", () => {
  assert.equal(
    reminderInstant("2026-10-15T09:00", "Asia/Kolkata"),
    "2026-10-15T03:30:00.000Z",
  );
  assert.equal(
    reminderInput("2026-10-15T03:30:00.000Z", "Asia/Kolkata"),
    "2026-10-15T09:00",
  );
  assert.equal(
    reminderInstant("2026-10-15T09:00", "Asia/Kathmandu"),
    "2026-10-15T03:15:00.000Z",
  );
  assert.equal(
    reminderInstant("2026-10-15T00:00", "America/Los_Angeles"),
    "2026-10-15T07:00:00.000Z",
  );
});
test("reminders reject invalid dates and skipped DST times, choose the earlier repeated time", () => {
  assert.equal(reminderInstant("2026-02-30T10:00", "UTC"), null);
  assert.equal(reminderInstant("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(
    reminderInstant("2026-11-01T01:30", "America/New_York"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(reminderInstant("", "UTC"), null);
});
test("due reminders catch up missed alarms and sort instants regardless of written offset", () => {
  const entry = (id: string, reminder: string | null) => ({
    id,
    title: id,
    revision: "r",
    reminder,
  });
  const tasks = [
    entry("later", "2026-10-15T15:00:00Z"),
    entry("offset", "2026-10-15T12:00:00+05:30"),
    entry("old", "2026-10-14T23:30:00Z"),
    entry("none", null),
  ];
  assert.deepEqual(
    dueReminders(tasks, Date.parse("2026-10-15T12:00:00Z")).map((t) => t.id),
    ["old", "offset"],
  );
});
test("progress counts completion on the vault calendar day on both sides of UTC", () => {
  assert.equal(
    completedOn("2026-10-14T20:00:00Z", "2026-10-15", "Asia/Kolkata"),
    true,
  );
  assert.equal(
    completedOn("2026-10-15T02:00:00Z", "2026-10-14", "America/Los_Angeles"),
    true,
  );
  assert.equal(
    completedOn("2026-10-14T17:00:00Z", "2026-10-15", "Asia/Kolkata"),
    false,
  );
  assert.equal(completedOn(null, "2026-10-15", "Asia/Kolkata"), false);
});
