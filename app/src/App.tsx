import { useCallback, useEffect, useRef, useState } from "react";
import { readStored, writeStored } from "./storage";
import { appearanceKey, applyAppearance, readAppearance, type Appearance } from "./appearance";
import type { Task, Project, Snapshot, TaskPatch, Version } from "../core/model";
import { active, inNow, isLater, byPriority } from "../core/task-views";
import type { SessionInfo } from "../core/protocol";
import { call, subscribe, ClientError } from "./client";
import { Banner, Button, Empty, Field, Icon, Modal, modifierKey, copyText, errorMessage } from "./components";
import { TaskEditor, form, type CardActions } from "./Editor";
import { Settings, ImportPage } from "./Settings";
import { dateLabel } from "./DateControl";
import { openMini } from "./mini-window";
import { Reminders } from "./Reminders";
import { TaskRow, QuickAdd, NewProjectInput, RichTitle } from "./TaskList";
import { DoneView, RecentCompletions } from "./DoneView";
import { Find, KeyboardSheet } from "./Find";
import { Popover, MenuItem } from "./Popover";
import { projectColor } from "./project-color";

type View =
  | "tasks"
  | "done"
  | "trash"
  | "settings"
  | "archived"
  | "diagnostics"
  | "import"
  | "history";
const titles: Record<View, string> = {
  tasks: "Tasks",
  done: "Done",
  trash: "Trash",
  settings: "Settings",
  archived: "Archived projects",
  diagnostics: "Vault status",
  import: "Import task notes",
  history: "Earlier versions",
};
const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("tasks");
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; kind: "project" | "date" } | null>(null);
  const cardActions = useRef<CardActions | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // Tasks finishing their complete/reopen animation keep their old state on screen.
  const [ghosts, setGhosts] = useState<Map<string, Task>>(new Map());
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
        setView(data.preferences.startPage === "done" ? "done" : "tasks");
        const id = new URLSearchParams(location.search).get("task");
        const task = data.tasks.find((t) => t.id === id);
        if (task) {
          setView(task.status === "done" ? "done" : "tasks");
          setOpenId(task.id);
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
    document.getElementById("main")?.scrollTo({ top: 0 });
    setView(next);
    setFilterProject(project);
    setOpenId(null);
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
          setFresh(restored.id);
          notice("Undone.");
          void load();
        });
      return result;
    } catch (e) {
      setSaving("Changes not saved");
      if (e instanceof ClientError && e.info.code === "CONFLICT") {
        notice("This task changed elsewhere. The list has refreshed; try again.");
        await load();
      } else notice(errorMessage(e));
      return null;
    }
  }
  /** Check animation, slide out, then the saved result with Undo. */
  async function settle(task: Task, patch: TaskPatch, message: string) {
    if (ghosts.has(task.id)) return;
    setGhosts((old) => new Map(old).set(task.id, task));
    const [result] = await Promise.all([
      mutate(task, patch, message),
      wait(reducedMotion() ? 0 : 560),
    ]);
    if (result) setOpenId((id) => (id === task.id ? null : id));
    setGhosts((old) => {
      const next = new Map(old);
      next.delete(task.id);
      return next;
    });
  }
  const complete = (task: Task) => void settle(task, { status: "done" }, "Completed");
  const reopen = (task: Task) =>
    void settle(task, { status: task.previousStatus }, "Reopened");
  function copyName(task: Task) {
    copyText(task.title)
      .then(() => notice("Copied task name"))
      .catch(() => notice("Copying isn't available in this browser."));
  }
  function openObsidian(path: string) {
    const vault = readStored(`todo:obsidian:${snapshot?.vaultKey}`) ?? "";
    if (!vault) {
      go("settings");
      notice("Add this device's Obsidian vault name in Settings first.");
      return;
    }
    window.location.assign(
      `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`,
    );
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
    const target: View = task.trashed ? "trash" : task.status === "done" ? "done" : "tasks";
    const matchingProject = !task.trashed && task.projectId === filterProject ? filterProject : null;
    if (view !== target || (filterProject && task.projectId !== filterProject))
      go(target, matchingProject);
    setOpenId(task.id);
    setCursor(task.id);
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
      const at = k.cursor ? ids.indexOf(k.cursor) : -1;
      const current = taskById(k.openId ?? k.cursor);
      const move = (delta: number) => {
        e.preventDefault();
        const next = ids[Math.max(0, Math.min(ids.length - 1, at + delta))] ?? null;
        setCursor(next);
        if (k.openId && next) setOpenId(next);
      };
      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          if (k.view === "tasks" && addInput.current) addInput.current.focus();
          else {
            go("tasks");
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
            openTask(current, true);
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
    if (!cursor || openId === cursor) return;
    document
      .querySelector<HTMLElement>(`[data-task-id="${cursor}"] .task-row`)
      ?.focus({ preventScroll: false });
  }, [cursor, openId]);
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
        <h1>{error ? "Your vault is unavailable" : "Opening your vault…"}</h1>
        <p>{error || "Reading your task notes."}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  const s = ghosts.size
    ? { ...snapshot, tasks: snapshot.tasks.map((t) => ghosts.get(t.id) ?? t) }
    : snapshot;
  const open = s.tasks.filter(active);
  const activeProjects = s.projects.filter((p) => !p.archived);
  const project = s.projects.find((p) => p.id === filterProject) ?? null;
  const scoped = open.filter((t) => !filterProject || t.projectId === filterProject);
  const now = scoped.filter((t) => inNow(t, s.today)).sort(byPriority);
  const later = scoped
    .filter((t) => isLater(t, s.today))
    .sort((a, b) => (a.scheduled ?? "").localeCompare(b.scheduled ?? "") || byPriority(a, b));
  const known = new Set(s.projects.map((p) => p.id));
  const groups = (filterProject
    ? [{ key: "only", project, tasks: now }]
    : [
        ...s.projects.map((p) => ({
          key: p.id,
          project: p,
          tasks: now.filter((t) => t.projectId === p.id),
        })),
        {
          key: "none",
          project: null,
          tasks: now.filter((t) => !t.projectId || !known.has(t.projectId)),
        },
      ]).filter((g) => g.tasks.length);

  const row = (
    task: Task,
    opts: { showProject?: boolean; outcome?: boolean } = {},
  ) => (
    <TaskRow
      key={task.id}
      task={task}
      snapshot={s}
      open={openId === task.id}
      leaving={ghosts.has(task.id)}
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
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to tasks
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="wordmark">
          <span className="mark">
            <Icon name="daylight" size={25} />
          </span>
          Todo
        </div>
        <button className="search-button" onClick={() => setFind(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{modifierKey()}K</kbd>
        </button>
        <nav className="nav-group" aria-label="Task views">
          {navButton("tasks", "My tasks", "list-check", open.length)}
          {navButton("done", "Done", "circle-check")}
        </nav>
        {projectHeading}
        {activeProjects.length > 0 && (
          <nav className="nav-group" aria-label="Projects">
            {projectLinks}
          </nav>
        )}
        <div className="side-spacer" />
        <nav className="nav-group" aria-label="Workspace tools">
          {navButton("trash", "Trash", "trash")}
          {navButton("settings", "Settings", "settings")}
        </nav>
        <div className="side-utilities">
          <button onClick={openMini} title="Open Mini Today"><Icon name="device-desktop" size={16} />Mini Today</button>
          <button className="icon-button" onClick={() => setKeysOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="keyboard" size={17} /></button>
        </div>
        <button className="vault-status" onClick={() => go("settings")}>
          <i className={error ? "offline" : saving === "Saving…" ? "saving" : ""} />
          <span>{error ? "Connection interrupted" : saving === "Saved" ? "Saved to vault" : saving}</span>
        </button>
      </aside>
      <main id="main" className="main">
        <div
          className={view === "tasks" || view === "done" ? "page workspace-page" : "page"}
          key={view + (filterProject ?? "")}
        >
          {(view === "tasks" || view === "done") && project ? (
            <ProjectHeader
              project={project}
              mode={view}
              onMode={(mode) => go(mode, project.id)}
              onSaved={() => void load()}
              onError={notice}
              onMenu={(anchor) => setProjectMenu({ kind: "project", anchor })}
            />
          ) : view === "tasks" ? (
            <header className="planner-header">
              <div className="planner-title">
                <h1>My tasks</h1>
                <time dateTime={s.today}>{longDate}</time>
              </div>
              <div className="planner-print" aria-hidden="true" />
            </header>
          ) : (
            <header className="page-header"><h1>{titles[view]}</h1></header>
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
            <button className="diagnostic-hint" onClick={() => go("diagnostics")}>
              <Icon name="alert-triangle" tone="warning" />
              {s.diagnostics.length} note{s.diagnostics.length === 1 ? "" : "s"} need
              attention
            </button>
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
          {view === "tasks" && (
            <div className="task-workspace">
              <div className="task-queue">
                <div className="queue-heading"><h2>To do</h2><span className="section-count">{now.length}</span></div>
                <QuickAdd
                  snapshot={s}
                  projectId={filterProject}
                  inputRef={addInput}
                  onCreated={(task) => {
                    applyTask(task);
                    setFresh(task.id);
                  }}
                  onProjectCreated={addProject}
                  onError={notice}
                />
                {groups.length > 0 && (
                  <div className="task-ledger open-ledger">
                    {groups.map(({ key, project: groupProject, tasks }) => (
                      <section className="group" key={key}>
                        {!filterProject && (
                          <h2 className="group-title">
                            {groupProject ? (
                              <button onClick={() => go("tasks", groupProject.id)}>
                                <span className="swatch" style={{ background: projectColor(groupProject.id) }} />
                                {groupProject.title}
                              </button>
                            ) : (
                              "No project"
                            )}
                            <span className="count">{tasks.length}</span>
                          </h2>
                        )}
                        {tasks.map((t) => row(t))}
                      </section>
                    ))}
                  </div>
                )}
                {!scoped.length && (
                  <Empty icon="inbox" title="No open tasks">
                    Add a task when something comes up.
                  </Empty>
                )}
              </div>
              <div className="task-context">
                {later.length > 0 && (
                  <section className="task-ledger later-ledger" aria-labelledby="later-title">
                    <div className="group">
                      <h2 className="agenda-title" id="later-title">
                        <Icon name="calendar-week" size={19} />
                        Upcoming <span className="section-count">{later.length}</span>
                      </h2>
                      {later.map((task, index) => (
                        <div className="agenda-entry" key={task.id}>
                          {task.scheduled && task.scheduled !== later[index - 1]?.scheduled && (
                            <h3><time dateTime={task.scheduled}>{dateLabel(task.scheduled, s.today)}</time></h3>
                          )}
                          {row(task, { showProject: !filterProject })}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <RecentCompletions
                  snapshot={s}
                  projectId={filterProject}
                  onOpen={(task) => openTask(task)}
                  onDone={() => go("done", filterProject)}
                />
              </div>
            </div>
          )}
          {view === "done" && (
            <DoneView
              snapshot={s}
              projectId={filterProject}
              row={(t) => row(t, { outcome: true, showProject: !filterProject })}
            />
          )}
          {view === "trash" && (
            <>
              {s.tasks
                .filter((t) => t.trashed)
                .map((t) => (
                  <div className="trash-row" key={t.id}>
                    <span className="row-title">
                      <RichTitle text={t.title} template={s.preferences.issueLinkTemplate} />
                    </span>
                    <Button
                      kind="secondary"
                      onClick={() => void mutate(t, { trashed: false }, "Restored")}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              {!s.tasks.some((t) => t.trashed) && (
                <Empty title="Nothing in Trash.">
                  Removed tasks stay in the vault and can be restored here.
                </Empty>
              )}
            </>
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
                Archived projects keep their notes and tasks in the vault.
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
          {view === "diagnostics" && (
            <>
              <Banner title="Vault status" kind={s.diagnostics.length ? "warning" : "success"}>
                {s.diagnostics.length
                  ? `${s.diagnostics.length} notes need attention. Their files are preserved.`
                  : `${open.length} open tasks, ${s.tasks.filter((t) => t.status === "done" && !t.trashed).length} completed and ${s.tasks.filter((t) => t.trashed).length} in Trash.`}
              </Banner>
              {s.diagnostics.map((d) => (
                <div className="list-row" key={d.id}>
                  <div className="list-text">
                    <strong>{d.path}</strong>
                    <p className="muted">{d.message}</p>
                  </div>
                  {d.adoptable && (
                    <Button
                      kind="secondary"
                      onClick={() =>
                        void call("adopt", { id: d.id, revision: d.revision })
                          .then(() => {
                            void load();
                            notice("Task note adopted");
                          })
                          .catch((e) => notice(errorMessage(e)))
                      }
                    >
                      Adopt note
                    </Button>
                  )}
                </div>
              ))}
              <Button kind="secondary" icon="refresh" onClick={() => void load()}>
                Rescan vault
              </Button>
            </>
          )}
          {view === "import" && (
            <ImportPage
              onImported={() => {
                void load();
                go("tasks");
                notice("Task notes imported");
              }}
            />
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
                  Todo keeps the previous note before each successful edit.
                </Empty>
              )}
            </>
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Main navigation">
        {(
          [
            ["tasks", "Tasks", "list-check"],
            ["done", "Done", "circle-check"],
          ] as const
        ).map(([v, label, icon]) => (
          <button
            key={v}
            aria-current={view === v && !more ? "page" : undefined}
            onClick={() => go(v)}
          >
            <Icon name={icon} size={18} />
            {label}
          </button>
        ))}
        <button onClick={() => setFind(true)}>
          <Icon name="search" size={18} />
          Search
        </button>
        <button
          aria-current={more || !["tasks", "done"].includes(view) ? "page" : undefined}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          <Icon name="menu" size={18} />
          More
        </button>
      </nav>
      {more && (
        <div className="sheet-scrim" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {projectHeading}
            {projectLinks}
            <hr />
            {navButton("trash", "Trash", "trash")}
            {navButton("settings", "Settings", "settings")}
            <button className="nav-item" onClick={openMini}>
              <Icon name="device-desktop" />
              <span>Mini Today</span>
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const undo = toast.undo!;
                setToast(null);
                void undo().catch((e) => notice(errorMessage(e)));
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
          <MenuItem
            icon="obsidian"
            onSelect={() => {
              openObsidian(rowMenu.task.path);
              setRowMenu(null);
            }}
          >
            Open in Obsidian
          </MenuItem>
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
            icon="obsidian"
            onSelect={() => {
              openObsidian(project.path);
              setProjectMenu(null);
            }}
          >
            Open in Obsidian
          </MenuItem>
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
            The project leaves the sidebar. Its tasks and notes stay in the vault, and
            open tasks still show in Tasks.
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
          }}
        />
      )}
      {keysOpen && <KeyboardSheet onClose={() => setKeysOpen(false)} />}
    </div>
  );
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
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(project.notes.trim());
  useEffect(() => setTitle(project.title), [project.title]);
  useEffect(() => {
    if (!editing) setNotes(project.notes.trim());
  }, [project.notes, editing]);
  const save = (patch: { title?: string; notes?: string }) =>
    call("updateProject", { id: project.id, revision: project.revision, patch })
      .then(onSaved)
      .catch((e) => onError(errorMessage(e)));
  return (
    <header className="page-header project">
      <span className="swatch big" style={{ background: projectColor(project.id) }} />
      <input
        className="title-h1"
        aria-label="Project name"
        title={project.title}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== project.title && void save({ title: title.trim() })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="header-tools">
        <span className="segmented" role="radiogroup" aria-label="Show">
          {(
            [
              ["tasks", "Open"],
              ["done", "Done"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onMode(value)}
            >
              {label}
            </button>
          ))}
        </span>
        <button className="icon-button" aria-label="Project actions" onClick={(e) => onMenu(e.currentTarget)}>
          <Icon name="dots" />
        </button>
      </span>
      {editing ? (
        <textarea
          className="project-notes"
          aria-label="Project description"
          autoFocus
          rows={Math.min(8, Math.max(2, notes.split("\n").length))}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (notes !== project.notes.trim()) void save({ notes: notes ? "\n" + notes + "\n" : "" });
          }}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        />
      ) : (
        <button className="sub description" onClick={() => setEditing(true)}>
          {project.notes.trim().split(/\n\s*\n/)[0] || "Add a description — what belongs here?"}
        </button>
      )}
    </header>
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
