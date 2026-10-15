import { useState, useEffect, useRef, useCallback } from "react";
import type { TodaySnapshot, TodayTask } from "../core/today";
import type { Task } from "../core/model";
import type { SessionInfo } from "../core/protocol";
import { call, subscribe, ClientError } from "./client";
import { Icon, errorMessage } from "./components";
import { readStored } from "./storage";
import { fullHref } from "./mini-window";
import { Reminders } from "./Reminders";
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
export function MiniApp() {
  const [data, setData] = useState<TodaySnapshot | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState("");
  const [undo, setUndo] = useState<{
    id: string;
    revision: string;
    version: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const refreshingAfter = useRef(false);
  const vaultKey = useRef("");
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) {
      refreshingAfter.current = true;
      return inFlight.current;
    }
    const action = async () => {
      if (alive.current) setBusy(true);
      try {
        const session = await call<SessionInfo>("session");
        if (!alive.current) return;
        setAuthenticated(session.authenticated);
        if (!session.authenticated) {
          setData(null);
          setUndo(null);
          setError("");
          return;
        }
        const snapshot = await call<TodaySnapshot>("today");
        if (!alive.current) return;
        if (vaultKey.current && vaultKey.current !== snapshot.vaultKey) {
          setUndo(null);
          setMessage("");
        }
        vaultKey.current = snapshot.vaultKey;
        setData(snapshot);
        setError("");
        setLastUpdate(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof ClientError && e.info.status === 401) {
          setAuthenticated(false);
          setData(null);
          setUndo(null);
        } else
          setError(
            e instanceof ClientError && e.info.code === "OFFLINE"
              ? "The server is unreachable. Reconnect to load today’s tasks."
              : errorMessage(e),
          );
      } finally {
        inFlight.current = null;
        if (alive.current) {
          setBusy(false);
          if (refreshingAfter.current) {
            refreshingAfter.current = false;
            void refresh();
          }
        }
      }
    };
    const promise = action();
    inFlight.current = promise;
    return promise;
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const tick = setInterval(() => void refresh(), 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      clearInterval(tick);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = subscribe(
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 100);
      },
      { events: authenticated === true },
    );
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [authenticated, refresh]);
  useEffect(() => {
    const apply = () => {
      let a: { theme?: string; text?: string; motion?: string } = {};
      try {
        a = JSON.parse(readStored("todo:appearance") ?? "{}");
      } catch {}
      for (const doc of [document]) {
        doc.documentElement.dataset.theme =
          a.theme === "dark" ||
          (a.theme === "system" &&
            matchMedia("(prefers-color-scheme: dark)").matches)
            ? "dark"
            : "light";
        doc.documentElement.dataset.text = a.text ?? "default";
        doc.documentElement.dataset.motion = a.motion ?? "system";
      }
    };
    apply();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);
  async function complete(task: TodayTask) {
    if (pending) return;
    setPending(task.id);
    setMessage("");
    try {
      const result = await call<Task>("updateTask", {
        id: task.id,
        revision: task.revision,
        patch: { status: "done" },
      });
      setData((d) => {
        if (!d) return d;
        const groups = d.groups
          .map((g) => ({
            ...g,
            tasks: g.tasks.filter((t) => t.id !== task.id),
          }))
          .filter((g) => g.tasks.length);
        return {
          ...d,
          groups,
          count: groups.reduce((n, g) => n + g.tasks.length, 0),
        };
      });
      setUndo(
        result.undoVersion
          ? {
              id: result.id,
              revision: result.revision,
              version: result.undoVersion,
            }
          : null,
      );
      setMessage("Task completed.");
      await refresh();
    } catch (e) {
      setMessage(
        e instanceof ClientError && e.info.code === "CONFLICT"
          ? "This task changed. Review the refreshed list before trying again."
          : "Could not confirm this task was saved. Refresh or open the full app before trying again.",
      );
      await refresh();
    } finally {
      setPending(null);
    }
  }
  async function restore() {
    if (!undo || pending) return;
    setPending(undo.id);
    try {
      await call("restore", undo);
      setUndo(null);
      setMessage("Task restored.");
      await refresh();
    } catch (e) {
      setMessage(
        "Could not undo because the task changed or the vault is unavailable. Open the full app to review it.",
      );
      await refresh();
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="mini-app">
      <header className="mini-header">
        <div>
          <h1>Today</h1>
          <p className="mini-caption" aria-live="polite">
            {data
              ? `${data.count} left · ${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(data.today + "T12:00:00Z"))}`
              : authenticated === false
                ? "Your quick reference"
                : "Opening your workspace…"}
          </p>
        </div>
        <div className="mini-actions">
          <a
            className="icon-button"
            aria-label="Open full app"
            title="Open full app"
            href={fullHref()}
          >
            <Icon name="external-link" />
          </a>
        </div>
      </header>
      <main className="mini-list" id="main" aria-busy={busy && data === null}>
        {data && authenticated && <Reminders
          tasks={data.reminders ?? []} vaultKey={data.vaultKey} serverNow={data.now}
          onOpen={(id) => window.location.assign(fullHref(id))}
          onChanged={() => void refresh()} />}
        {error && (
          <div className="mini-warning" role="alert">
            <strong>Could not refresh</strong>
            <p>
              {data
                ? `Showing the last update${lastUpdate ? ` at ${lastUpdate}` : ""}. Check the connection before completing tasks.`
                : error}
            </p>
          </div>
        )}
        {authenticated === false && (
          <div className="mini-empty">
            <Icon name="lock" size={28} />
            <h2>Sign in to see today.</h2>
            <p>
              Use the full app to open your workspace. Mini will refresh when
              you return.
            </p>
            <a className="button secondary" href={fullHref()}>
              Open full app to sign in
            </a>
          </div>
        )}
        {data?.needsAttention ? (
          <a className="mini-attention" href={fullHref()}>
            {data.needsAttention} note
            {data.needsAttention === 1 ? " needs" : "s need"} attention in the
            full app.
          </a>
        ) : null}
        {data?.groups.map((group) => (
          <section className={`mini-group ${group.key}`} key={group.key}>
            <h2>{group.label}</h2>
            {group.tasks.map((task) => (
              <div className="mini-task" key={task.id}>
                <label className="mini-check">
                  <input
                    type="checkbox"
                    aria-label={`Complete ${task.title}`}
                    checked={false}
                    disabled={!!pending || !!error}
                    onChange={() => void complete(task)}
                  />
                </label>
                <a
                  className="mini-task-open"
                  title={task.title}
                  href={fullHref(task.id)}
                >
                  <span className="mini-task-title">{task.title}</span>
                  <span className="mini-task-meta">
                    {[
                      task.project,
                      task.due
                        ? task.due < data.today
                          ? `Deadline ${shortDate(task.due)}`
                          : task.due === data.today
                            ? "Due today"
                            : task.due ===
                                new Date(
                                  Date.parse(data.today + "T12:00:00Z") +
                                    86400000,
                                )
                                  .toISOString()
                                  .slice(0, 10)
                              ? "Due tomorrow"
                              : `Due ${shortDate(task.due)}`
                        : task.scheduled && task.scheduled < data.today
                          ? `Planned ${shortDate(task.scheduled)}`
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Today"}
                  </span>
                </a>
              </div>
            ))}
          </section>
        ))}
        {data && data.count === 0 && !error && (
          <div className="mini-empty">
            <Icon name="circle-check" size={32} tone="brand" />
            <h2>
              {data.needsAttention
                ? "No indexed tasks for today."
                : "Nothing left for today."}
            </h2>
            <p>
              {data.needsAttention
                ? "Review the notes needing attention in the full app before relying on this list."
                : "Your open tasks are all clear here. Enjoy a little breathing room."}
            </p>
            <a className="button ghost" href={fullHref()}>
              Open full app
            </a>
          </div>
        )}
        {!data && authenticated !== false && !error && (
          <p className="mini-loading" role="status">
            Reading today’s tasks…
          </p>
        )}
      </main>
      {message && (
        <div className="mini-notice">
          <span role="status">{message}</span>
          {undo && (
            <button disabled={!!pending} onClick={() => void restore()}>
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              setMessage("");
              setUndo(null);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      <footer className="mini-footer">
        <span title={lastUpdate ? `Updated at ${lastUpdate}` : ""}>
          {pending
            ? "Saving…"
            : error
              ? "Connection interrupted"
              : data
                ? "Connected to server"
                : authenticated === false
                  ? "Sign-in required"
                  : "Connecting…"}
        </span>
        <button
          className="icon-button"
          aria-label="Refresh today"
          title="Refresh today"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" />
        </button>
      </footer>
    </div>
  );
}
