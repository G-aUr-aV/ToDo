import {
  readStored,
  writeStored,
  removeStored,
  removeSavedDraft,
} from "./storage";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
const MarkdownNote = lazy(() =>
  import("./MarkdownNote").then((m) => ({ default: m.MarkdownNote })),
);
import type { Task, TaskPatch, Snapshot, Project } from "../core/model";
import { Button, Icon, modifierKey, copyText, errorMessage } from "./components";
import { ClientError, call } from "./client";
import { DatePicker, dateLabel } from "./DateControl";
import { ScheduleFields } from "./ScheduleFields";
import { Popover, MenuItem } from "./Popover";
import { projectColor } from "./project-color";
import { NewProjectInput } from "./TaskList";
function restored(key: string) {
  try {
    return JSON.parse(readStored(key) ?? "null");
  } catch {
    return null;
  }
}
function changes(draft: TaskPatch, base: TaskPatch): TaskPatch {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([k, v]) =>
        JSON.stringify(v) !== JSON.stringify(base[k as keyof TaskPatch]),
    ),
  ) as TaskPatch;
}
type Menu = "project" | "date" | "deadline" | "add" | "labels" | null;
/** What the list and keyboard can ask the open card to do. */
export type CardActions = {
  editNotes: () => void;
  toggle: () => void;
  openMenu: (kind: "project" | "date") => void;
};

/**
 * The open task: title, properties, notes and Complete. Autosaves drafts,
 * keeps them on this device, and pauses on an external edit (Copy / Discard).
 */
