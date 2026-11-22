import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Snapshot, Task, Project } from "../core/model";
import { Icon } from "./components";
import { projectColor } from "./project-color";

type Result = { kind: "task"; task: Task } | { kind: "project"; project: Project };

/** ⌘K: find any task or project by words in its title, notes or project. */
export function Find({
  snapshot: s,
  onClose,
  onTask,
  onProject,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onTask: (task: Task) => void;
  onProject: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const project = (t: Task) => s.projects.find((p) => p.id === t.projectId);
  const results: Result[] = [
    ...s.projects
      .filter(
        (p) => words.length && words.every((w) => p.title.toLowerCase().includes(w)),
      )
      .slice(0, 3)
      .map((project) => ({ kind: "project" as const, project })),
    ...s.tasks
      .filter((t) => !t.trashed)
      .map((t) => {
        const title = t.title.toLowerCase();
        const hay = `${title}\n${t.notes.toLowerCase()}\n${project(t)?.title.toLowerCase() ?? ""}`;
        return {
          t,
          hit: words.every((w) => hay.includes(w)),
          score:
            Number(words.every((w) => title.includes(w))) * 2 +
            Number(t.status !== "done"),
        };
      })
      .filter((r) => r.hit)
      .sort((a, b) => b.score - a.score || b.t.updatedAt.localeCompare(a.t.updatedAt))
      .slice(0, 8)
      .map((r) => ({ kind: "task" as const, task: r.t })),
  ];
  const pick = (r: Result | undefined) => {
    if (!r) return;
    if (r.kind === "task") onTask(r.task);
    else onProject(r.project);
  };
  return createPortal(
    <div
      className="find-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="find" role="dialog" aria-label="Find">
        <label className="find-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder="Find a task, note or project…"
            aria-label="Find a task, note or project"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = results.length || 1;
                setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(results[index]);
              }
            }}
          />
          <kbd>esc</kbd>
        </label>
        <div className="find-results" role="listbox">
          {results.map((r, i) => (
            <button
              key={r.kind === "task" ? r.task.id : r.project.id}
              type="button"
              role="option"
              aria-selected={i === index}
              className={"find-result" + (i === index ? " active" : "")}
              onMouseMove={() => setIndex(i)}
              onClick={() => pick(r)}
            >
              {r.kind === "project" ? (
                <>
                  <span className="swatch" style={{ background: projectColor(r.project.id) }} />
                  <span className="find-title">{r.project.title}</span>
                  <span className="find-meta">Project</span>
                </>
              ) : (
                <>
                  <Icon
                    name={r.task.status === "done" ? "circle-check" : "circle"}
                    tone={r.task.status === "done" ? "brand" : "muted"}
                  />
                  <span className="find-title">{r.task.title}</span>
                  <span className="find-meta">{project(r.task)?.title ?? ""}</span>
                </>
              )}
            </button>
          ))}
          {!results.length && (
            <p className="find-empty">
              {words.length ? "No matches." : "Type to search titles, notes and projects."}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const keys: [string, string[]][] = [
  ["Add a task", ["N"]],
  ["Move between tasks", ["J", "K"]],
  ["Open or close a task", ["↵", "Esc"]],
  ["Complete", ["X"]],
  ["Complete the open task", ["⌘", "↵"]],
  ["Copy task name", ["C"]],
  ["Set project", ["P"]],
  ["Set date", ["D"]],
  ["Write notes", ["E"]],
  ["Find", ["⌘", "K"]],
  ["Keyboard shortcuts", ["?"]],
];
export function KeyboardSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return createPortal(
    <div
      className="find-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="keys-sheet"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>Keyboard</h2>
        <dl>
          {keys.map(([what, combo]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>
                {combo.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted">Single keys pause while you type. Turn them off in Settings.</p>
      </div>
    </div>,
    document.body,
  );
}
