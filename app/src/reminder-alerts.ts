import { readStored, writeStored } from "./storage";
import type { ReminderTask } from "./task-time";

// One native alert per catch-up batch; in-app reminders remain independent of
// permission and delivery. Keep just the last delivered instant per task.
export function deliverReminderAlert(
  due: ReminderTask[],
  vaultKey: string,
  sent: Map<string, string>,
  onOpen: (id: string) => void,
) {
  const key = (task: ReminderTask) => `todo:reminded:${vaultKey}:${task.id}`;
  const current = new Set(due.map(key));
  for (const saved of sent.keys()) if (!current.has(saved)) sent.delete(saved);
  const pending = due.filter(
    (task) =>
      sent.get(key(task)) !== task.reminder &&
      readStored(key(task)) !== task.reminder,
  );
  if (
    !pending.length ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const notification = new Notification(
      pending.length === 1
        ? "Todo reminder"
        : `${pending.length} Todo reminders`,
      {
        body:
          pending.length === 1
            ? pending[0].title
            : "Tasks need your attention. Open Todo to review your reminders.",
        tag: `todo:${vaultKey}:reminders`,
      },
    );
    notification.onclick = () => {
      window.focus();
      onOpen(pending[0].id);
      notification.close();
    };
    for (const task of pending) {
      sent.set(key(task), task.reminder!);
      writeStored(key(task), task.reminder!);
    }
  } catch {
    /* In-app reminders work when native notifications do not. */
  }
}
