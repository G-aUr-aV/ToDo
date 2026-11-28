import { useCallback, useEffect, useId, useRef, useState } from "react";
import { writeStored } from "./storage";
import { appearanceKey, applyAppearance, readAppearance, type Appearance } from "./appearance";
import type { Task, Project, Snapshot, TaskPatch, Version } from "../core/model";
import { active, inToday, inUpcoming, isUnscheduled, byPriority } from "../core/task-views";
import type { SessionInfo } from "../core/protocol";
import { call, subscribe, ClientError } from "./client";
import { Banner, Button, Empty, Field, Icon, Modal, modifierKey, copyText, errorMessage } from "./components";
import { TaskEditor, form, type CardActions } from "./Editor";
import { Settings } from "./Settings";
import { TrashView } from "./TrashView";
import { shiftDate } from "./DateControl";
import { Reminders } from "./Reminders";
import { TaskRow, QuickAdd, NewProjectInput } from "./TaskList";
import { DoneView } from "./DoneView";
import { Upcoming } from "./Upcoming";
import { Find, KeyboardSheet } from "./Find";
import { Popover, MenuItem } from "./Popover";
import { projectColor } from "./project-color";

type View =
  | "today"
  | "tasks"
  | "upcoming"
  | "done"
  | "trash"
  | "settings"
  | "archived"
  | "history";
const titles: Record<View, string> = {
  today: "Today",
  tasks: "All tasks",
  upcoming: "Upcoming",
  done: "Done",
  trash: "Trash",
  settings: "Settings",
  archived: "Archived projects",
  history: "Earlier versions",
};
const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const taskView = (task: Task, today: string): View =>
  task.trashed ? "trash" : task.status === "done" ? "done" : inToday(task, today) ? "today" : "tasks";
