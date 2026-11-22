import { useRef, useState, type ReactNode } from "react";
import type { Project, Snapshot, Task } from "../core/model";
import { checkItems } from "../core/checklist";
import { titleParts } from "./rich-title-parts";
import { Button, Icon, errorMessage } from "./components";
import { call } from "./client";
import { DatePicker, dateLabel } from "./DateControl";
import { Popover, MenuItem } from "./Popover";
import { projectColor } from "./project-color";

export function RichTitle({ text, template }: { text: string; template: string }) {
  return (
    <>
      {titleParts(text, template).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "url" ? (
          <a
            key={i}
            className="chip link"
            href={part.href}
            target="_blank"
            rel="noreferrer"
            title={part.href}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="external-link" size={12} />
            {part.label}
          </a>
        ) : part.href ? (
          <a
            key={i}
            className="chip key"
            href={part.href}
            target="_blank"
            rel="noreferrer"
            title={"Open " + part.key}
            onClick={(e) => e.stopPropagation()}
          >
            {part.key}
          </a>
        ) : (
          <span key={i} className="chip key">
            {part.key}
          </span>
        ),
      )}
    </>
  );
}

export function CheckButton({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"check" + (checked ? " on" : "")}
      aria-label={label}
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 12.5l3.6 3.6 7.4-8" />
      </svg>
    </button>
  );
}

/** Small faint markers after a title: notes, checklist, deadline, labels… */
function Markers({ task, today, showNotes }: { task: Task; today: string; showNotes: boolean }) {
  const items = checkItems(task.notes);
  const done = items.filter((i) => i.checked).length;
  const late = !!task.due && task.due < today && task.status !== "done";
  return (
    <span className="markers">
      {items.length > 0 ? (
        <span title="Checklist">
          <Icon name="list-check" size={13} />
          {done}/{items.length}
        </span>
      ) : (
        showNotes && task.notes.trim() && (
          <span title="Has notes">
            <Icon name="note" size={13} />
          </span>
        )
      )}
      {task.due && (
        <span className={late ? "late" : ""} title="Deadline">
          <Icon name="flag" size={13} />
          {dateLabel(task.due, today)}
        </span>
      )}
      {task.tags.map((t) => (
        <span key={t}>#{t}</span>
      ))}
      {task.reminder && (
        <span title="Reminder">
          <Icon name="bell" size={13} />
        </span>
      )}
      {task.repeat && (
        <span title={"Repeats " + task.repeat.frequency}>
          <Icon name="repeat" size={13} />
        </span>
      )}
    </span>
  );
}

/** The first line of the Outcome section, else the first line of the notes. */
export function outcomeLine(notes: string) {
  const outcome = /^##\s*Outcome\s*\n+([^\n]+)/im.exec(notes)?.[1];
  const first = notes
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return (outcome ?? first ?? "").replace(/^[-*]\s+(\[[ x]\]\s+)?/, "");
}

