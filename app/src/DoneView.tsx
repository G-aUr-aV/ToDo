import { useMemo, useState, type ReactNode } from "react";
import type { Snapshot, Task } from "../core/model";
import { dayInZone } from "../core/dates";
import { Button, Empty, Icon } from "./components";
import { dateLabel, shiftDate } from "./DateControl";

const doneBatchSize = 30;

function completedTasks(tasks: Task[], projectId: string | null) {
  return tasks
    .filter((task) => !task.trashed && task.status === "done" && (!projectId || task.projectId === projectId))
    .map((task) => ({ task, time: task.completedAt ? Date.parse(task.completedAt) : -Infinity }))
    .sort((a, b) => b.time - a.time);
}

/** Finished work grouped by the local day it was completed. */
export function DoneView({
  snapshot: s,
  projectId,
  selectedTaskId,
  row,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  selectedTaskId: string | null;
  row: (task: Task) => ReactNode;
}) {
  const [limit, setLimit] = useState(doneBatchSize);
  const [older, setOlder] = useState(false);
  const cutoff = shiftDate(s.today, -30);
  const done = useMemo(() => completedTasks(s.tasks, projectId).map(({ task, time }) => ({
    task,
    day: task.completedAt ? dayInZone(new Date(time), s.preferences.timezone) : "",
  })), [s.tasks, s.preferences.timezone, projectId]);
  if (!done.length)
    return (
      <Empty icon="circle-check" title="No completed tasks">
        Finished tasks appear here by completion date.
      </Empty>
    );
  // Tasks marked done outside Todo may lack a completion time.
  const recent = done.filter(({ day }) => !day || day >= cutoff);
  const olderTasks = done.filter(({ day }) => day && day < cutoff);
  const available = older ? [...recent, ...olderTasks] : recent;
  const visible = new Set(available.slice(0, limit).map(({ task }) => task.id));
  // Deep links and search can open an older task without rendering the intervening history.
  const groups = new Map<string, Task[]>();
  for (const { day, task } of done) {
    if (!visible.has(task.id) && task.id !== selectedTaskId) continue;
    const tasks = groups.get(day) ?? [];
    tasks.push(task);
    groups.set(day, tasks);
  }
  const hasMore = limit < available.length;
  const hasOlder = !older && olderTasks.length > 0;

  function showMore() {
    const next = hasMore ? available[limit] : olderTasks[0];
    if (hasMore) setLimit(limit + doneBatchSize);
    else {
      setOlder(true);
      setLimit(available.length + doneBatchSize);
    }
    if (next) {
      requestAnimationFrame(() => {
        const target = document.querySelector(`[data-task-id="${next.task.id}"]`)
          ?.querySelector<HTMLElement>(".task-row, .task-card");
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "nearest" });
      });
    }
  }
  return (
    <>
      {groups.size > 0 ? (
        <div className="task-ledger">
          {[...groups].map(([day, tasks]) => (
            <section className="group" key={day || "unknown"}>
              <h2 className="group-title">
                {day ? dateLabel(day, s.today) : "Completed"}
                <span className="count">{tasks.length}</span>
              </h2>
              {tasks.map(row)}
            </section>
          ))}
        </div>
      ) : (
        <p className="lead">No completions in the past 30 days.</p>
      )}
      {(hasMore || hasOlder) && (
        <Button kind="ghost" className="done-more" onClick={showMore}>
          {hasMore ? "Show more" : "Show older"} · {hasMore ? available.length - limit : olderTasks.length}
        </Button>
      )}
    </>
  );
}