type Undo = () => Promise<void>;
type Settling = { task: Task; phase: "pending" | "leaving" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("today");
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [unscheduled, setUnscheduled] = useState(false);
  const [captureDate, setCaptureDate] = useState<string>();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; kind: "project" | "date" } | null>(null);
  const cardActions = useRef<CardActions | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // Tasks finishing their complete/reopen animation keep their old state on screen.
  const [ghosts, setGhosts] = useState<Map<string, Settling>>(new Map());
  const settling = useRef(new Set<string>());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [undoCompletion, setUndoCompletion] = useState<{ run: Undo } | null>(null);
  const undoing = useRef(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("Saved");
  const [toast, setToast] = useState<{
    id: number;
    text: string;
    undo?: () => Promise<void>;
  } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ task: Task; anchor: HTMLElement } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    kind: "new" | "project";
    anchor: HTMLElement;
  } | null>(null);
  const [find, setFind] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [historyTask, setHistoryTask] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [restore, setRestore] = useState<{ task: Task; version: Version } | null>(null);
  const [archive, setArchive] = useState<Project | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const initialView = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const addInput = useRef<HTMLInputElement>(null);
  const workspaceScroll = useRef<HTMLDivElement>(null);
  const trashHeading = useRef<HTMLHeadingElement>(null);
  const workspaceHeading = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    writeStored(appearanceKey, JSON.stringify(appearance));
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearance(appearance);
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
        initialView.current = true;
        setView(data.preferences.startPage === "done" ? "done" : "today");
        const id = new URLSearchParams(location.search).get("task");
        const task = data.tasks.find((t) => t.id === id);
        if (task) {
          setView(taskView(task, data.today));
          if (!task.trashed) {
            setOpenId(task.id);
            setCursor(task.id);
          }
        }
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
  function notice(text: string, undo?: () => Promise<void>) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3200);
  }
  function go(next: View, project: string | null = null) {
    workspaceScroll.current?.scrollTo({ top: 0 });
    setView(next);
    setFilterProject(project);
    setUnscheduled(false);
    setCaptureDate(undefined);
    setOpenId(null);
    setNotesFor(null);
    setMenuFor(null);
    setCursor(null);
    setMore(false);
  }
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
  }
  function addProject(project: Project) {
    setSnapshot((s) =>
      s && !s.projects.some((p) => p.id === project.id)
        ? { ...s, projects: [...s.projects, project] }
        : s,
    );
    void load();
  }
  async function mutate(
    task: Task,
    patch: TaskPatch,
    message?: string,
    onFailure?: (message: string) => void,
  ) {
    setSaving("Saving…");
    try {
      const result = await call<Task>("updateTask", {
        id: task.id,
        revision: task.revision,
        patch,
      });
      applyTask(result);
      setSaving("Saved");
      if (message) {
        const undo = async () => {
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
          setFresh(restored.id);
          setUndoCompletion((current) => current?.run === undo ? null : current);
          notice("Undone");
          void load();
        };
        if (patch.status === "done") setUndoCompletion({ run: undo });
        notice(message, undo);
      }
      return result;
    } catch (e) {
      setSaving("Changes not saved");
      const conflict = e instanceof ClientError && e.info.code === "CONFLICT";
      const detail = conflict ? "This task changed elsewhere. Review the latest task and retry." : errorMessage(e);
      (onFailure ?? notice)(detail);
      if (conflict) await load();
      return null;
    }
  }
  async function runUndo(undo: Undo) {
    if (undoing.current) return;
    undoing.current = true;
    try {
      await undo();
    } catch (e) {
      notice(errorMessage(e));
    } finally {
      undoing.current = false;
    }
  }
  async function settle(task: Task, patch: TaskPatch, message: string) {
    if (settling.current.has(task.id)) return;
    settling.current.add(task.id);
    setFailed((current) => {
      const next = new Map(current);
      next.delete(task.id);
      return next;
    });
    setGhosts((current) => new Map(current).set(task.id, { task, phase: "pending" }));
    const result = await mutate(task, patch, message, (detail) =>
      setFailed((current) => new Map(current).set(task.id, detail)),
    );
    if (result) {
      setGhosts((current) => new Map(current).set(task.id, { task, phase: "leaving" }));
      if (!reducedMotion()) await wait(155);
      const rows = [...document.querySelectorAll<HTMLElement>(".workspace-scroll [data-task-id]")];
      const index = rows.findIndex((row) => row.dataset.taskId === task.id);
      const row = rows[index];
      if (row?.contains(document.activeElement)) {
        const candidates = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()];
        const next = candidates.find((entry) => entry.dataset.taskId && !settling.current.has(entry.dataset.taskId));
        if (next) setCursor(next.dataset.taskId!);
        else (addInput.current ?? workspaceHeading.current)?.focus({ preventScroll: true });
      }
      setOpenId((id) => id === task.id ? null : id);
    }
    setGhosts((current) => {
      const next = new Map(current);
      next.delete(task.id);
      return next;
    });
    settling.current.delete(task.id);
  }
  const complete = (task: Task) => void settle(task, { status: "done" }, "Completed");
  const reopen = (task: Task) =>
    void settle(task, { status: task.previousStatus }, "Reopened");
  function copyName(task: Task) {
    copyText(task.title)
      .then(() => notice("Copied task name"))
      .catch(() => notice("Copying isn't available in this browser."));
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
      setOpenId(null);
      setUndoCompletion(null);
    } catch (e) {
      notice(errorMessage(e));
    }
  }
  async function history(id: string) {
    setHistoryTask(id);
    go("history");
    try {
      setVersions(await call<Version[]>("versions", { id }));
    } catch (e) {
      notice(errorMessage(e));
    }
  }
  function openTask(task: Task, notes = false) {
    const today = snapshotRef.current?.today ?? "";
    const matchingProject = !task.trashed && task.projectId === filterProject ? filterProject : null;
    const target = taskView(task, today);
    const visible =
      (view === target && view !== "tasks" && (!filterProject || !!matchingProject)) ||
      (active(task) && view === "tasks" && (!filterProject || !!matchingProject) && (!unscheduled || isUnscheduled(task))) ||
      (view === "upcoming" && inUpcoming(task, today));
    if (!visible) go(target, target === "done" ? matchingProject : null);
    setOpenId(task.id);
    setCursor(task.id);
    setMenuFor(null);
    setNotesFor(notes ? task.id : null);
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-task-id="${task.id}"]`);
      if (!notes) row?.querySelector<HTMLElement>(".task-card")?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "instant" : "smooth" });
    });
  }
  // Keyboard: single keys stay out of the way while typing or in a dialog.
  const keyState = useRef({ openId, cursor, view, shortcuts: appearance.shortcuts });
  keyState.current = { openId, cursor, view, shortcuts: appearance.shortcuts };
  useEffect(() => {
    const visibleIds = () =>
      [...document.querySelectorAll<HTMLElement>("[data-task-id]")].map(
        (n) => n.dataset.taskId!,
      );
    const taskById = (id: string | null) =>
      snapshotRef.current?.tasks.find((t) => t.id === id);
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement;
      const typing = target.closest('input,textarea,select,[contenteditable="true"]');
      const layered = document.querySelector('[role=dialog],[role=menu]');
      const k = keyState.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (layered) return;
        e.preventDefault();
        setFind(true);
        return;
      }
      if (e.key === "Escape" && !layered && !typing) {
        if (k.openId) {
          setOpenId(null);
          setNotesFor(null);
          setMenuFor(null);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(`[data-task-id="${k.openId}"] .task-row`)
              ?.focus(),
          );
        } else setCursor(null);
        return;
      }
      if (typing || layered || !k.shortcuts || e.metaKey || e.ctrlKey || e.altKey)
        return;
      if (target.closest("a,button") && e.key === "Enter") return;
      const ids = visibleIds();
      const focusedId = target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      const selectedId = focusedId ?? k.cursor;
      const at = selectedId ? ids.indexOf(selectedId) : -1;
      const current = taskById(k.openId ?? selectedId);
      const move = (delta: number) => {
        if (!ids.length) return;
        e.preventDefault();
        const next = ids[Math.max(0, Math.min(ids.length - 1, at + delta))] ?? null;
        setCursor(next);
        if (k.openId && next && k.openId !== next) {
          setNotesFor(null);
          setMenuFor(null);
          setOpenId(next);
        }
      };
      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          if (addInput.current) addInput.current.focus();
          else {
            go("today");
            requestAnimationFrame(() => addInput.current?.focus());
          }
          break;
        case "?":
          e.preventDefault();
          setKeysOpen(true);
          break;
        case "j":
        case "ArrowDown":
          move(at < 0 ? 0 : 1);
          break;
        case "k":
        case "ArrowUp":
          move(at < 0 ? 0 : -1);
          break;
        case "Enter":
          if (k.cursor) {
            e.preventDefault();
            setOpenId(k.openId === k.cursor ? null : k.cursor);
          }
          break;
        case "x":
          if (current) {
            e.preventDefault();
            // An open card saves its pending edits before completing.
            if (k.openId && cardActions.current) cardActions.current.toggle();
            else if (current.status === "done") reopen(current);
            else complete(current);
          }
          break;
        case "p":
        case "d":
          if (current) {
            e.preventDefault();
            const kind = e.key === "p" ? "project" : "date";
            if (k.openId && cardActions.current) cardActions.current.openMenu(kind);
            else {
              setMenuFor({ id: current.id, kind });
              setCursor(current.id);
              setOpenId(current.id);
            }
          }
          break;
        case "c":
          if (current) {
            e.preventDefault();
            copyName(current);
          }
          break;
        case "e":
          if (current) {
            e.preventDefault();
            if (k.openId && cardActions.current) cardActions.current.editNotes();
            else openTask(current, true);
          }
          break;
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  // Clicking the page outside the open card closes it (its edits still save).
  useEffect(() => {
    if (!openId) return;
    const down = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#main")) return;
      if (
        target.closest(
          ".task-card,.task-row,.popover,[role=dialog],.quick-add,.toast,a,button,input,textarea,select",
        )
      )
        return;
      setOpenId(null);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [openId]);
  useEffect(() => {
    if (!cursor || (openId === cursor && (notesFor === cursor || menuFor?.id === cursor))) return;
    const selector = openId === cursor ? ".task-card" : ".task-row";
    const row = document.querySelector<HTMLElement>(`[data-task-id="${cursor}"] ${selector}`);
    if (row && !row.contains(document.activeElement)) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
    }
  }, [cursor, openId, notesFor, menuFor]);
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(null), 1600);
    return () => clearTimeout(timer);
  }, [fresh]);

  if (!session)
    return (
      <div className="startup">
        <span className="mark large">
          <Icon name="check" size={22} />
        </span>
        <p>{error || "Opening your workspace…"}</p>
        {error && <Button onClick={() => window.location.reload()}>Try again</Button>}
      </div>
    );
  if (!session.authenticated)
    return <StartScreen onSession={signedIn} initialError={error} />;
  if (!snapshot)
    return (
      <div className="startup">
        <span className="mark large">
          <Icon name="check" size={22} />
        </span>
        <h1>{error ? "Your workspace is unavailable" : "Opening your workspace…"}</h1>
        <p>{error || "Reading your task notes."}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  const s = ghosts.size
    ? { ...snapshot, tasks: snapshot.tasks.map((t) => ghosts.get(t.id)?.task ?? t) }
    : snapshot;
  const open = s.tasks.filter(active);
  const activeProjects = s.projects.filter((p) => !p.archived);
  const project = s.projects.find((p) => p.id === filterProject) ?? null;
  const scoped = open.filter((t) => !filterProject || t.projectId === filterProject);
  const todayTasks = open.filter((task) => inToday(task, s.today)).sort(byPriority);
  const upcoming = open.filter((task) => inUpcoming(task, s.today)).sort((a, b) =>
    (a.scheduled ?? "").localeCompare(b.scheduled ?? "") || byPriority(a, b),
  );
  const taskList = view === "today" ? todayTasks : scoped
    .filter((task) => !unscheduled || isUnscheduled(task))
    .sort(byPriority);
  const hasComposer = view === "today" || view === "tasks" || view === "upcoming";
  const defaultScheduled = view === "today" ? s.today :
    view === "upcoming" ? captureDate ?? shiftDate(s.today, 1) : null;
  function focusComposer(date: string) {
    setCaptureDate(date);
    addInput.current?.focus({ preventScroll: true });
  }
  function openUnscheduled() {
    go("tasks");
    setUnscheduled(true);
  }

  const row = (
    task: Task,
    opts: { showProject?: boolean; outcome?: boolean; selection?: { selected: boolean; toggle: () => void } } = {},
  ) => (
    <TaskRow
      key={task.id}
      task={task}
      snapshot={s}
      open={!opts.selection && openId === task.id}
      pending={ghosts.get(task.id)?.phase === "pending"}
      leaving={ghosts.get(task.id)?.phase === "leaving"}
      failure={failed.has(task.id) ? {
        message: failed.get(task.id)!,
        retry: () => {
          if (openId === task.id && cardActions.current) cardActions.current.toggle();
          else if (task.status === "done") reopen(task);
          else complete(task);
        },
      } : undefined}
      fresh={fresh === task.id}
      focused={cursor === task.id}
      {...opts}
      onOpen={() => {
        setCursor(task.id);
        setNotesFor(null);
        setMenuFor(null);
        setOpenId(openId === task.id ? null : task.id);
      }}
      onCheck={() => (task.status === "done" ? reopen(task) : complete(task))}
      onCopy={() => copyName(task)}
      onMenu={(anchor) => setRowMenu({ task, anchor })}
      card={(leading, trailing) => (
        <TaskEditor
          key={task.id}
          task={task}
          snapshot={s}
          onSaved={applyTask}
          onState={setSaving}
          onClose={() => setOpenId(null)}
          onComplete={complete}
          onReopen={reopen}
          onProjectCreated={addProject}
          leading={leading}
          trailing={trailing}
          editNotes={notesFor === task.id}
          initialMenu={menuFor?.id === task.id ? menuFor.kind : null}
          actionsRef={cardActions}
        />
      )}
    />
  );
  const longDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: s.preferences.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(s.now));
  const navButton = (target: View, label: string, icon: string, count?: number) => (
    <button
      className="nav-item"
      aria-current={view === target && !filterProject ? "page" : undefined}
      onClick={() => go(target)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {!!count && <small>{count}</small>}
    </button>
  );
  const projectLinks = activeProjects.map((p) => (
    <button
      key={p.id}
      className="nav-item"
      title={p.title}
      aria-current={filterProject === p.id && view === "tasks" ? "page" : undefined}
      onClick={() => go("tasks", p.id)}
    >
      <span className="swatch" style={{ background: projectColor(p.id) }} />
      <span>{p.title}</span>
      <small>{open.filter((t) => t.projectId === p.id).length || ""}</small>
    </button>
  ));
  const projectHeading = (
    <div className="side-heading">
      <span>Projects</span>
      <button
        className="icon-button"
        aria-label="New project"
        title="New project"
        onClick={(e) => setProjectMenu({ kind: "new", anchor: e.currentTarget })}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
  const workspaceKey = view + (filterProject ?? "");
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="wordmark">
          <span className="mark">
            <Icon name="notebook" size={24} />
          </span>
          Todo
        </div>
        <button className="search-button" onClick={() => setFind(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{modifierKey()}K</kbd>
        </button>
        <nav className="nav-group" aria-label="Task views">
          {navButton("today", "Today", "sun", todayTasks.length)}
          {navButton("tasks", "All tasks", "list-check")}
          {navButton("upcoming", "Upcoming", "calendar-week")}
          {navButton("done", "Done", "circle-check")}
        </nav>
        {projectHeading}
        <nav className="nav-group sidebar-projects" aria-label="Projects">
          {projectLinks}
        </nav>
        <div className="sidebar-footer">
          <nav className="nav-group" aria-label="Workspace tools">
            {navButton("trash", "Trash", "trash")}
            {navButton("settings", "Settings", "settings")}
          </nav>
          <button className="nav-item" onClick={() => setKeysOpen(true)} title="Keyboard shortcuts (?)">
            <Icon name="keyboard" size={17} /><span>Shortcuts</span>
          </button>
          <button className="workspace-status" onClick={() => go("settings")}>
            <i className={error ? "offline" : saving === "Saving…" ? "saving" : ""} />
            <span>{error ? "Connection interrupted" : saving === "Saved" ? "All changes saved" : saving}</span>
          </button>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <WorkspaceHeading headingRef={workspaceHeading}>
          <div className="workspace-title">
            {project && (view === "tasks" || view === "done") ? (
              <ProjectHeader
                key={project.id}
                project={project}
                mode={view}
                onMode={(mode) => go(mode, project.id)}
                onSaved={() => void load()}
                onError={notice}
                onMenu={(anchor) => setProjectMenu({ kind: "project", anchor })}
              />
            ) : (
              <>
                <h1 ref={view === "trash" ? trashHeading : undefined} tabIndex={view === "trash" ? -1 : undefined}>
                  {titles[view]}
                </h1>
                {view === "today" && <time dateTime={s.today}>{longDate}</time>}
              </>
            )}
          </div>
          {project && (view === "tasks" || view === "done") && (
            <ProjectDescription project={project} onSaved={() => void load()} onError={notice} />
          )}
          {hasComposer && (
            <div className="task-queue">
              <QuickAdd
                key={workspaceKey}
                snapshot={s}
                projectId={filterProject}
                defaultScheduled={defaultScheduled}
                inputRef={addInput}
                onCreated={(task) => {
                  applyTask(task);
                  setFresh(task.id);
                }}
                onProjectCreated={addProject}
                onError={notice}
              />
            </div>
          )}
          {view === "tasks" && (
            <div className="planner-filter" role="group" aria-label="Task schedule">
              <button type="button" aria-pressed={!unscheduled} onClick={() => setUnscheduled(false)}>All</button>
              <button type="button" aria-pressed={unscheduled} onClick={() => setUnscheduled(true)}>Unscheduled</button>
            </div>
          )}
          {(view === "today" || view === "tasks") && (
            <p className="planner-count" aria-live="polite">{taskList.length} {taskList.length === 1 ? "task" : "tasks"}</p>
          )}
        </WorkspaceHeading>
        <div
          className={`workspace-scroll${view === "settings" ? " settings-page" : ""}`}
          key={workspaceKey}
          ref={workspaceScroll}
        >
          {error && (
            <Banner title="Connection interrupted">
              <p>{error}</p>
              <Button kind="secondary" onClick={() => void load()}>
                Retry connection
              </Button>
            </Banner>
          )}
          <Reminders
            tasks={open.filter((task) => !!task.reminder)}
            vaultKey={s.vaultKey}
            serverNow={s.now}
            onOpen={(id) => {
              const task = s.tasks.find((value) => value.id === id);
              if (task) openTask(task);
            }}
            onChanged={() => void load()}
          />
          {(view === "today" || view === "tasks") && (
            taskList.length ? (
              <div className="task-ledger planner-ledger">
                {taskList.map((task) => row(task, { showProject: !filterProject }))}
              </div>
            ) : view === "today" ? (
              <Empty
                title="Nothing planned for Today"
                icon="sun"
                action={<Button kind="secondary" onClick={openUnscheduled}>Choose from unscheduled</Button>}
              >
                Add a task or pick something to work on.
              </Empty>
            ) : (
              <Empty icon="inbox" title={unscheduled ? "No unscheduled tasks" : "No open tasks"}>
                {unscheduled ? "Tasks without a plan date appear here." : "Add a task when something comes up."}
              </Empty>
            )
          )}
          {view === "upcoming" && (
            <Upcoming
              tasks={upcoming}
              snapshot={s}
              row={(task, selection) => row(task, { showProject: true, selection })}
              onAdd={focusComposer}
              onMoved={(tasks) => {
                const updated = new Map(tasks.map((task) => [task.id, task]));
                setSnapshot((current) => current && {
                  ...current,
                  tasks: current.tasks.map((task) => updated.get(task.id) ?? task),
                });
                notice(tasks.length === 1 ? "Task moved" : `${tasks.length} tasks moved`);
              }}
              onRefresh={load}
            />
          )}
          {view === "done" && undoCompletion && (
            <Button className="undo-latest" kind="secondary" onClick={() => void runUndo(undoCompletion.run)}>
              Undo last completion
            </Button>
          )}
          {view === "done" && (
            <DoneView
              snapshot={s}
              projectId={filterProject}
              selectedTaskId={openId ?? cursor}
              row={(t) => row(t, { outcome: true, showProject: !filterProject })}
            />
          )}
          {view === "trash" && (
            <TrashView
              snapshot={s}
              onRestore={(task) => mutate(task, { trashed: false }, "Task restored")}
              onRestoredFocus={() => trashHeading.current?.focus({ preventScroll: true })}
              onTasks={() => go("tasks")}
            />
          )}
          {view === "settings" && (
            <Settings
              snapshot={s}
              appearance={appearance}
              setAppearance={setAppearance}
              onSaved={() => void load()}
              onNotice={notice}
              onNavigate={(v) => go(v)}
              onHistory={history}
              onLogout={() => void logout()}
            />
          )}
          {view === "archived" && (
            <>
              <p className="muted lead">
                Archived projects keep their notes and tasks.
              </p>
              {s.projects
                .filter((p) => p.archived)
                .map((p) => (
                  <div className="list-row" key={p.id}>
                    <span className="swatch" style={{ background: projectColor(p.id) }} />
                    <strong>{p.title}</strong>
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
                            notice("Project restored");
                          })
                          .catch((e) => notice(errorMessage(e)))
                      }
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              {!s.projects.some((p) => p.archived) && (
                <Empty title="No archived projects.">
                  Archive a project from its ⋯ menu when the work is over.
                </Empty>
              )}
            </>
          )}
          {view === "history" && (
            <>
              <Field label="Task">
                <select value={historyTask} onChange={(e) => void history(e.target.value)}>
                  <option value="">Choose a task</option>
                  {s.tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </Field>
              {versions.map((v) => (
                <div className="list-row" key={v.id}>
                  <div className="list-text">
                    <strong>{v.title}</strong>
                    <p className="muted">{new Date(v.savedAt).toLocaleString()}</p>
                  </div>
                  <Button
                    kind="secondary"
                    onClick={() => {
                      const task = s.tasks.find((t) => t.id === historyTask);
                      if (task) setRestore({ task, version: v });
                    }}
                  >
                    Review
                  </Button>
                </div>
              ))}
              {historyTask && !versions.length && (
                <Empty title="No earlier versions yet.">
                  Todo keeps the previous version before each successful edit.
                </Empty>
              )}
            </>
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Main navigation">
        <button aria-current={view === "today" ? "page" : undefined} onClick={() => go("today")}>
          <Icon name="sun" size={19} /> Today
        </button>
        <button aria-current={view === "upcoming" ? "page" : undefined} onClick={() => go("upcoming")}>
          <Icon name="calendar-week" size={19} /> Upcoming
        </button>
        <button onClick={() => setFind(true)}><Icon name="search" size={19} /> Search</button>
        <button
          aria-expanded={more}
          aria-current={!["today", "upcoming"].includes(view) ? "page" : undefined}
          onClick={() => setMore(!more)}
        >
          <Icon name="dots" size={19} /> More
        </button>
      </nav>
      {more && (
        <Modal title="More" className="mobile-sheet" onClose={() => setMore(false)}>
          <nav className="nav-group" aria-label="Task views">
            {navButton("tasks", "All tasks", "list-check")}
            {navButton("done", "Done", "circle-check")}
          </nav>
          {projectHeading}
          <nav className="nav-group mobile-projects" aria-label="Projects">{projectLinks}</nav>
          <hr />
          <nav className="nav-group" aria-label="Workspace tools">
            {navButton("trash", "Trash", "trash")}
            {navButton("settings", "Settings", "settings")}
            <button className="nav-item" onClick={() => setKeysOpen(true)}>
              <Icon name="keyboard" size={17} /><span>Shortcuts</span>
            </button>
          </nav>
        </Modal>
      )}
      {toast && (
        <div className="toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const undo = toast.undo!;
                setToast(null);
                void runUndo(undo);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {rowMenu && (
        <Popover anchor={rowMenu.anchor} onClose={() => setRowMenu(null)} label="Task actions" width={220}>
          <MenuItem
            icon="copy"
            hint="C"
            onSelect={() => {
              copyName(rowMenu.task);
              setRowMenu(null);
            }}
          >
            Copy name
          </MenuItem>
          {active(rowMenu.task) && (
            <MenuItem
              icon="calendar-week"
              onSelect={() => {
                const task = rowMenu.task;
                openTask(task);
                if (openId === task.id && cardActions.current) cardActions.current.openMenu("date");
                else setMenuFor({ id: task.id, kind: "date" });
              }}
            >
              Change plan date
            </MenuItem>
          )}
          <MenuItem
            icon="history"
            onSelect={() => {
              void history(rowMenu.task.id);
              setRowMenu(null);
            }}
          >
            Earlier versions
          </MenuItem>
          <MenuItem
            icon="trash"
            danger
            onSelect={() => {
              const task = rowMenu.task;
              setRowMenu(null);
              if (openId === task.id) setOpenId(null);
              void mutate(task, { trashed: true }, "Moved to Trash");
            }}
          >
            Move to Trash
          </MenuItem>
        </Popover>
      )}
      {projectMenu?.kind === "new" && (
        <Popover anchor={projectMenu.anchor} onClose={() => setProjectMenu(null)} label="New project" width={240}>
          <NewProjectInput
            onCreated={(p) => {
              addProject(p);
              setProjectMenu(null);
              go("tasks", p.id);
            }}
            onError={notice}
          />
          <p className="menu-hint">For a repository, use its folder name.</p>
        </Popover>
      )}
      {projectMenu?.kind === "project" && project && (
        <Popover anchor={projectMenu.anchor} onClose={() => setProjectMenu(null)} label="Project actions" width={220}>
          <MenuItem
            icon="archive"
            onSelect={() => {
              setArchive(project);
              setProjectMenu(null);
            }}
          >
            Archive project
          </MenuItem>
        </Popover>
      )}
      {archive && (
        <Modal title={`Archive ${archive.title}?`} onClose={() => setArchive(null)}>
          <p>
            The project leaves the sidebar. Its open tasks still appear in All tasks.
          </p>
          <div className="modal-actions">
            <Button
              onClick={() =>
                void call("updateProject", {
                  id: archive.id,
                  revision: archive.revision,
                  patch: { archived: true },
                })
                  .then(() => {
                    setArchive(null);
                    void load();
                    go("tasks");
                    notice("Project archived");
                  })
                  .catch((e) => notice(errorMessage(e)))
              }
            >
              Archive project
            </Button>
            <Button kind="secondary" onClick={() => setArchive(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
      {restore && (
        <RestorePreview
          task={restore.task}
          version={restore.version}
          onClose={() => setRestore(null)}
          onRestored={(task) => {
            applyTask(task);
            setRestore(null);
            notice("Earlier version restored");
            void history(task.id);
          }}
        />
      )}
      {find && (
        <Find
          snapshot={s}
          onClose={() => setFind(false)}
          onTask={(task) => {
            setFind(false);
            openTask(task);
          }}
          onProject={(p) => {
            setFind(false);
            go("tasks", p.id);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(".edit-project-name, .title-h1")?.focus());
          }}
        />
      )}
      {keysOpen && <KeyboardSheet onClose={() => setKeysOpen(false)} />}
    </div>
  );
}

function WorkspaceHeading({ children, headingRef }: {
  children: React.ReactNode;
  headingRef: React.RefObject<HTMLElement | null>;
}) {
  return <header className="workspace-heading" ref={headingRef} tabIndex={-1}>{children}</header>;
}

function ProjectHeader({
  project,
  mode,
  onMode,
  onSaved,
  onError,
  onMenu,
}: {
  project: Project;
  mode: "tasks" | "done";
  onMode: (mode: "tasks" | "done") => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onMenu: (anchor: HTMLElement) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const nameButton = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  useEffect(() => {
    setTitle(project.title);
    setNameError("");
  }, [project.title]);

  function finishRename() {
    setEditingTitle(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) nameButton.current?.focus({ preventScroll: true });
    });
  }

  async function rename() {
    if (busy) return;
    const name = title.trim();
    if (!name || name === project.title) {
      setTitle(project.title);
      setNameError("");
      finishRename();
      return;
    }
    setBusy(true);
    setNameError("");
    try {
      const updated = await call<Project>("updateProject", {
        id: project.id,
        revision: project.revision,
        patch: { title: name },
      });
      setTitle(updated.title);
      finishRename();
      onSaved();
    } catch (error) {
      if (error instanceof ClientError && error.info.code === "PROJECT_EXISTS") {
        setNameError(error.message);
      } else onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 className="project-title" aria-label={project.title}>
        <span className="swatch" style={{ background: projectColor(project.id) }} />
        {editingTitle ? (
          <input
            className="title-h1"
            aria-label="Project name"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? errorId : undefined}
            aria-busy={busy}
            value={title}
            maxLength={120}
            readOnly={busy}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              setNameError("");
            }}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || busy) return;
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(project.title);
                setNameError("");
                finishRename();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="edit-project-name"
            ref={nameButton}
            aria-label={`Rename ${title}`}
            title={title}
            onClick={() => setEditingTitle(true)}
          >
            <span>{title}</span>
          </button>
        )}
      </h1>
      {nameError && <p className="project-name-error" id={errorId} role="alert">{nameError}</p>}
      <div className="project-header-actions">
        <span className="segmented" role="group" aria-label="Project tasks">
          {(
            [
              ["tasks", "Open"],
              ["done", "Done"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => onMode(value)}
            >
              {label}
            </button>
          ))}
        </span>
        <button className="icon-button" aria-label="Project actions" onClick={(e) => onMenu(e.currentTarget)}>
          <Icon name="dots" />
        </button>
      </div>
    </>
  );
}

function ProjectDescription({ project, onSaved, onError }: {
  project: Project;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(project.notes.trim());
  useEffect(() => {
    if (!editing) setNotes(project.notes.trim());
  }, [project.notes, editing]);

  function save() {
    setEditing(false);
    if (notes === project.notes.trim()) return;
    void call("updateProject", {
      id: project.id,
      revision: project.revision,
      patch: { notes: notes ? "\n" + notes + "\n" : "" },
    }).then(onSaved).catch((error) => onError(errorMessage(error)));
  }

  return (
    <div className="project-description">
      {editing ? (
        <textarea
          className="project-notes"
          aria-label="Project description"
          autoFocus
          rows={Math.min(8, Math.max(2, notes.split("\n").length))}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        />
      ) : (
        <button className="project-description-button" onClick={() => setEditing(true)}>
          {project.notes.trim().split(/\n\s*\n/)[0] || "Add a description — what belongs here?"}
        </button>
      )}
    </div>
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
        <span className="mark large">
          <Icon name="check" size={22} />
        </span>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to your workspace. You'll stay signed in for a week.</p>
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
              autoFocus
            />
          </Field>
          <Button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <p className="signin-help">
            For a new setup, your initial login is saved in the server's private state folder.
          </p>
        </form>
      </div>
    </main>
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
