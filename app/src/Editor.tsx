import {
  readStored,
  writeStored,
  removeStored,
  removeSavedDraft,
} from "./storage";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
const MarkdownNote = lazy(() =>
  import("./MarkdownNote").then((m) => ({ default: m.MarkdownNote })),
);
import type { Task, TaskPatch, Snapshot } from "../core/model";
import { Button, Icon, errorMessage } from "./components";
import { ClientError, call } from "./client";
import { DateControl } from "./DateControl";
import { ScheduleFields } from "./ScheduleFields";
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
export function TaskEditor({
  task,
  snapshot,
  onSaved,
  onState,
  onClose,
  onObsidian,
}: {
  task: Task;
  snapshot: Snapshot;
  onSaved: (task: Task) => void;
  onState: (state: string) => void;
  onClose: () => void;
  onObsidian: (task: Task) => void;
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
  const [more, setMore] = useState(false);
  const [tagsText, setTagsText] = useState((initial().tags ?? []).join(", "));
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(
    readStored(key) ? "Draft restored" : "Saved",
  );
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [draftOnDevice, setDraftOnDevice] = useState(true);
  const [checklist, setChecklist] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const revision = useRef(restored(key)?.revision ?? task.revision);
  const saved = useRef(JSON.stringify(restored(key)?.base ?? form(task)));
  const busy = useRef(false);
  const followup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);
  const mounted = useRef(true);
  const phoneHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (matchMedia("(max-width: 720px)").matches) phoneHeading.current?.focus();
  }, []);
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
        mounted.current &&
        !paused.current &&
        JSON.stringify(draftRef.current) !== saved.current
      )
        followup.current = setTimeout(() => void save(), 100);
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (followup.current) clearTimeout(followup.current);
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
  function pauseSaving() {
    paused.current = true;
    if (mounted.current) {
      setStale(true);
      setError(
        "This note changed in the vault. Your draft is kept here. Copy it if needed before discarding it and loading the latest note.",
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
      `Reminder: ${value.reminder ?? "None"}`,
      `Repeat: ${value.repeat ? `Every ${value.repeat.interval} ${value.repeat.frequency}` : "None"}`,
      `Project: ${snapshot.projects.find((project) => project.id === value.projectId)?.title ?? "None"}`,
      `Labels: ${(value.tags ?? []).join(", ") || "None"}`,
      `Focus: ${value.focus ? "Yes" : "No"}`,
      `Status: ${value.status}`,
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Draft copied");
    } catch {
      setEditing(true);
      setError(
        "Copying is unavailable in this browser. Your draft is kept here; select and copy the text before reloading.",
      );
    }
  }
  const lines = (draft.notes ?? "").split("\n");
  return (
    <section
      className={"task-editor" + (more ? " extra-open" : "")}
      aria-label={"Details for " + task.title}
    >
      {!draftOnDevice && (
        <p role="alert" className="warning-text">
          This device cannot keep a draft. Keep this page open until saved, or
          copy your notes.
        </p>
      )}
      <div className="phone-task-heading">
        <h1 ref={phoneHeading} tabIndex={-1}>
          Task
        </h1>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Back to tasks"
        >
          <Icon name="arrow-left" />
        </button>
      </div>
      <input
        className="task-title-edit"
        aria-label="Task name"
        value={draft.title ?? ""}
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => void save()}
      />
      <div className="phone-task-meta muted">
        {snapshot.projects.find((p) => p.id === task.projectId)?.title}
        {task.due
          ? ` · due ${task.due === snapshot.today ? "today" : task.due === new Date(Date.parse(snapshot.today + "T12:00:00Z") + 86400000).toISOString().slice(0, 10) ? "tomorrow" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(task.due + "T12:00:00Z"))}`
          : null}
      </div>
      <div className="editor-notes">
        {editing ? (
          <>
            <textarea
              aria-label="Task notes in Markdown"
              value={draft.notes ?? ""}
              placeholder="Add notes in Markdown…"
              onChange={(e) => change({ notes: e.target.value })}
              rows={Math.max(3, Math.min(10, lines.length))}
            />
            <Button
              kind="ghost"
              onClick={() => {
                setEditing(false);
                void save();
              }}
            >
              Done editing notes
            </Button>
          </>
        ) : (
          <>
            {draft.notes?.trim() ? (
              <Suspense fallback={<p className="muted">Loading notes…</p>}>
                <MarkdownNote
                  body={draft.notes}
                  onChange={(notes) => change({ notes })}
                />
              </Suspense>
            ) : (
              <span className="muted">Add a note…</span>
            )}
          </>
        )}
      </div>
      {(more || editing) && (
        <form
          className="add-checklist"
          onSubmit={(e) => {
            e.preventDefault();
            if (!checklist.trim()) return;
            change({
              notes:
                (draft.notes ?? "").replace(/\s*$/, "") +
                "\n- [ ] " +
                checklist.trim() +
                "\n",
            });
            setChecklist("");
          }}
        >
          <input
            aria-label="New checklist item"
            placeholder="Add a checklist item…"
            value={checklist}
            onChange={(e) => setChecklist(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label="Add checklist item"
            disabled={!checklist.trim()}
          >
            <Icon name="plus" />
          </button>
        </form>
      )}
      <div className="editor-fields">
        <label>
          <span>Plan for</span>
          <DateControl
            value={draft.scheduled ?? null}
            today={snapshot.today}
            weekStartsOn={snapshot.preferences.weekStartsOn}
            onChange={(value) =>
              change({
                scheduled: value,
                status:
                  task.status === "inbox" && value ? "todo" : draft.status,
              })
            }
          />
        </label>
        <label>
          <span>Deadline</span>
          <DateControl
            kind="deadline"
            value={draft.due ?? null}
            today={snapshot.today}
            weekStartsOn={snapshot.preferences.weekStartsOn}
            onChange={(value) =>
              change({
                due: value,
                status:
                  task.status === "inbox" && value ? "todo" : draft.status,
              })
            }
          />
        </label>
        <label>
          <span>Project</span>
          <select
            aria-label="Project"
            value={draft.projectId ?? ""}
            onChange={(e) =>
              change({
                projectId: e.target.value || null,
                status:
                  task.status === "inbox" && e.target.value
                    ? "todo"
                    : draft.status,
              })
            }
          >
            <option value="">No project</option>
            {snapshot.projects
              .filter((p) => !p.archived || p.id === task.projectId)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                  {p.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>
      {draft.scheduled && draft.due && draft.scheduled > draft.due && (
        <p className="date-warning">
          This planned date is after the deadline. Both dates are kept as
          entered.
        </p>
      )}
      <ScheduleFields
        reminder={draft.reminder ?? null}
        repeat={draft.repeat ?? null}
        timezone={snapshot.preferences.timezone}
        onChange={change}
      />
      {!!task.rolloverCount && (
        <p className="rollover-note muted">
          Carried forward {task.rolloverCount}{" "}
          {task.rolloverCount === 1 ? "time" : "times"}.
          {task.originalScheduled
            ? ` First planned for ${task.originalScheduled}.`
            : ""}
        </p>
      )}
      {more && (
        <div className="editor-extra">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={draft.focus ?? false}
              onChange={(e) => change({ focus: e.target.checked })}
            />
            Focus
          </label>
          <label className="tags-label">
            <span>Labels</span>
            <input
              aria-label="Task labels, separated by commas"
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
              placeholder="design, work"
            />
          </label>
        </div>
      )}
      {error && (
        <div className="save-error" role="alert">
          <p>{error}</p>
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
          <Button kind="ghost" onClick={() => void copyDraft()}>
            Copy draft
          </Button>
        </div>
      )}
      <div className="editor-footer">
        {!task.trashed && (
          <Button
            kind="secondary"
            onClick={() => {
              change({
                status: draft.status === "done" ? task.previousStatus : "done",
              });
              void save(true);
            }}
          >
            {draft.status === "done" ? "Reopen task" : "Complete task"}
          </Button>
        )}
        <Button kind="ghost" icon="upload" onClick={() => onObsidian(task)}>
          Open in Obsidian
        </Button>
        {!editing && (
          <Button kind="ghost" onClick={() => setEditing(true)}>
            Edit notes
          </Button>
        )}
        <Button kind="ghost" onClick={() => setMore(!more)}>
          {more ? "Fewer details" : "More details"}
        </Button>
        <span className="muted" aria-live="polite">
          {status === "Saved" ? "Saved to vault" : status}
        </span>
      </div>
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
    focus: task.focus,
    trashed: task.trashed,
    tags: task.tags,
    notes: task.notes,
  };
}