export function TaskRow({
  task,
  snapshot,
  open,
  leaving,
  fresh,
  showProject,
  outcome,
  focused,
  onOpen,
  onCheck,
  onCopy,
  onMenu,
  card,
}: {
  task: Task;
  snapshot: Snapshot;
  open: boolean;
  leaving?: boolean;
  fresh?: boolean;
  showProject?: boolean;
  outcome?: boolean;
  focused?: boolean;
  onOpen: () => void;
  onCheck: () => void;
  onCopy: () => void;
  onMenu: (anchor: HTMLElement) => void;
  card: (
    leading: (onClick: () => void) => ReactNode,
    trailing: ReactNode,
  ) => ReactNode;
}) {
  const done = task.status === "done";
  const check = (onClick: () => void) => (
    <CheckButton
      checked={done || !!leaving}
      label={(done ? "Reopen " : "Complete ") + task.title}
      onClick={onClick}
    />
  );
  const actions = (
    <span className="row-actions">
      <button
        type="button"
        className="icon-button"
        aria-label={"Copy name of " + task.title}
        title="Copy name (C)"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        <Icon name="copy" size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={"More actions for " + task.title}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
      >
        <Icon name="dots" size={15} />
      </button>
    </span>
  );
  const project = showProject
    ? snapshot.projects.find((p) => p.id === task.projectId)
    : undefined;
  const preview = outcome && !open ? outcomeLine(task.notes) : "";
  return (
    <div
      className={
        "row-wrap" +
        (leaving ? " leaving" : "") +
        (fresh ? " fresh" : "") +
        (open ? " open" : "")
      }
      data-task-id={task.id}
    >
      <div className="row-inner">
        {open ? (
          card(check, actions)
        ) : (
          <div
            className={"task-row" + (done ? " done" : "") + (focused ? " focused" : "")}
            tabIndex={focused ? 0 : -1}
            aria-label={task.title}
            onClick={onOpen}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) {
                e.preventDefault();
                onOpen();
              }
            }}
          >
            {check(onCheck)}
            <div className="row-main">
              <span className="row-title">
                <RichTitle
                  text={task.title}
                  template={snapshot.preferences.issueLinkTemplate}
                />
                <Markers task={task} today={snapshot.today} showNotes={!preview} />
              </span>
              {preview && <span className="row-outcome">{preview}</span>}
            </div>
            {project && (
              <span className="row-meta">
                <span className="row-project" title={project.title}>
                  <span className="swatch" style={{ background: projectColor(project.id) }} />
                  <span>{project.title}</span>
                </span>
              </span>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/** Always-visible capture line. Enter saves; focus stays for the next one. */
export function QuickAdd({
  snapshot,
  projectId,
  onCreated,
  onProjectCreated,
  onError,
  inputRef,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  onCreated: (task: Task) => void;
  onProjectCreated: (project: Project) => void;
  onError: (message: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [project, setProject] = useState<string | null>(projectId);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: "project" | "date"; anchor: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(crypto.randomUUID());
  const lastFilter = useRef(projectId);
  if (lastFilter.current !== projectId) {
    lastFilter.current = projectId;
    setProject(projectId);
  }
  const current = snapshot.projects.find((p) => p.id === project);
  async function submit() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const task = await call<Task>("createTask", {
        requestId: request.current,
        title: name.slice(0, 240),
        ...(notes ? { notes } : {}),
        projectId: project,
        scheduled,
      });
      request.current = crypto.randomUUID();
      setTitle("");
      setNotes("");
      setScheduled(null);
      onCreated(task);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }
  const active = project !== projectId || !!(title || notes || scheduled || menu);
  return (
    <form
      className={"quick-add" + (active ? " active" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Icon name="plus" size={18} />
      <input
        ref={inputRef}
        aria-label="Add a task"
        placeholder="Add a task…"
        value={title}
        maxLength={240}
        aria-busy={busy}
        onChange={(e) => setTitle(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (!text.includes("\n") || title) return;
          e.preventDefault();
          const lines = text.replace(/\r/g, "").split("\n");
          const first = lines.findIndex((l) => l.trim());
          setTitle(lines[first]?.trim().slice(0, 240) ?? "");
          setNotes(lines.slice(first + 1).join("\n").trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (title || notes) {
              setTitle("");
              setNotes("");
            } else e.currentTarget.blur();
          }
        }}
      />
      <span className="quick-chips">
        {notes && (
          <button
            type="button"
            className="prop"
            title={notes}
            onClick={() => setNotes("")}
            aria-label="Remove pasted notes"
          >
            <Icon name="note" size={14} />
            Notes
            <Icon name="x" size={12} />
          </button>
        )}
        <button
          type="button"
          className="prop quick-project"
          onClick={(e) => setMenu({ kind: "project", anchor: e.currentTarget })}
        >
          {current ? (
            <span className="swatch" style={{ background: projectColor(current.id) }} />
          ) : (
            <Icon name="folder" size={14} />
          )}
          <span title={current?.title}>{current?.title ?? "No project"}</span>
        </button>
        <button
          type="button"
          className="prop"
          onClick={(e) => setMenu({ kind: "date", anchor: e.currentTarget })}
        >
          <Icon name="calendar-week" size={14} />
          {scheduled ? dateLabel(scheduled, snapshot.today) : "No date"}
        </button>
      </span>
      <Button className="quick-submit" type="submit" disabled={!title.trim() || busy}>
        {busy ? "Adding…" : "Add task"}
      </Button>
      {menu?.kind === "project" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Project" width={240}>
          {snapshot.projects
            .filter((p) => !p.archived)
            .map((p) => (
              <MenuItem
                key={p.id}
                swatch={projectColor(p.id)}
                active={p.id === project}
                onSelect={() => {
                  setProject(p.id);
                  setMenu(null);
                  inputRef.current?.focus();
                }}
              >
                {p.title}
              </MenuItem>
            ))}
          <MenuItem
            icon="x"
            active={!project}
            onSelect={() => {
              setProject(null);
              setMenu(null);
              inputRef.current?.focus();
            }}
          >
            No project
          </MenuItem>
          <NewProjectInput
            onCreated={(p) => {
              onProjectCreated(p);
              setProject(p.id);
              setMenu(null);
              inputRef.current?.focus();
            }}
            onError={onError}
          />
        </Popover>
      )}
      {menu?.kind === "date" && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} label="Plan for" width={252}>
          <DatePicker
            value={scheduled}
            today={snapshot.today}
            weekStartsOn={snapshot.preferences.weekStartsOn}
            onPick={(value) => {
              setScheduled(value);
              setMenu(null);
              inputRef.current?.focus();
            }}
          />
        </Popover>
      )}
    </form>
  );
}

export function NewProjectInput({
  onCreated,
  onError,
}: {
  onCreated: (project: Project) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <form
      className="menu-input"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = title.trim();
        if (!name) return;
        void call<Project>("createProject", {
          requestId: crypto.randomUUID(),
          title: name,
          notes: "",
        })
          .then((p) => {
            setTitle("");
            onCreated(p);
          })
          .catch((err) => onError(errorMessage(err)));
      }}
    >
      <Icon name="plus" />
      <input
        aria-label="New project name"
        placeholder="New project…"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
