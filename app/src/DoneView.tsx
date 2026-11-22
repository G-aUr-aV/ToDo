import { useState, type ReactNode } from "react";
import type { Snapshot, Task } from "../core/model";
import { dayInZone } from "../core/dates";
import { Button, Empty, Icon } from "./components";
import { dateLabel, shiftDate } from "./DateControl";
import { outcomeLine } from "./TaskList";

function completedTasks(tasks: Task[], projectId: string | null) {
  return tasks
    .filter((task) => !task.trashed && task.status === "done" && (!projectId || task.projectId === projectId))
    .map((task) => ({ task, time: task.completedAt ? Date.parse(task.completedAt) : -Infinity }))
    .sort((a, b) => b.time - a.time);
}

export function RecentCompletions({
  snapshot,
  projectId,
  onOpen,
  onDone,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  onOpen: (task: Task) => void;
  onDone: () => void;
}) {
  const cutoff = shiftDate(snapshot.today, -6);
  const recent: { task: Task; day: string }[] = [];
  for (const { task, time } of completedTasks(snapshot.tasks, projectId)) {
    if (!task.completedAt) break;
    const day = dayInZone(new Date(time), snapshot.preferences.timezone);
    if (day < cutoff) break;
    if (day > snapshot.today) continue;
    recent.push({ task, day });
    if (recent.length === 3) break;
  }
  if (!recent.length) return null;

  return (
    <section className="task-ledger recent-completions" aria-labelledby="recent-completions-title">
      <div className="group-title context-heading">
        <h2 id="recent-completions-title">Recently completed</h2>
        <button className="history-link" type="button" onClick={onDone}>
          View Done <Icon name="arrow-right" size={14} />
        </button>
      </div>
      <ul>
        {recent.map(({ task, day }) => {
          const outcome = outcomeLine(task.notes);
          return (
            <li key={task.id}>
              <button type="button" className="recent-task" onClick={() => onOpen(task)}>
                <Icon name="circle-check" size={16} tone="brand" />
                <strong>{task.title}</strong>
                <time dateTime={day}>{dateLabel(day, snapshot.today)}</time>
                {outcome && <span className="row-outcome">{outcome}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Finished work grouped by the local day it was completed. */
export function DoneView({
  snapshot: s,
  projectId,
  row,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  row: (task: Task) => ReactNode;
}) {
  const [older, setOlder] = useState(false);
  const done = completedTasks(s.tasks, projectId).map(({ task, time }) => ({
    task,
    day: task.completedAt ? dayInZone(new Date(time), s.preferences.timezone) : "",
  }));
  const cutoff = shiftDate(s.today, -30);
  // Tasks marked done outside Todo may lack a completion time; always show them.
  const shown = older ? done : done.filter((d) => !d.day || d.day >= cutoff);
  const days = [...new Set(shown.map((d) => d.day))];
  if (!done.length)
    return (
      <Empty icon="circle-check" title="No completed tasks">
        Finished tasks appear here by completion date.
      </Empty>
    );
  return (
    <>
      {days.length > 0 && (
        <div className="task-ledger">
          {days.map((day) => {
            const tasks = shown.filter((d) => d.day === day);
            return (
              <section className="group" key={day || "unknown"}>
                <h2 className="group-title">
                  {day ? dateLabel(day, s.today) : "Completed"}
                  <span className="count">{tasks.length}</span>
                </h2>
                {tasks.map(({ task }) => row(task))}
              </section>
            );
          })}
        </div>
      )}
      {!older && shown.length < done.length && (
        <Button kind="ghost" onClick={() => setOlder(true)}>
          Show older · {done.length - shown.length}
        </Button>
      )}
    </>
  );
}
