import test from "node:test";
import assert from "node:assert/strict";
import { deliverReminderAlert } from "../src/reminder-alerts";
import type { ReminderTask } from "../src/task-time";

test("native reminder alerts survive permission/failure, group catch-up, and deduplicate a snooze", () => {
  const descriptors = ["Notification", "localStorage"].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const entries = new Map<string, string>();
  const alerts: { title: string; options: NotificationOptions }[] = [];
  let permission = "default";
  let fail = false;
  class TestNotification {
    static get permission() {
      return permission;
    }
    constructor(title: string, options: NotificationOptions) {
      if (fail) throw new TypeError("mobile constructor unavailable");
      alerts.push({ title, options });
    }
  }
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: TestNotification,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    },
  });
  try {
    const due: ReminderTask[] = Array.from({ length: 100 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      revision: "r",
      reminder: "2026-10-14T09:00:00Z",
    }));
    const sent = new Map<string, string>();
    deliverReminderAlert(due, "vault", sent, () => {});
    assert.equal(
      entries.size,
      0,
      "permission pending must not consume delivery",
    );
    permission = "denied";
    deliverReminderAlert(due, "vault", sent, () => {});
    assert.equal(entries.size, 0);
    permission = "granted";
    fail = true;
    deliverReminderAlert(due, "vault", sent, () => {});
    assert.equal(
      entries.size,
      0,
      "constructor failure must not consume delivery",
    );
    fail = false;
    deliverReminderAlert(due, "vault", sent, () => {});
    assert.equal(
      alerts.length,
      1,
      "100 missed reminders produce one catch-up alert",
    );
    assert.equal(alerts[0].title, "100 Todo reminders");
    assert.equal(entries.size, 100);
    deliverReminderAlert(due, "vault", sent, () => {});
    assert.equal(alerts.length, 1);
    const snoozed = { ...due[0], reminder: "2026-10-15T10:00:00Z" };
    deliverReminderAlert([snoozed], "vault", sent, () => {});
    assert.equal(alerts.length, 2);
    assert.equal(alerts[1].options.body, "Task 0");
    assert.equal(
      sent.size,
      1,
      "memory tracks current tasks, not all past reminder instants",
    );
    deliverReminderAlert([snoozed], "vault", new Map(), () => {});
    assert.equal(
      alerts.length,
      2,
      "reload keeps successful delivery deduplication",
    );
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
