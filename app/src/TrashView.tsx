import { useState } from "react";
import type { Snapshot, Task } from "../core/model";
import { Button, Icon } from "./components";
import { projectColor } from "./project-color";
import { RichTitle } from "./TaskList";

export function TrashView({ snapshot, onRestore, onRestoredFocus, onTasks }: {
  snapshot: Snapshot;
  onRestore: (task: Task) => Promise<Task | null>;
  onRestoredFocus: () => void;
  onTasks: () => void;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const tasks = snapshot.tasks
    .filter((task) => task.trashed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));

  async function restore(task: Task, button: HTMLButtonElement) {
    setRestoring(task.id);
    try {
      const restored = await onRestore(task);
      if (restored && (document.activeElement === button || document.activeElement === document.body)) {
        onRestoredFocus();
      }
    } finally {
      setRestoring(null);
    }
  }

  return (
    <>
      {tasks.length ? (
        <>
          <h2 className="trash-list-heading">Removed tasks <span className="section-count">{tasks.length}</span></h2>
          <ul className="trash-list">
            {tasks.map((task) => {
              const project = task.projectId ? projects.get(task.projectId) : null;
              return (
                <li className="trash-row" key={task.id}>
                  <div className="trash-task">
                    <div className="row-title"><RichTitle text={task.title} template={snapshot.preferences.issueLinkTemplate} /></div>
                    <div className="trash-meta">
                      {project && <span className="swatch" style={{ background: projectColor(project.id) }} />}
                      <span>{project?.title ?? "No project"}</span>
                      <span className="trash-destination">Returns to {task.status === "done" ? "Done" : "Tasks"}</span>
                    </div>
                  </div>
                  <Button
                    kind="secondary"
                    icon="restore"
                    disabled={restoring !== null}
                    aria-label={`Restore ${task.title}`}
                    onClick={(event) => void restore(task, event.currentTarget)}
                  >
                    {restoring === task.id ? "Restoring…" : "Restore"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="trash-empty">
          <span className="trash-empty-icon"><Icon name="trash" size={25} /></span>
          <h2>Trash is empty</h2>
          <p>Tasks you move to Trash will appear here.</p>
          <Button kind="secondary" icon="arrow-left" onClick={onTasks}>Back to tasks</Button>
        </div>
      )}
    </>
  );
}