export function TaskEditor({
  task,
  snapshot,
  onSaved,
  onState,
  onClose,
  onComplete,
  onReopen,
  onProjectCreated,
  leading,
  trailing,
  editNotes = false,
  initialMenu = null,
  actionsRef,
}: {
  task: Task;
  snapshot: Snapshot;
  onSaved: (task: Task) => void;
  onState: (state: string) => void;
  onClose: () => void;
  onComplete: (task: Task) => void;
  onReopen: (task: Task) => void;
  onProjectCreated: (project: Project) => void;
  leading: (complete: () => void) => ReactNode;
  trailing: ReactNode;
  editNotes?: boolean;
  initialMenu?: "project" | "date" | null;
  actionsRef?: React.MutableRefObject<CardActions | null>;
}) {
  const key = `todo:editor:${snapshot.vaultKey}:${task.id}`;
  const initial = () => {
    try {
      const saved = JSON.parse(readStored(key) ?? "null");
      return saved?.draft ?? form(task);
    } catch {
      return form(task);
    }
  };
  const [draft, setDraft] = useState<TaskPatch>(initial);
  const [tagsText, setTagsText] = useState((initial().tags ?? []).join(", "));
  const editNotesButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(editNotes);
  const [status, setStatus] = useState(
    readStored(key) ? "Draft restored" : "Saved",
  );
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [draftOnDevice, setDraftOnDevice] = useState(true);
  const [menu, setMenu] = useState<{ kind: Menu; anchor: HTMLElement } | null>(
    null,
  );
  const [schedule, setSchedule] = useState(!!(task.reminder || task.repeat));
  const [plannedAfterDeadline, setPlannedAfterDeadline] = useState<string>();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const revision = useRef(restored(key)?.revision ?? task.revision);
  const saved = useRef(JSON.stringify(restored(key)?.base ?? form(task)));
  const busy = useRef(false);
  const followup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);
  const mounted = useRef(true);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const projectChip = useRef<HTMLButtonElement>(null);
  const dateChip = useRef<HTMLButtonElement>(null);
  // Preserve the leading blank line in notes imported from the legacy workspace.
  const lead = useRef("");
  const callbacks = useRef({ onSaved, onState });
  callbacks.current = { onSaved, onState };
  function change(patch: TaskPatch) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setDraftOnDevice(
      writeStored(
        key,
        JSON.stringify({
          draft: next,
          revision: revision.current,
          base: JSON.parse(saved.current),
        }),
      ),
    );
    if (!paused.current) {
      setStatus("Unsaved draft");
      callbacks.current.onState("Unsaved changes");
      setError("");
    } else setStatus("Changes not saved");
  }
  async function save(force = false) {
    const value = draftRef.current;
    const serialized = JSON.stringify(value);
    if (busy.current || paused.current || serialized === saved.current) return;
    if (!value.title?.trim()) {
      setError("Enter a task name.");
      setStatus("Unsaved draft");
      return;
    }
    busy.current = true;
    let success = false;
    setStatus("Saving…");
    callbacks.current.onState("Saving…");
    try {
      const result = await call<Task>("updateTask", {
        id: task.id,
        revision: revision.current,
        patch: changes(value, JSON.parse(saved.current)),
      });
      success = true;
      revision.current = result.revision;
      saved.current = serialized;
      if (mounted.current) setError("");
      callbacks.current.onSaved(result);
      if (JSON.stringify(draftRef.current) === serialized) {
        removeSavedDraft(key, serialized);
        if (mounted.current) {
          setStatus("Saved");
          callbacks.current.onState("Saved");
        }
      } else if (mounted.current) setStatus("Unsaved draft");
    } catch (e) {
      if (e instanceof ClientError && e.info.code === "CONFLICT") {
        pauseSaving();
        return;
      }
      if (mounted.current) {
        setError(errorMessage(e));
        setStatus("Changes not saved");
        callbacks.current.onState("Changes not saved");
      }
    } finally {
      busy.current = false;
      if (
        success &&
        !paused.current &&
        JSON.stringify(draftRef.current) !== saved.current
      )
        followup.current = setTimeout(() => void save(), mounted.current ? 100 : 0);
      if (
        mounted.current &&
        JSON.stringify(draftRef.current) !== saved.current &&
        !paused.current &&
        !error &&
        !force
      )
        setStatus((s) => (s === "Saving…" ? "Unsaved draft" : s));
    }
  }
  /** Save anything pending, then hand the task to the list's Complete animation. */
  async function finish() {
    while (busy.current) await new Promise((r) => setTimeout(r, 40));
    await save(true);
    if (paused.current || JSON.stringify(draftRef.current) !== saved.current)
      return;
    const current = { ...task, ...draftRef.current, revision: revision.current };
    (current.status === "done" ? onReopen : onComplete)(current);
  }
  function toggle() {
    void finish();
  }
  const openMenu = (kind: "project" | "date") => {
    const anchor = (kind === "project" ? projectChip : dateChip).current;
    if (anchor) setMenu({ kind, anchor });
  };
  // Register what the list and keyboard can ask of this card, after every render.
  useLayoutEffect(() => {
    if (!actionsRef) return;
    const actions = { toggle, openMenu, editNotes: () => setEditing(true) };
    actionsRef.current = actions;
    return () => {
      if (actionsRef.current === actions) actionsRef.current = null;
    };
  });
  useEffect(() => {
    if (initialMenu) openMenu(initialMenu);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (followup.current) clearTimeout(followup.current);
      // Closing or switching cards still saves; the draft stays as a backup.
      if (JSON.stringify(draftRef.current) !== saved.current && !paused.current)
        void save();
      if (JSON.stringify(draftRef.current) !== saved.current)
        writeStored(
          key,
          JSON.stringify({
            draft: draftRef.current,
            revision: revision.current,
            base: JSON.parse(saved.current),
          }),
        );
    };
  }, [key]);
  useEffect(() => {
    if (task.revision === revision.current || busy.current || paused.current)
      return;
    if (JSON.stringify(draftRef.current) !== saved.current) {
      pauseSaving();
    } else {
      revision.current = task.revision;
      const value = form(task);
      saved.current = JSON.stringify(value);
      draftRef.current = value;
      setDraft(value);
      setTagsText((value.tags ?? []).join(", "));
      setStatus("Saved");
    }
  }, [task.revision, status]);
  useEffect(() => {
    if (JSON.stringify(draft) === saved.current || paused.current) return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [draft]);
  // Long titles wrap instead of being cut off.
  useLayoutEffect(() => {
    const area = titleRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = area.scrollHeight + "px";
  }, [draft.title]);
  // The notes box grows with its content while you type.
  useLayoutEffect(() => {
    const area = notesRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = Math.max(96, area.scrollHeight + 2) + "px";
  }, [editing, draft.notes]);
  if (!editing) lead.current = (draft.notes ?? "").startsWith("\n") ? "\n" : "";
  useEffect(() => {
    if (!editing) return;
    const area = notesRef.current;
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  }, [editing]);
  useEffect(() => {
    if (editNotes) setEditing(true);
  }, [editNotes]);
  function pauseSaving() {
    paused.current = true;
    if (mounted.current) {
      setStale(true);
      setError(
        "This task changed elsewhere. Copy your draft or discard it and load the latest version.",
      );
      setStatus("Changes not saved");
      callbacks.current.onState("Changes not saved");
    }
  }
  async function reloadLatest() {
    setReloading(true);
    try {
      const current = await call<Snapshot>("snapshot");
      const latest = current.tasks.find((value) => value.id === task.id);
      if (!latest)
        throw new Error(
          "This task is no longer available. Your draft is still kept here.",
        );
      const value = form(latest);
      revision.current = latest.revision;
      saved.current = JSON.stringify(value);
      draftRef.current = value;
      removeStored(key);
      paused.current = false;
      setDraft(value);
      setTagsText((value.tags ?? []).join(", "));
      setStale(false);
      setError("");
      setStatus("Saved");
      callbacks.current.onSaved(latest);
      callbacks.current.onState("Saved");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setReloading(false);
    }
  }
  async function copyDraft() {
    const value = draftRef.current;
    const text = [
      `# ${value.title ?? "Untitled task"}`,
      value.notes ?? "",
      `Plan for: ${value.scheduled ?? "None"}`,
      `Deadline: ${value.due ?? "None"}`,
      `Project: ${snapshot.projects.find((project) => project.id === value.projectId)?.title ?? "None"}`,
      `Labels: ${(value.tags ?? []).join(", ") || "None"}`,
      `Status: ${value.status}`,
    ].join("\n\n");
    try {
      await copyText(text);
      setStatus("Draft copied");
    } catch {
      setEditing(true);
      setError(
        "Copying is unavailable in this browser. Your draft is kept here; select and copy the text before reloading.",
      );
    }
  }
  // Giving an Inbox task a date or project marks it ready, as before.
  const inboxReady = () =>
    task.status === "inbox" ? "todo" : (draftRef.current.status ?? task.status);
  const open = (kind: Menu) => (e: { currentTarget: HTMLElement }) =>
    setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget });
  const project = snapshot.projects.find((p) => p.id === draft.projectId);
  const done = draft.status === "done";
  const today = snapshot.today;
  const overdue = !!draft.due && draft.due < today && !done;
  const weekStartsOn = snapshot.preferences.weekStartsOn;
  return (
    <section
      className={"task-card" + (done ? " is-done" : "")}
      aria-label={"Details for " + task.title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (!done) void finish();
        }
      }}
    >
      <div className="card-head">
        {leading(() => toggle())}
        <textarea
          ref={titleRef}
          className="title-input"
          aria-label="Task name"
          rows={1}
          maxLength={240}
          value={draft.title ?? ""}
          onChange={(e) => change({ title: e.target.value.replace(/\n/g, " ") })}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
              setEditing(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              void save();
              onClose();
            }
          }}
        />
        {trailing}
      </div>
      <div className="card-body">
        {!draftOnDevice && (
          <p role="alert" className="warning-text">
            This device cannot keep a draft. Keep this page open until saved,
            or copy your notes.
          </p>
        )}
        <div className="props">
          <button
            ref={projectChip}
            type="button"
            className="prop"
            onClick={open("project")}
          >
            {project ? (
              <span
                className="swatch"
                style={{ background: projectColor(project.id) }}
              />
            ) : (
              <Icon name="folder" size={14} />
            )}
            {project?.title ?? "No project"}
          </button>
          <button
            ref={dateChip}
            type="button"
            className={"prop" + (draft.scheduled ? "" : " unset")}
            onClick={open("date")}
          >
            <Icon name="calendar-week" size={14} />
            {draft.scheduled ? dateLabel(draft.scheduled, today) : "No date"}
          </button>
          {draft.due && (
            <span className={"prop" + (overdue ? " warn" : "")}>
              <button type="button" onClick={open("deadline")}>
                <Icon name="flag" size={14} />
                Due {dateLabel(draft.due, today)}
              </button>
              <button
                type="button"
                className="prop-clear"
                aria-label="Remove deadline"
                onClick={() => change({ due: null })}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          {!!draft.tags?.length && (
            <button type="button" className="prop" onClick={open("labels")}>
              <Icon name="tag" size={14} />
              {draft.tags.map((t) => "#" + t).join(" ")}
            </button>
          )}
          {(draft.reminder || draft.repeat) && (
            <button
              type="button"
              className="prop"
              aria-expanded={schedule}
              onClick={() => setSchedule(!schedule)}
            >
              <Icon name={draft.reminder ? "bell" : "repeat"} size={14} />
              {draft.reminder && draft.repeat
                ? "Reminder · repeats"
                : draft.reminder
                  ? "Reminder"
                  : "Repeats " + draft.repeat!.frequency}
            </button>
          )}
          <button
            type="button"
            className="prop ghost"
            onClick={open("add")}
            aria-label="Add deadline, labels, reminder or repeat"
          >
            <Icon name="plus" size={14} />
            {draft.due || draft.tags?.length || draft.reminder || draft.repeat
              ? ""
              : "Deadline, label…"}
          </button>
        </div>
        {schedule && (
          <div className="schedule-panel">
            <ScheduleFields
              reminder={draft.reminder ?? null}
              repeat={draft.repeat ?? null}
              timezone={snapshot.preferences.timezone}
              onChange={change}
            />
          </div>
        )}
        {draft.scheduled && draft.due && draft.scheduled > draft.due && (
          <p className="date-warning">
            The planned date is after the deadline. Both dates are kept.
          </p>
        )}
        {plannedAfterDeadline && (
          <div className="move-warnings" role="status">
            <p>
              Planning for {dateLabel(plannedAfterDeadline, today)} places this task after its deadline.
            </p>
            <div className="button-pair">
              <Button kind="secondary" onClick={() => {
                change({ scheduled: plannedAfterDeadline, status: inboxReady() });
                setPlannedAfterDeadline(undefined);
              }}>Move task</Button>
              <Button kind="ghost" onClick={() => setPlannedAfterDeadline(undefined)}>Cancel</Button>
            </div>
          </div>
        )}
        <div
          className={"notes" + (editing ? " editing" : "")}
          onClick={(e) => {
            if (editing) return;
            if ((e.target as HTMLElement).closest("a,input,button,label")) return;
            if (window.getSelection()?.toString()) return;
            setEditing(true);
          }}
        >
          {editing ? (
            <textarea
              ref={notesRef}
              aria-label="Task notes in Markdown"
              value={(draft.notes ?? "").slice(lead.current.length)}
              placeholder="Context, progress, what was done… Markdown works."
              onChange={(e) => change({ notes: lead.current + e.target.value })}
              onBlur={() => {
                setEditing(false);
                void save();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                  requestAnimationFrame(() => editNotesButton.current?.focus({ preventScroll: true }));
                }
              }}
            />
          ) : draft.notes?.trim() ? (
            <>
              <button
                ref={editNotesButton}
                type="button"
                className="note-edit-button icon-button"
                aria-label="Edit notes"
                title="Edit notes"
                onClick={() => setEditing(true)}
              >
                <Icon name="note" />
              </button>
              <Suspense fallback={<p className="muted">Loading notes…</p>}>
                <MarkdownNote
                  body={draft.notes}
                  onChange={(notes) => change({ notes })}
                />
              </Suspense>
            </>
          ) : (
            <button
              type="button"
              className="notes-placeholder"
              ref={editNotesButton}
              onClick={() => setEditing(true)}
            >
              Context, progress, what was done… Markdown works.
            </button>
          )}
        </div>
        {!!task.rolloverCount && (
          <p className="rollover-note">
            Carried forward {task.rolloverCount}{" "}
            {task.rolloverCount === 1 ? "time" : "times"}
            {task.originalScheduled
              ? ` · first planned ${dateLabel(task.originalScheduled, today)}`
              : ""}
          </p>
        )}
        {error && (
          <div className="save-error" role="alert">
            <p>{error}</p>
            <div>
              {stale ? (
                <Button
                  kind="secondary"
                  disabled={reloading}
                  onClick={() => void reloadLatest()}
                >
                  {reloading ? "Loading latest…" : "Discard draft & reload"}
                </Button>
              ) : (
                <Button kind="secondary" onClick={() => void save(true)}>
                  Retry save
                </Button>
              )}
              <Button kind="ghost" icon="copy" onClick={() => void copyDraft()}>
                Copy draft
              </Button>
            </div>
          </div>
        )}
        <div className="card-foot">
          {task.trashed ? null : done ? (
            <Button
              kind="secondary"
              icon="refresh"
              onClick={() => void finish()}
            >
              Reopen
            </Button>
          ) : (
            <Button icon="check" onClick={() => void finish()}>
              Complete <kbd>{modifierKey()} ↵</kbd>
            </Button>
          )}
          <span
            className={"save-state" + (status === "Saving…" ? " saving" : "")}
            aria-live="polite"
          >
            <i />
            {status === "Saved" ? "Saved" : status}
          </span>
        </div>
      </div>
      {menu?.kind === "project" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Project" width={240}>
          {snapshot.projects
            .filter((p) => !p.archived || p.id === task.projectId)
            .map((p) => (
              <MenuItem
                key={p.id}
                swatch={projectColor(p.id)}
                active={p.id === draft.projectId}
                onSelect={() => {
                  change({ projectId: p.id, status: inboxReady() });
                  setMenu(null);
                }}
              >
                {p.title}
              </MenuItem>
            ))}
          {draft.projectId && (
            <MenuItem
              icon="x"
              onSelect={() => {
                change({ projectId: null });
                setMenu(null);
              }}
            >
              No project
            </MenuItem>
          )}
          <NewProjectInput
            onCreated={(p) => {
              onProjectCreated(p);
              setMenu(null);
              change({ projectId: p.id, status: inboxReady() });
            }}
            onError={setError}
          />
        </Popover>
      )}
      {(menu?.kind === "date" || menu?.kind === "deadline") && (
        <Popover
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          label={menu.kind === "date" ? "Plan for" : "Deadline"}
          width={252}
        >
          <DatePicker
            value={(menu.kind === "date" ? draft.scheduled : draft.due) ?? null}
            today={today}
            weekStartsOn={weekStartsOn}
            kind={menu.kind === "date" ? "plan" : "deadline"}
            onPick={(value) => {
              if (menu.kind === "date" && value && draft.due && value > draft.due) {
                setPlannedAfterDeadline(value);
              } else {
                setPlannedAfterDeadline(undefined);
                change(
                  menu.kind === "date"
                    ? { scheduled: value, status: value ? inboxReady() : draft.status }
                    : { due: value, status: value ? inboxReady() : draft.status },
                );
              }
              setMenu(null);
            }}
          />
        </Popover>
      )}
      {menu?.kind === "add" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Add a property" width={220}>
          {!draft.due && (
            <MenuItem
              icon="flag"
              onSelect={() => setMenu({ kind: "deadline", anchor: menu.anchor })}
            >
              Deadline
            </MenuItem>
          )}
          <MenuItem
            icon="tag"
            onSelect={() => setMenu({ kind: "labels", anchor: menu.anchor })}
          >
            Labels
          </MenuItem>
          {!schedule && (
            <MenuItem
              icon="bell"
              onSelect={() => {
                setSchedule(true);
                setMenu(null);
              }}
            >
              Reminder or repeat
            </MenuItem>
          )}
        </Popover>
      )}
      {menu?.kind === "labels" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Labels" width={260}>
          <form
            className="menu-input"
            onSubmit={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          >
            <Icon name="tag" />
            <input
              aria-label="Labels, separated by commas"
              placeholder="design, review"
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                change({
                  tags: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                });
              }}
            />
          </form>
          <p className="menu-hint">Separate labels with commas. ↵ to close.</p>
        </Popover>
      )}
    </section>
  );
}
export function form(task: Task): TaskPatch {
  return {
    title: task.title,
    status: task.status,
    scheduled: task.scheduled,
    due: task.due,
    reminder: task.reminder,
    repeat: task.repeat,
    projectId: task.projectId,
    trashed: task.trashed,
    tags: task.tags,
    notes: task.notes,
  };
}
