import { useEffect, useRef, useState } from "react";
import { call } from "./client";
import { Button, errorMessage } from "./components";
import { dueReminders, type ReminderTask } from "./task-time";
import { deliverReminderAlert } from "./reminder-alerts";

export function Reminders({
  tasks,
  vaultKey,
  serverNow,
  onOpen,
  onChanged,
}: {
  tasks: ReminderTask[];
  vaultKey: string;
  serverNow: string;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sent = useRef(new Map<string, string>());
  const clockOffset = useRef(Date.parse(serverNow) - Date.now());
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    clockOffset.current = offset;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now() + offset;
      setNow(current);
      deliverReminderAlert(
        dueReminders(tasks, current),
        vaultKey,
        sent.current,
        onOpen,
      );
      const next = tasks.reduce((soonest, task) => {
        const instant = Date.parse(task.reminder ?? "");
        return instant > current
          ? Math.min(soonest, instant - current)
          : soonest;
      }, 60_000);
      timer = setTimeout(tick, Math.max(1000, next));
    };
    const wake = () => {
      clearTimeout(timer);
      tick();
    };
    tick();
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("todo:notification-permission", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("todo:notification-permission", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [tasks, vaultKey, serverNow, onOpen]);
  const due = dueReminders(tasks, now);
  async function change(task: ReminderTask, minutes: number | null) {
    setBusy(task.id);
    setError("");
    try {
      await call("updateTask", {
        id: task.id,
        revision: task.revision,
        patch: {
          reminder:
            minutes === null
              ? null
              : new Date(
                  Date.now() + clockOffset.current + minutes * 60_000,
                ).toISOString(),
        },
      });
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
      onChanged();
    } finally {
      setBusy(null);
    }
  }
  if (!due.length) return null;
  return (
    <section className="reminders" aria-label="Due reminders">
      <h2 role="status">
        Reminders <span>· {due.length}</span>
      </h2>
      {due.slice(0, 10).map((task) => (
        <div className="reminder-row" key={task.id}>
          <button className="reminder-title" onClick={() => onOpen(task.id)}>
            {task.title}
          </button>
          <div className="reminder-actions">
            <Button
              kind="secondary"
              disabled={!!busy}
              aria-label={`Snooze ${task.title} for 10 minutes`}
              onClick={() => void change(task, 10)}
            >
              10 min
            </Button>
            <Button
              kind="ghost"
              disabled={!!busy}
              aria-label={`Dismiss reminder for ${task.title}`}
              onClick={() => void change(task, null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
      {due.length > 10 && (
        <small>Showing the first 10. Clear one to see the next.</small>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function NotificationPreference() {
  const supported =
    typeof Notification !== "undefined" && window.isSecureContext;
  const [permission, setPermission] = useState(
    supported ? Notification.permission : "unsupported",
  );
  const [error, setError] = useState("");
  return (
    <div className="notification-preference">
      <p>
        Reminders always appear in Todo and Mini. Keep either window open;
        sleeping devices catch up when opened. Browser alerts need HTTPS or
        localhost.
      </p>
      {permission === "default" && (
        <Button
          kind="secondary"
          onClick={async () => {
            try {
              setPermission(await Notification.requestPermission());
              window.dispatchEvent(new Event("todo:notification-permission"));
            } catch {
              setError(
                "Browser alerts are unavailable. In-app reminders still work.",
              );
            }
          }}
        >
          Enable browser alerts
        </Button>
      )}
      <small role="status">
        {permission === "granted"
          ? "Browser alerts are enabled on this device. Your browser and OS may silence them."
          : permission === "denied"
            ? "Browser alerts are blocked. You can allow them in this site's browser settings."
            : permission === "unsupported"
              ? "This browser cannot show system alerts here. In-app reminders are available."
              : "Browser alerts are optional. No permission is needed for in-app reminders."}
      </small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
