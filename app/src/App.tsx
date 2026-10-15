import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { readStored, writeStored, removeStored } from "./storage";
import type {
  Task,
  Project,
  Snapshot,
  TaskPatch,
  Version,
} from "../core/model";
import { active, inToday, byPriority, projectFor } from "../core/task-views";
import { dayInZone } from "../core/dates";
import type { SessionInfo } from "../core/protocol";
import { call, subscribe, ClientError } from "./client";
import {
  Banner,
  Button,
  Empty,
  Field,
  Icon,
  Modal,
  errorMessage,
  useNarrow,
} from "./components";
import { TaskEditor, form } from "./Editor";
import { Settings, ImportPage } from "./Settings";
import { DateControl } from "./DateControl";
import { openMini } from "./mini-window";
import { ScheduleFields } from "./ScheduleFields";
import { Reminders } from "./Reminders";
import { completedOn } from "./task-time";

type View =
  | "today"
  | "inbox"
  | "upcoming"
  | "all"
  | "projects"
  | "project"
  | "label"
  | "search"
  | "completed"
  | "trash"
  | "settings"
  | "help"
  | "diagnostics"
  | "archived"
  | "more"
  | "import"
  | "history";
type ModalState = {
  type: "add" | "project" | "actions" | "archive" | "rename" | "restore";
  task?: Task;
  project?: Project;
  version?: Version;
};
const titles: Record<View, string> = {
  today: "Today",
  inbox: "Inbox",
  upcoming: "Upcoming",
  all: "All tasks",
  projects: "Projects",
  project: "Project",
  label: "Label",
  search: "Search",
  completed: "Completed",
  trash: "Trash",
  settings: "Settings",
  help: "A small guide to Todo",
  diagnostics: "Vault status",
  archived: "Archived projects",
  more: "More",
  import: "Review before importing",
  history: "Task versions",
};
function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(readStored(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const modifier = () => (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl");
export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("today");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("Saved");
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState(new Set<string>());
  const [toast, setToast] = useState<{
    text: string;
    undo?: () => Promise<void>;
  } | null>(null);
  const [settingsTab, setSettingsTab] = useState("general");
  const [historyTask, setHistoryTask] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [filterProject, setFilterProject] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [appearance, setAppearance] = useState(() =>
    loadJSON("todo:appearance", {
      theme: "light",
      density: "comfortable",
      text: "default",
      shortcuts: true,
      motion: "system",
    }),
  );
  const narrow = useNarrow();
  const heading = useRef<HTMLHeadingElement>(null);
  const initialView = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    writeStored("todo:appearance", JSON.stringify(appearance));
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance.theme === "system"
          ? system.matches
            ? "dark"
            : "light"
          : appearance.theme;
      document.documentElement.dataset.density = appearance.density;
      document.documentElement.dataset.text = appearance.text;
      document.documentElement.dataset.motion = appearance.motion;
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [appearance]);
  const load = useCallback(async () => {
    try {
      const data = await call<Snapshot>("snapshot");
      setSnapshot(data);
      setError("");
      if (!initialView.current) {
        setView(data.preferences.startPage as View);
        const id = new URLSearchParams(location.search).get("task");
        const task = data.tasks.find((t) => t.id === id);
        if (task) {
          setView("all");
          setSelected(task);
        }
        initialView.current = true;
      }
      if (selectedRef.current) {
        const task = data.tasks.find((t) => t.id === selectedRef.current!.id);
        if (task) setSelected(task);
      }
      return data;
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ClientError && e.info.status === 401) {
        setSession((s) => (s ? { ...s, authenticated: false } : s));
        setSnapshot(null);
      }
      return null;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    call<SessionInfo>("session")
      .then(async (s) => {
        if (!alive) return;
        setSession(s);
        if (s.authenticated) await load();
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const unsubscribe = subscribe(() => void load());
    const tick = setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe();
      clearInterval(tick);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [session?.authenticated, load]);
  function navigate(next: View, id?: string) {
    document.getElementById("main")?.scrollTo({ top: 0 });
    setView(next);
    if (id) setProjectId(id);
    setSelected(null);
    setSelectMode(false);
    setSelection(new Set());
    setSaving("Saved");
  }
  useEffect(() => {
    document.getElementById("main")?.scrollTo({ top: 0 });
    if (view !== "search") heading.current?.focus({ preventScroll: true });
  }, [view]);
  useEffect(() => {
    if (narrow && !selected && view !== "search")
      heading.current?.focus({ preventScroll: true });
  }, [narrow, selected?.id]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      const hasDialog = !!document.querySelector('[role="dialog"]');
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !hasDialog
      ) {
        e.preventDefault();
        navigate("search");
      } else if (
        !editing &&
        !modal &&
        !hasDialog &&
        appearance.shortcuts &&
        e.key.toLowerCase() === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setModal({ type: "add" });
      } else if (e.key === "Escape" && !modal) setSelected(null);
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
    };
  }, [modal, appearance.shortcuts]);
  const notice = (text: string, undo?: () => Promise<void>) =>
    setToast({ text, undo });
  function applyTask(task: Task) {
    setSnapshot((s) =>
      s
        ? {
            ...s,
            tasks: s.tasks.some((t) => t.id === task.id)
              ? s.tasks.map((t) => (t.id === task.id ? task : t))
              : [...s.tasks, task],
          }
        : s,
    );
    if (selectedRef.current?.id === task.id) setSelected(task);
  }
  async function mutate(task: Task, patch: TaskPatch, message?: string) {
    setSaving("Saving…");
    try {
      const result = await call<Task>("updateTask", {
        id: task.id,
        revision: task.revision,
        patch,
      });
      applyTask(result);
      setSaving("Saved");
      if (message)
        notice(message, async () => {
          const restored = result.undoVersion
            ? await call<Task>("restore", {
                id: result.id,
                revision: result.revision,
                version: result.undoVersion,
              })
            : await call<Task>("updateTask", {
                id: result.id,
                revision: result.revision,
                patch: form(task),
              });
          applyTask(restored);
          notice("Change undone.");
        });
      return result;
    } catch (e) {
      setSaving("Changes not saved");
      if (e instanceof ClientError && e.info.code === "CONFLICT") {
        notice(
          "This task changed. The list has refreshed; try the action again.",
        );
        await load();
      } else notice(errorMessage(e));
      return null;
    }
  }
  async function bulk(patch: TaskPatch) {
    let count = 0;
    for (const id of selection) {
      const task = snapshot?.tasks.find((t) => t.id === id);
      if (task && (await mutate(task, patch))) count++;
    }
    notice(`${count} task${count === 1 ? "" : "s"} updated.`);
    setSelectMode(false);
    setSelection(new Set());
  }
  function openObsidian(task: Task) {
    const vault = readStored(`todo:obsidian:${snapshot?.vaultKey}`) ?? "";
    if (!vault) {
      setSettingsTab("vault");
      navigate("settings");
      notice("Set the matching Obsidian vault name for this device first.");
      return;
    }
    const url = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(task.path)}`;
    window.location.assign(url);
  }
  async function signedIn(info: SessionInfo) {
    setSession(info);
    initialView.current = false;
    await load();
  }
  async function logout() {
    if (
      saving !== "Saved" &&
      !window.confirm("Sign out and keep your unsaved draft on this device?")
    )
      return;
    try {
      await call("logout");
      setSession((s) => (s ? { ...s, authenticated: false } : s));
      setSnapshot(null);
      setSelected(null);
    } catch (e) {
      notice(errorMessage(e));
    }
  }
  async function history(id: string) {
    setHistoryTask(id);
    navigate("history");
    try {
      setVersions(await call<Version[]>("versions", { id }));
    } catch (e) {
      notice(errorMessage(e));
    }
  }
  if (!session)
    return (
      <div className="startup">
        <Icon name="leaf" size={36} tone="brand" />
        <h1>Todo</h1>
        <p>{error || "Opening your workspace…"}</p>
        {error && (
          <Button onClick={() => window.location.reload()}>Try again</Button>
        )}
      </div>
    );
  if (!session.authenticated)
    return <StartScreen onSession={signedIn} initialError={error} />;
  if (!snapshot)
    return (
      <div className="startup">
        <Icon name="leaf" size={36} tone="brand" />
        <h1>{error ? "Your vault is unavailable" : "Opening your vault…"}</h1>
        <p>{error || "Reading your task notes."}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  const s = snapshot;
  const open = s.tasks.filter(active);
  const inbox = open.filter((t) => t.status === "inbox");
  const today = open.filter((t) => inToday(t, s.today)).sort(byPriority);
  const project = s.projects.find((p) => p.id === projectId);
  const selectedTask = selected
    ? (s.tasks.find((t) => t.id === selected.id) ?? selected)
    : null;
  const focus = today.filter((t) => t.focus && !(t.due && t.due < s.today));
  const overdue = today.filter((t) => t.due && t.due < s.today);
  const other = today.filter((t) => !focus.includes(t) && !overdue.includes(t));
  const activeProjects = s.projects.filter((p) => !p.archived);
  const allTags = [...new Set(open.flatMap((t) => t.tags))].sort();
  const completedToday = s.tasks.filter(
    (task) =>
      !task.trashed &&
      task.status === "done" &&
      completedOn(task.completedAt, s.today, s.preferences.timezone),
  ).length;
  let pageTitle =
    view === "project"
      ? (project?.title ?? "Project")
      : view === "label"
        ? label
        : titles[view];
  if (narrow && selectedTask) pageTitle = "Task";
  const descriptions: Partial<Record<View, string>> = {
    today: "A little clarity for your day.",
    inbox: "Capture now. Decide when it matters.",
    upcoming: "A realistic plan for the days ahead.",
    all: "Every open task has a home here.",
    projects: "Keep related work and context together.",
    project: "Make room for the important work.",
    completed: "Keep what you have finished within reach.",
    trash: "Restore a task whenever you need it.",
    settings: "Make Todo feel at home.",
  };
  function row(task: Task, meta?: string) {
    const expanded =
      selectedTask?.id === task.id &&
      (view !== "upcoming" || selectedOccurrence === meta);
    const p = projectFor(task, s.projects);
    const dateLabel =
      meta ??
      (task.due
        ? task.due < s.today
          ? "Deadline passed"
          : task.due === s.today
            ? "Due today"
            : task.due === addDays(s.today, 1)
              ? "Due tomorrow"
              : "Due " + shortDate(task.due)
        : task.scheduled && task.scheduled < s.today
          ? "Planned " + shortDate(task.scheduled)
          : "");
    return (
      <Fragment key={task.id}>
        <div
          className={
            "task-row " +
            (task.status === "done" ? "completed" : "") +
            (expanded ? " expanded" : "")
          }
        >
          <label className="checkbox-target">
            <input
              type="checkbox"
              aria-label={`${selectMode ? "Select" : task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
              checked={
                selectMode ? selection.has(task.id) : task.status === "done"
              }
              onChange={() => {
                if (selectMode) {
                  setSelection((old) => {
                    const next = new Set(old);
                    if (next.has(task.id)) next.delete(task.id);
                    else next.add(task.id);
                    return next;
                  });
                } else
                  void mutate(
                    task,
                    {
                      status:
                        task.status === "done" ? task.previousStatus : "done",
                    },
                    task.status === "done"
                      ? "Task reopened."
                      : "Task completed.",
                  );
              }}
            />
          </label>
          <button
            className="task-open"
            onClick={() => {
              setSelectedOccurrence(meta);
              setSelected(expanded ? null : task);
              setSaving("Saved");
            }}
            aria-expanded={expanded}
          >
            <span>
              {task.title}
              {task.repeat && <small className="task-badge">Repeats</small>}
              {task.reminder && <small className="task-badge">Reminder</small>}
            </span>
            {narrow && dateLabel && (
              <small
                className={task.due && task.due < s.today ? "warning-text" : ""}
              >
                {dateLabel}
              </small>
            )}
          </button>
          {p || task.project ? (
            <button
              className="task-project"
              onClick={() =>
                p ? navigate("project", p.id) : setSelected(task)
              }
            >
              {p?.title ?? "Unlinked project"}
            </button>
          ) : (
            <span className="task-project" />
          )}
          <span
            className={
              "task-date " +
              (task.due && task.due < s.today ? "warning-text" : "")
            }
          >
            {dateLabel && (
              <>
                <Icon name="calendar-week" size={16} />
                {dateLabel}
              </>
            )}
          </span>
          <button
            className="icon-button row-menu"
            aria-label={"Actions for " + task.title}
            onClick={() => {
              setSelectedOccurrence(meta);
              setModal({ type: "actions", task });
            }}
          >
            <Icon name="dots" />
          </button>
        </div>
        {expanded && !narrow && (
          <TaskEditor
            key={task.id}
            task={task}
            snapshot={s}
            onSaved={applyTask}
            onState={setSaving}
            onClose={() => setSelected(null)}
            onObsidian={openObsidian}
          />
        )}
      </Fragment>
    );
  }
  function section(title: string, tasks: Task[], meta?: (t: Task) => string) {
    return tasks.length > 0 ? (
      <section className="task-section">
        <h2>{title}</h2>
        {tasks.map((t) => row(t, meta?.(t)))}
      </section>
    ) : null;
  }
  const navItems: [View, string, string][] = [
    ["inbox", "Inbox", "inbox"],
    ["today", "Today", "sun"],
    ["upcoming", "Upcoming", "calendar-week"],
    ["all", "All tasks", "list-check"],
  ];
  const nav = (
    id: View,
    title: string,
    icon: string,
    count?: number,
    extraId?: string,
  ) => (
    <button
      className={
        "nav-item " +
        (view === id && (id !== "project" || projectId === extraId)
          ? "selected"
          : "")
      }
      onClick={() => navigate(id, extraId)}
      aria-current={
        view === id && (id !== "project" || projectId === extraId)
          ? "page"
          : undefined
      }
    >
      <Icon name={icon} tone={view === id ? "brand" : "muted"} />
      <span>{title}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  const searchResults = s.tasks
    .filter(
      (t) =>
        !t.trashed &&
        (includeCompleted || t.status !== "done") &&
        `${t.title}\n${t.notes}\n${t.tags.join(" ")}\n${projectFor(t, s.projects)?.title ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(byPriority);
  const filteredAll = open
    .filter(
      (t) =>
        (!filterProject || t.projectId === filterProject) &&
        (!filterTag || t.tags.includes(filterTag)),
    )
    .sort(byPriority);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to tasks
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="wordmark">
          <Icon name="leaf" size={28} tone="brand" />
          <span>Todo</span>
        </div>
        <button className="search-shortcut" onClick={() => navigate("search")}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{modifier()} K</kbd>
        </button>
        <nav className="primary-nav">
          {navItems.map(([id, title, icon]) => (
            <Fragment key={id}>
              {nav(id, title, icon, id === "inbox" ? inbox.length : undefined)}
            </Fragment>
          ))}
        </nav>
        <div className="nav-divider" />
        <nav className="project-nav">
          {nav("projects", "Projects", "folder")}
          {activeProjects.slice(0, 8).map((p) => (
            <Fragment key={p.id}>
              {nav("project", p.title, "folder", undefined, p.id)}
            </Fragment>
          ))}
          {!activeProjects.length && (
            <button
              className="nav-item"
              onClick={() => setModal({ type: "project" })}
            >
              <Icon name="plus" />
              <span>New project</span>
            </button>
          )}
        </nav>
        <nav className="secondary-nav">
          {nav("completed", "Completed", "circle-check")}
          {nav("trash", "Trash", "trash")}
          {nav("settings", "Settings", "settings")}
        </nav>
        <button
          className="vault-status"
          onClick={() => {
            setSettingsTab("vault");
            navigate("settings");
          }}
        >
          <span>{s.vaultName}</span>
          <small>
            {error
              ? "Connection interrupted"
              : saving === "Saved"
                ? "Saved to vault"
                : saving}
          </small>
        </button>
      </aside>
      <main
        id="main"
        className={"main " + (narrow && selectedTask ? "phone-detail" : "")}
      >
        {!(narrow && selectedTask) && (
          <header
            className={
              "page-header " + (view === "today" ? "today-header" : "")
            }
          >
            {view === "today" && (
              <div className="today-date">
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: s.preferences.timezone,
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date(s.now))}
              </div>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {pageTitle}
            </h1>
            {descriptions[view] && <p>{descriptions[view]}</p>}
            {view === "today" && !narrow && (
              <Button
                kind="ghost"
                className="mini-launch"
                icon="device-desktop"
                onClick={openMini}
              >
                Mini Today
              </Button>
            )}
            {![
              "settings",
              "help",
              "diagnostics",
              "import",
              "history",
              "more",
              "archived",
            ].includes(view) && (
              <Button
                className="page-action"
                icon="plus"
                onClick={() =>
                  setModal({ type: view === "projects" ? "project" : "add" })
                }
              >
                {view === "projects" ? "New project" : "Add task"}
              </Button>
            )}
          </header>
        )}
        {error && (
          <Banner title="Connection interrupted">
            <p>{error}</p>
            <Button kind="secondary" onClick={() => void load()}>
              Retry connection
            </Button>
          </Banner>
        )}
        {s.diagnostics.length > 0 && view !== "diagnostics" && (
          <div className="diagnostic-hint">
            <button onClick={() => navigate("diagnostics")}>
              <Icon name="alert-triangle" size={16} tone="warning" />
              {s.diagnostics.length} note{s.diagnostics.length === 1 ? "" : "s"}{" "}
              need attention
            </button>
          </div>
        )}
        <Reminders
          tasks={open.filter((task) => !!task.reminder)}
          vaultKey={s.vaultKey}
          serverNow={s.now}
          onOpen={(id) => {
            const task = s.tasks.find((value) => value.id === id);
            if (task) {
              navigate("all");
              setSelected(task);
            }
          }}
          onChanged={() => void load()}
        />
        {narrow && selectedTask ? (
          <TaskEditor
            key={selectedTask.id}
            task={selectedTask}
            snapshot={s}
            onSaved={applyTask}
            onState={setSaving}
            onClose={() => setSelected(null)}
            onObsidian={openObsidian}
          />
        ) : (
          <>
            {view === "today" &&
              (today.length ? (
                <>
                  {section("Deadline passed", overdue)}
                  {section("Your focus", focus)}
                  {section(focus.length ? "Other tasks" : "Your tasks", other)}
                </>
              ) : (
                <Empty
                  title="A clear day."
                  action={
                    <Button onClick={() => setModal({ type: "add" })}>
                      Add task
                    </Button>
                  }
                >
                  Add a task when something comes to mind, or choose one from
                  Inbox or a project.
                </Empty>
              ))}
            {view === "today" && completedToday > 0 && (
              <Button kind="ghost" onClick={() => navigate("completed")}>
                Completed today · {completedToday}
              </Button>
            )}
            {view === "inbox" &&
              (inbox.length ? (
                <>
                  <div className="list-toolbar">
                    <Button
                      kind="ghost"
                      onClick={() => {
                        setSelectMode(!selectMode);
                        setSelection(new Set());
                      }}
                    >
                      {selectMode ? "Finish selecting" : "Select tasks"}
                    </Button>
                  </div>
                  {selectMode && (
                    <Banner
                      kind="success"
                      title={`${selection.size} task${selection.size === 1 ? "" : "s"} selected`}
                    >
                      Selection mode is separate from task completion.
                    </Banner>
                  )}
                  {section(
                    `${inbox.length} task${inbox.length === 1 ? "" : "s"} waiting for a decision`,
                    inbox,
                  )}
                  {selectMode && (
                    <div className="bulk-toolbar">
                      <Field label="Plan selected tasks">
                        <input
                          type="date"
                          aria-label="Plan selected tasks"
                          onChange={(e) =>
                            e.target.value &&
                            void bulk({
                              scheduled: e.target.value,
                              status: "todo",
                            })
                          }
                          disabled={!selection.size}
                        />
                      </Field>
                      <Field label="Move to project">
                        <select
                          value=""
                          aria-label="Move selected tasks to project"
                          onChange={(e) =>
                            e.target.value &&
                            void bulk({
                              projectId: e.target.value,
                              status: "todo",
                            })
                          }
                          disabled={!selection.size}
                        >
                          <option value="">Choose project</option>
                          {activeProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Button
                        disabled={!selection.size}
                        onClick={() => void bulk({ status: "todo" })}
                      >
                        Mark ready
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  title="Nothing waiting."
                  icon="inbox"
                  action={
                    <Button onClick={() => setModal({ type: "add" })}>
                      Add task
                    </Button>
                  }
                >
                  Add a task when something comes to mind.
                </Empty>
              ))}
            {view === "upcoming" && (
              <Upcoming tasks={open} today={s.today} row={row} />
            )}
            {view === "all" && (
              <>
                <div className="list-toolbar">
                  <span className="filter-count">Open · {open.length}</span>
                  <select
                    aria-label="Filter by project"
                    value={filterProject}
                    onChange={(e) => setFilterProject(e.target.value)}
                  >
                    <option value="">Project: All</option>
                    {s.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by label"
                    value={filterTag}
                    onChange={(e) => setFilterTag(e.target.value)}
                  >
                    <option value="">Label: All</option>
                    {allTags.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                {filteredAll.length ? (
                  section(`${filteredAll.length} open tasks`, filteredAll)
                ) : (
                  <Empty title="No open tasks." icon="list-check">
                    Add your first task or change the filters.
                  </Empty>
                )}
              </>
            )}
            {(view === "projects" || view === "archived") && (
              <>
                {view === "archived" && (
                  <p className="muted">
                    Project notes and tasks stay in the vault when a project is
                    archived.
                  </p>
                )}
                {s.projects
                  .filter((p) => p.archived === (view === "archived"))
                  .map((p) => (
                    <div className="project-row" key={p.id}>
                      <Icon name="folder" size={28} tone="brand" />
                      <button
                        className="project-open"
                        onClick={() => navigate("project", p.id)}
                      >
                        <strong>{p.title}</strong>
                        <span>
                          {p.notes.trim().split("\n")[0] ||
                            "Keep related work and context together."}
                        </span>
                      </button>
                      <span className="muted">
                        {open.filter((t) => t.projectId === p.id).length} open
                        tasks
                      </span>
                      {view === "archived" ? (
                        <Button
                          kind="secondary"
                          onClick={() =>
                            void call("updateProject", {
                              id: p.id,
                              revision: p.revision,
                              patch: { archived: false },
                            })
                              .then(() => {
                                void load();
                                notice("Project restored.");
                              })
                              .catch((e) => notice(errorMessage(e)))
                          }
                        >
                          Restore project
                        </Button>
                      ) : (
                        <button
                          className="icon-button"
                          aria-label={"Open " + p.title}
                          onClick={() => navigate("project", p.id)}
                        >
                          <Icon name="chevron-right" />
                        </button>
                      )}
                    </div>
                  ))}
                {!s.projects.some(
                  (p) => p.archived === (view === "archived"),
                ) && (
                  <Empty
                    title={
                      view === "archived"
                        ? "No archived projects."
                        : "Make room for a project."
                    }
                    icon="folder"
                    action={
                      view === "projects" ? (
                        <Button onClick={() => setModal({ type: "project" })}>
                          Create project
                        </Button>
                      ) : undefined
                    }
                  >
                    Keep related tasks and notes together when a simple list is
                    not enough.
                  </Empty>
                )}
                <Button
                  kind="ghost"
                  onClick={() =>
                    navigate(view === "archived" ? "projects" : "archived")
                  }
                >
                  {view === "archived"
                    ? "Back to active projects"
                    : "View archived projects"}
                </Button>
              </>
            )}
            {view === "project" && project && (
              <>
                <ProjectNotes
                  project={project}
                  onSaved={() => void load()}
                  onError={notice}
                />
                {section(
                  "Tasks",
                  open
                    .filter((t) => t.projectId === project.id)
                    .sort(byPriority),
                )}
                {!open.some((t) => t.projectId === project.id) && (
                  <Empty
                    title="A little room to start."
                    icon="folder"
                    action={
                      <Button onClick={() => setModal({ type: "add" })}>
                        Add a task
                      </Button>
                    }
                  >
                    Capture the next step for this project.
                  </Empty>
                )}
                <Button
                  kind="ghost"
                  onClick={() => setModal({ type: "archive", project })}
                >
                  {project.archived ? "Restore project" : "Archive project"}
                </Button>
              </>
            )}
            {view === "label" &&
              section(
                `${label} · ${open.filter((t) => t.tags.includes(label)).length} matching tasks`,
                open.filter((t) => t.tags.includes(label)),
              )}
            {view === "search" && (
              <>
                <Field label="Search tasks, notes and projects">
                  <input
                    autoFocus
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your workspace"
                  />
                </Field>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={includeCompleted}
                    onChange={(e) => setIncludeCompleted(e.target.checked)}
                  />
                  Include completed tasks
                </label>
                {query ? (
                  searchResults.length ? (
                    section(
                      `${searchResults.length} task${searchResults.length === 1 ? "" : "s"} found`,
                      searchResults,
                    )
                  ) : (
                    <Empty
                      title="No tasks found."
                      icon="search"
                      action={
                        <Button kind="secondary" onClick={() => setQuery("")}>
                          Clear search
                        </Button>
                      }
                    >
                      Try a shorter query or include completed tasks.
                    </Empty>
                  )
                ) : (
                  <p className="muted">
                    Search titles, notes, project names and labels.
                  </p>
                )}
                {query &&
                  s.projects
                    .filter((p) =>
                      (p.title + " " + p.notes)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((p) => (
                      <Button
                        kind="ghost"
                        icon="folder"
                        key={p.id}
                        onClick={() => navigate("project", p.id)}
                      >
                        {p.title}
                      </Button>
                    ))}
                {allTags.length > 0 && (
                  <div className="label-links">
                    <span>Labels</span>
                    {allTags.map((t) => (
                      <Button
                        key={t}
                        kind="ghost"
                        onClick={() => {
                          setLabel(t);
                          navigate("label");
                        }}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
            {view === "completed" &&
              (s.tasks.some((t) => !t.trashed && t.status === "done") ? (
                section(
                  "Completed tasks",
                  s.tasks
                    .filter((t) => !t.trashed && t.status === "done")
                    .sort((a, b) =>
                      (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
                    ),
                  (t) =>
                    t.completedAt
                      ? "Completed " +
                        shortDate(
                          dayInZone(
                            new Date(t.completedAt),
                            s.preferences.timezone,
                          ),
                        )
                      : "Completed",
                )
              ) : (
                <Empty title="Your progress will be here." icon="circle-check">
                  Completed tasks stay in the vault and can be reopened.
                </Empty>
              ))}
            {view === "trash" && (
              <>
                <Banner title="Your notes are kept" kind="success">
                  Trashed tasks stay in the vault and can be restored here.
                </Banner>
                {s.tasks
                  .filter((t) => t.trashed)
                  .map((t) => (
                    <div className="trash-row" key={t.id}>
                      {row(t)}
                      <Button
                        kind="secondary"
                        onClick={() =>
                          void mutate(t, { trashed: false }, "Task restored.")
                        }
                      >
                        Restore task
                      </Button>
                    </div>
                  ))}
                {!s.tasks.some((t) => t.trashed) && (
                  <Empty title="Nothing in Trash." icon="trash">
                    Removed tasks can be restored here. Notes are never
                    automatically deleted.
                  </Empty>
                )}
              </>
            )}
            {view === "settings" && (
              <Settings
                snapshot={s}
                tab={settingsTab}
                setTab={setSettingsTab}
                appearance={appearance}
                setAppearance={setAppearance}
                onSaved={() => void load()}
                onNotice={notice}
                onNavigate={navigate}
                onHistory={history}
                onLogout={() => void logout()}
              />
            )}
            {view === "more" && (
              <div className="more-menu">
                <button onClick={openMini}>
                  <Icon name="device-desktop" />
                  <span>Mini Today</span>
                  <Icon name="chevron-right" />
                </button>
                {(
                  [
                    "search",
                    "all",
                    "projects",
                    "completed",
                    "trash",
                    "settings",
                    "help",
                  ] as View[]
                ).map((v) => (
                  <button key={v} onClick={() => navigate(v)}>
                    <Icon
                      name={
                        {
                          search: "search",
                          all: "list-check",
                          projects: "folder",
                          completed: "circle-check",
                          trash: "trash",
                          settings: "settings",
                          help: "help-circle",
                        }[v as "search"]
                      }
                    />
                    <span>{titles[v]}</span>
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            )}
            {view === "help" && <Help />}
            {view === "diagnostics" && (
              <>
                <Banner
                  title="Vault status"
                  kind={s.diagnostics.length ? "warning" : "success"}
                >
                  {s.diagnostics.length
                    ? `${s.diagnostics.length} notes need attention. Their files are preserved.`
                    : `${open.length} open tasks, ${s.tasks.filter((t) => t.status === "done" && !t.trashed).length} completed and ${s.tasks.filter((t) => t.trashed).length} in Trash.`}
                </Banner>
                {s.diagnostics.map((d) => (
                  <div className="diagnostic-row" key={d.id}>
                    <div>
                      <strong>{d.path}</strong>
                      <p>{d.message}</p>
                    </div>
                    {d.adoptable && (
                      <Button
                        kind="secondary"
                        onClick={() =>
                          void call("adopt", { id: d.id, revision: d.revision })
                            .then(() => {
                              void load();
                              notice("Task note adopted.");
                            })
                            .catch((e) => notice(errorMessage(e)))
                        }
                      >
                        Adopt note
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  kind="secondary"
                  icon="refresh"
                  onClick={() => void load()}
                >
                  Rescan vault
                </Button>
              </>
            )}
            {view === "import" && (
              <ImportPage
                onImported={() => {
                  void load();
                  navigate("inbox");
                  notice("Task notes imported.");
                }}
              />
            )}
            {view === "history" && (
              <>
                <Field label="Task">
                  <select
                    value={historyTask}
                    onChange={(e) => void history(e.target.value)}
                  >
                    <option value="">Choose a task</option>
                    {s.tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </Field>
                {versions.map((v) => (
                  <div className="version-row" key={v.id}>
                    <div>
                      <strong>{v.title}</strong>
                      <span>{new Date(v.savedAt).toLocaleString()}</span>
                    </div>
                    <Button
                      kind="secondary"
                      onClick={() =>
                        setModal({
                          type: "restore",
                          task: s.tasks.find((t) => t.id === historyTask),
                          version: v,
                        })
                      }
                    >
                      Review version
                    </Button>
                  </div>
                ))}
                {!versions.length && (
                  <Empty title="No earlier versions yet." icon="history">
                    The app keeps the previous note before each successful edit.
                  </Empty>
                )}
              </>
            )}
          </>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Main navigation">
        {(["today", "inbox", "upcoming", "more"] as View[]).map((v) => (
          <button
            key={v}
            aria-current={
              view === v ||
              (v === "more" && !["today", "inbox", "upcoming"].includes(view))
                ? "page"
                : undefined
            }
            className={
              view === v ||
              (v === "more" &&
                [
                  "settings",
                  "projects",
                  "search",
                  "help",
                  "completed",
                  "trash",
                  "diagnostics",
                  "history",
                  "archived",
                  "import",
                ].includes(view))
                ? "selected"
                : ""
            }
            onClick={() => navigate(v)}
          >
            {titles[v]}
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast">
          <span role="status">{toast.text}</span>
          {toast.undo && (
            <Button
              kind="ghost"
              onClick={() =>
                void toast.undo!().catch((e) => notice(errorMessage(e)))
              }
            >
              Undo
            </Button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <Icon name="x" />
          </button>
        </div>
      )}
      {modal?.type === "add" && (
        <Composer
          snapshot={s}
          defaultProject={view === "project" ? projectId : null}
          onClose={() => setModal(null)}
          onCreated={(task) => {
            applyTask(task);
            setModal(null);
            notice(
              "Task saved to " +
                (task.status === "inbox" ? "Inbox" : "your vault") +
                ".",
            );
          }}
        />
      )}
      {modal?.type === "project" && (
        <NewProject
          onClose={() => setModal(null)}
          onCreated={(p) => {
            void load();
            setModal(null);
            navigate("project", p.id);
            notice("Project created.");
          }}
        />
      )}
      {modal?.type === "rename" && modal.task && (
        <Rename
          task={modal.task}
          onClose={() => setModal(null)}
          onSave={(title) =>
            void mutate(modal.task!, { title }, "Task renamed.").then(
              (result) => {
                if (result) setModal(null);
              },
            )
          }
        />
      )}
      {modal?.type === "actions" && modal.task && (
        <Modal title="Task actions" onClose={() => setModal(null)}>
          <div className="action-menu">
            <Button
              kind="ghost"
              onClick={() => {
                setSelected(modal.task!);
                setModal(null);
              }}
            >
              Open details
            </Button>
            <Button
              kind="ghost"
              onClick={() => setModal({ type: "rename", task: modal.task })}
            >
              Rename task
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                setSelected(modal.task!);
                setModal(null);
              }}
            >
              Plan for / deadline / project
            </Button>
            <Button
              kind="ghost"
              onClick={() =>
                void mutate(modal.task!, { focus: !modal.task!.focus }).then(
                  () => setModal(null),
                )
              }
            >
              {modal.task.focus ? "Remove from focus" : "Mark as focus"}
            </Button>
            {modal.task.status === "inbox" && (
              <Button
                kind="ghost"
                onClick={() =>
                  void mutate(
                    modal.task!,
                    { status: "todo" },
                    "Task marked ready.",
                  ).then(() => setModal(null))
                }
              >
                Mark ready
              </Button>
            )}
            <Button
              kind="ghost"
              onClick={() => {
                void history(modal.task!.id);
                setModal(null);
              }}
            >
              View earlier versions
            </Button>
            <Button
              kind={modal.task.trashed ? "secondary" : "danger"}
              onClick={() =>
                void mutate(
                  modal.task!,
                  { trashed: !modal.task!.trashed },
                  modal.task!.trashed
                    ? "Task restored."
                    : "Task moved to Trash.",
                ).then(() => {
                  setModal(null);
                  setSelected(null);
                })
              }
            >
              {modal.task.trashed ? "Restore task" : "Move to Trash"}
            </Button>
          </div>
        </Modal>
      )}
      {modal?.type === "archive" && modal.project && (
        <Modal
          title={`${modal.project.archived ? "Restore" : "Archive"} ${modal.project.title}?`}
          onClose={() => setModal(null)}
        >
          <p>
            {modal.project.archived
              ? "This project returns to the active list."
              : "The project leaves the active list. Its tasks and notes stay in the vault. Dated tasks remain in Today and Upcoming."}
          </p>
          <p className="muted">
            Restore archived projects from Projects → Archived.
          </p>
          <div className="modal-actions">
            <Button kind="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void call("updateProject", {
                  id: modal.project!.id,
                  revision: modal.project!.revision,
                  patch: { archived: !modal.project!.archived },
                })
                  .then(() => {
                    setModal(null);
                    void load();
                    navigate(modal.project!.archived ? "projects" : "archived");
                    notice("Project updated.");
                  })
                  .catch((e) => notice(errorMessage(e)))
              }
            >
              {modal.project.archived ? "Restore project" : "Archive project"}
            </Button>
          </div>
        </Modal>
      )}
      {modal?.type === "restore" && modal.task && modal.version && (
        <RestorePreview
          task={modal.task}
          version={modal.version}
          onClose={() => setModal(null)}
          onRestored={(task) => {
            applyTask(task);
            setModal(null);
            notice("Earlier version restored.");
            void history(task.id);
          }}
        />
      )}
    </div>
  );
}

export function addDays(date: string, amount: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
function Upcoming({
  tasks,
  today,
  row,
}: {
  tasks: Task[];
  today: string;
  row: (t: Task, meta?: string) => React.ReactNode;
}) {
  const agenda = new Map<
    string,
    Map<string, { task: Task; planned: boolean; due: boolean }>
  >();
  for (const task of tasks)
    for (const [kind, date] of [
      ["planned", task.scheduled],
      ["due", task.due],
    ] as const) {
      if (!date || date <= today) continue;
      const items = agenda.get(date) ?? new Map();
      const item = items.get(task.id) ?? { task, planned: false, due: false };
      item[kind] = true;
      items.set(task.id, item);
      agenda.set(date, items);
    }
  return (
    <>
      <p className="agenda-explainer">
        Plan dates and deadlines are shown separately. A deadline can appear
        even when work was planned earlier.
      </p>
      {[...agenda]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, items]) => (
          <section className="task-section" key={date}>
            <h2>
              {date === addDays(today, 1) ? "Tomorrow · " : ""}
              {new Intl.DateTimeFormat("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h2>
            {[...items.values()].map(({ task, planned, due }) => (
              <Fragment key={task.id}>
                {row(
                  task,
                  planned && due
                    ? "Plan & deadline"
                    : due
                      ? "Deadline " + shortDate(date)
                      : "Plan for " + shortDate(date),
                )}
              </Fragment>
            ))}
          </section>
        ))}
      {!agenda.size && (
        <Empty title="A little space ahead." icon="calendar-week">
          Plan a task for a future date. Deadlines will also appear here.
        </Empty>
      )}
    </>
  );
}
function StartScreen({
  onSession,
  initialError,
}: {
  onSession: (session: SessionInfo) => Promise<void>;
  initialError: string;
}) {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  return (
    <main className="start-page">
      <div className="start-card">
        <div className="wordmark">
          <Icon name="leaf" size={28} tone="brand" />
          <span>Todo</span>
        </div>
        <h1>Welcome back</h1>
        <p>
          Sign in to your self-hosted workspace. Your tasks live in its Obsidian
          vault.
        </p>
        {error && (
          <Banner title="Could not sign in" kind="danger">
            {error}
          </Banner>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void call<SessionInfo>("login", { username, password })
              .then(async (info) => {
                setPassword("");
                await onSession(info);
              })
              .catch((error) => setError(errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Username">
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <p className="signin-help">
            For a new setup, your initial login is saved in the server’s private
            state folder.
          </p>
        </form>
      </div>
    </main>
  );
}
function Composer({
  snapshot,
  defaultProject,
  onClose,
  onCreated,
}: {
  snapshot: Snapshot;
  defaultProject: string | null;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const key = "todo:composer:" + snapshot.vaultKey;
  const [draft, setDraft] = useState(() =>
    loadJSON(key, {
      requestId: crypto.randomUUID(),
      title: "",
      scheduled: "",
      due: "",
      reminder: null as string | null,
      repeat: null as TaskPatch["repeat"],
      projectId: defaultProject ?? "",
      notes: "",
    }),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (
      draft.title ||
      draft.notes ||
      draft.scheduled ||
      draft.due ||
      draft.reminder ||
      draft.repeat
    )
      setDraftOnDevice(writeStored(key, JSON.stringify(draft)));
  }, [draft, key]);
  const [draftOnDevice, setDraftOnDevice] = useState(true);
  return (
    <Modal
      title="Add task"
      onClose={() => {
        if (!busy) onClose();
      }}
      closeDisabled={busy}
    >
      {!draftOnDevice && (
        <Banner title="Draft storage is unavailable">
          Keep this page open until saved, or copy your notes before closing.
        </Banner>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.title.trim()) {
            setError("Enter a task name.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const task = await call<Task>("createTask", {
              ...draft,
              scheduled: draft.scheduled || null,
              due: draft.due || null,
              projectId: draft.projectId || null,
            });
            removeStored(key);
            onCreated(task);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="composer-fields" disabled={busy}>
          <Field label="Task name">
            <input
              autoFocus
              value={draft.title}
              maxLength={240}
              aria-invalid={!!error && !draft.title.trim()}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                setError("");
              }}
            />
          </Field>
          <Field label="Plan for">
            <DateControl
              value={draft.scheduled || null}
              today={snapshot.today}
              weekStartsOn={snapshot.preferences.weekStartsOn}
              onChange={(value) =>
                setDraft({ ...draft, scheduled: value ?? "" })
              }
            />
          </Field>
          <Field label="Deadline">
            <DateControl
              kind="deadline"
              value={draft.due || null}
              today={snapshot.today}
              weekStartsOn={snapshot.preferences.weekStartsOn}
              onChange={(value) => setDraft({ ...draft, due: value ?? "" })}
            />
          </Field>
          <Field label="Project">
            <select
              value={draft.projectId}
              onChange={(e) =>
                setDraft({ ...draft, projectId: e.target.value })
              }
            >
              <option value="">No project</option>
              {snapshot.projects
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
          <ScheduleFields
            reminder={draft.reminder ?? null}
            repeat={draft.repeat ?? null}
            timezone={snapshot.preferences.timezone}
            disabled={busy}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />
          {draft.scheduled && draft.due && draft.scheduled > draft.due && (
            <p className="date-warning">
              This planned date is after the deadline. The deadline stays
              unchanged.
            </p>
          )}
          <p className="muted">
            Only the title is required. Unplanned tasks go to Inbox.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button kind="secondary" type="button" onClick={onClose}>
              Keep draft
            </Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save task"}</Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function NewProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useRef(crypto.randomUUID());
  return (
    <Modal title="New project" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onCreated(
              await call<Project>("createProject", {
                requestId: id.current,
                title,
                notes,
              }),
            );
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Project name">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Short description">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy || !title.trim()}>Create project</Button>
      </form>
    </Modal>
  );
}
function Rename({
  task,
  onClose,
  onSave,
}: {
  task: Task;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  return (
    <Modal title="Rename task" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onSave(title.trim());
        }}
      >
        <Field label="Task name">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={240}
          />
        </Field>
        <Button disabled={!title.trim()}>Save name</Button>
      </form>
    </Modal>
  );
}
function RestorePreview({
  task,
  version,
  onClose,
  onRestored,
}: {
  task: Task;
  version: Version;
  onClose: () => void;
  onRestored: (t: Task) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Restore an earlier version" onClose={onClose} wide>
      <Banner title="Review before replacing the note">
        The current note is copied before this earlier version is restored.
      </Banner>
      <div className="comparison">
        <div>
          <strong>Current note</strong>
          <pre>{task.notes}</pre>
        </div>
        <div>
          <strong>Earlier version</strong>
          <pre>{version.notes}</pre>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void call<Task>("restore", {
              id: task.id,
              revision: task.revision,
              version: version.id,
            })
              .then(onRestored)
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          Restore this version
        </Button>
        <Button kind="secondary" onClick={onClose}>
          Keep current note
        </Button>
      </div>
    </Modal>
  );
}
function ProjectNotes({
  project,
  onSaved,
  onError,
}: {
  project: Project;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(project.notes);
  useEffect(() => {
    if (!editing) setNotes(project.notes);
  }, [project.notes, editing]);
  return (
    <section className="project-notes">
      <h2>Project notes</h2>
      {editing ? (
        <>
          <textarea
            aria-label="Project notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            onClick={() =>
              void call("updateProject", {
                id: project.id,
                revision: project.revision,
                patch: { notes },
              })
                .then(() => {
                  setEditing(false);
                  onSaved();
                })
                .catch((e) => onError(errorMessage(e)))
            }
          >
            Save project notes
          </Button>
          <Button kind="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <button className="note-content" onClick={() => setEditing(true)}>
          {project.notes.trim() || "Add context for this project…"}
        </button>
      )}
    </section>
  );
}
function Help() {
  return (
    <div className="help-page">
      {[
        [
          "Mini Today",
          "See what's left today in a small view. Complete tasks with Undo, or open a title in the full workspace. Install Mini as a separate Chrome app window for quick reference.",
        ],
        [
          "Use Todo as a web app",
          "In Chrome, choose menu → Cast, save, and share → Install page as app. Open Mini Today first to install Todo Mini separately. The same self-hosted sign-in is used. Keep the server running; offline writes are not queued.",
        ],
        [
          "Capture without sorting",
          "Add a title to Inbox. Plan it when you have more context.",
        ],
        [
          "Plan for is not a deadline",
          "Moving a planned date leaves the deadline unchanged.",
        ],
        [
          "Unfinished tasks carry forward",
          "With automatic rollover enabled, unfinished planned tasks move to today at midnight in your vault timezone, or when the server starts again. Deadlines stay fixed. The first planned date and carry-forward count stay in the Markdown note.",
        ],
        [
          "Reminders and repeating tasks",
          "Set a reminder in task details and keep Todo or Mini open. Overdue reminders stay visible until dismissed, snoozed or completed. Browser alerts are optional in Settings. Daily, weekly and monthly repeats create the next task when you complete this one; missed dates are skipped.",
        ],
        [
          "Your notes stay yours",
          "Each task is a Markdown note. Open the vault folder in Obsidian to read and edit it.",
        ],
        [
          "When another editor changes a task",
          "If a vault note changes while you edit, saving pauses and keeps your draft. Copy it if needed, then discard the draft to load the latest note.",
        ],
        [
          "Keep a separate backup",
          "Task versions do not replace an entire-vault backup. Back up your vault and state folders.",
        ],
        [
          "Keyboard guide",
          "Ctrl/Command+K opens search. N adds a task when you are not typing. Tab reaches controls, Enter activates them, and Escape closes dialogs. Turn single-key shortcuts off in Settings.",
        ],
      ].map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
    </div>
  );
}
