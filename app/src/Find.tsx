import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Snapshot, Task, Project } from "../core/model";
import { Icon, Modal, modifierKey } from "./components";
import { projectColor } from "./project-color";
import "./command-dialogs.css";

type Result =
  { kind: "task"; task: Task } | { kind: "project"; project: Project };

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
  const listId = useId();
  const activeResult = useRef<HTMLDivElement>(null);
  const search = query.trim().toLowerCase();
  const projectNames = useMemo(
    () => new Map(s.projects.map(({ id, title }) => [id, title])),
    [s.projects],
  );
  const results = useMemo<Result[]>(() => {
    const tasks = s.tasks.filter((task) => !task.trashed);
    if (!search) {
      return tasks
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map((task) => ({ kind: "task", task }));
    }
    const words = search.split(/\s+/);
    return [
      ...s.projects
        .filter((project) =>
          words.every((word) => project.title.toLowerCase().includes(word)),
        )
        .map((project) => ({ kind: "project" as const, project })),
      ...tasks
        .map((task) => {
          const title = task.title.toLowerCase();
          const project = task.projectId
            ? projectNames.get(task.projectId)
            : undefined;
          const content = `${title}\n${task.notes.toLowerCase()}\n${project?.toLowerCase() ?? ""}`;
          return {
            task,
            matches: words.every((word) => content.includes(word)),
            score:
              Number(words.every((word) => title.includes(word))) * 2 +
              Number(task.status !== "done"),
          };
        })
        .filter((entry) => entry.matches)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.task.updatedAt.localeCompare(a.task.updatedAt),
        )
        .map(({ task }) => ({ kind: "task" as const, task })),
    ];
  }, [search, s.projects, s.tasks, projectNames]);
  const pick = (r: Result | undefined) => {
    if (!r) return;
    if (r.kind === "task") onTask(r.task);
    else onProject(r.project);
  };
  const selected = Math.min(index, results.length - 1);
  useEffect(() => {
    activeResult.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selected, results]);
  return (
    <Modal title="Search" className="command-panel find" onClose={onClose}>
      <label className="find-input">
        <Icon name="search" size={18} />
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            selected >= 0 ? `${listId}-${selected}` : undefined
          }
          value={query}
          placeholder="Find a task, note or project…"
          aria-label="Find a task, note or project"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!results.length) return;
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setIndex((selected + delta + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[selected]);
            }
          }}
        />
      </label>
      {!search && results.length > 0 && (
        <h3 className="find-section">Recently updated</h3>
      )}
      <div
        id={listId}
        className="find-results"
        role="listbox"
        aria-label={search ? "Search results" : "Recently updated tasks"}
        hidden={!results.length}
      >
        {results.map((result, i) => {
          const task = result.kind === "task" ? result.task : undefined;
          const title =
            result.kind === "project"
              ? result.project.title
              : result.task.title;
          const project = task?.projectId
            ? projectNames.get(task.projectId)
            : undefined;
          const context =
            result.kind === "project"
              ? "Project"
              : [project, task?.status === "done" && "Done"]
                  .filter(Boolean)
                  .join(" · ");
          return (
            <div
              key={
                result.kind === "task"
                  ? `task-${result.task.id}`
                  : `project-${result.project.id}`
              }
              id={`${listId}-${i}`}
              ref={i === selected ? activeResult : undefined}
              role="option"
              aria-selected={i === selected}
              className="find-result"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(result)}
            >
              <span className="find-result-icon" aria-hidden="true">
                {result.kind === "project" ? (
                  <span
                    className="swatch"
                    style={{ background: projectColor(result.project.id) }}
                  />
                ) : (
                  <Icon
                    name={
                      result.task.status === "done" ? "circle-check" : "circle"
                    }
                    tone={result.task.status === "done" ? "brand" : "muted"}
                  />
                )}
              </span>
              <span className="find-result-copy">
                <span className="find-title" title={title}>
                  {title}
                </span>
                {context && (
                  <span className="find-meta" title={context}>
                    {context}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {results.length > 0 && (
        <div className="find-keys" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Move
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
        </div>
      )}
      <div role="status">
        {results.length === 0 && (
          <div className="find-empty">
            <p>
              {search
                ? "No matching tasks or projects."
                : "Search by task title, notes or project name."}
            </p>
            {search && <p>Try a shorter search or a different word.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

const keyGroups = [
  {
    title: "Navigate",
    shortcuts: [
      ["Search", "Mod K"],
      ["Move down", "↓", "J"],
      ["Move up", "↑", "K"],
      ["Open / close task details", "Enter", "Esc"],
      ["Keyboard shortcuts", "?"],
    ],
  },
  {
    title: "Work with tasks",
    shortcuts: [
      ["Add a task", "N"],
      ["Complete or reopen", "X"],
      ["Complete the open task", "Mod Enter"],
      ["Copy task name", "C"],
      ["Set project", "P"],
      ["Set date", "D"],
      ["Write notes", "E"],
    ],
  },
];
export function KeyboardSheet({ onClose }: { onClose: () => void }) {
  const mod = modifierKey();
  return (
    <Modal
      title="Keyboard shortcuts"
      className="command-panel keys-sheet"
      onClose={onClose}
      closeKey="?"
    >
      <div
        className="keys-sheet-body"
        tabIndex={0}
        role="region"
        aria-label="Shortcut list"
      >
        {keyGroups.map(({ title, shortcuts }) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {shortcuts.map(([action, ...alternatives]) => (
                <div key={action}>
                  <dt>{action}</dt>
                  <dd>
                    {alternatives.map((combo, i) => (
                      <span className="keys-combo" key={combo}>
                        {i > 0 && <span className="keys-or">/</span>}
                        {combo.split(" ").map((key) => (
                          <kbd key={key}>{key === "Mod" ? mod : key}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p>
          Single-key shortcuts pause while you type. Manage them in Settings.
        </p>
      </div>
    </Modal>
  );
}
