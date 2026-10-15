import type { Snapshot, Task } from "./model";
import { inToday, byPriority } from "./task-views";
export type TodayTask = Pick<
  Task,
  "id" | "title" | "revision" | "scheduled" | "due" | "focus"
> & { project: string | null };
export type TodaySnapshot = {
  vaultKey: string;
  vaultName: string;
  today: string;
  now: string;
  count: number;
  needsAttention: number;
  reminders: Pick<Task, "id" | "title" | "revision" | "reminder">[];
  groups: { key: string; label: string; tasks: TodayTask[] }[];
};
export function todaySummary(snapshot: Snapshot): TodaySnapshot {
  const tasks = snapshot.tasks
    .filter((t) => inToday(t, snapshot.today))
    .sort(byPriority);
  const overdue = tasks.filter((t) => !!t.due && t.due < snapshot.today);
  const focus = tasks.filter((t) => t.focus && !overdue.includes(t));
  const other = tasks.filter((t) => !overdue.includes(t) && !focus.includes(t));
  const compact = (task: Task): TodayTask => ({
    id: task.id,
    title: task.title,
    revision: task.revision,
    due: task.due,
    scheduled: task.scheduled,
    focus: task.focus,
    project:
      snapshot.projects.find((p) => p.id === task.projectId)?.title ?? null,
  });
  return {
    vaultKey: snapshot.vaultKey,
    vaultName: snapshot.vaultName,
    today: snapshot.today,
    now: snapshot.now,
    count: tasks.length,
    needsAttention: snapshot.diagnostics.length,
    reminders: snapshot.tasks
      .filter(
        (task) => !task.trashed && task.status !== "done" && task.reminder,
      )
      .map(({ id, title, revision, reminder }) => ({
        id,
        title,
        revision,
        reminder,
      })),
    groups: [
      { key: "overdue", label: "Deadline passed", tasks: overdue.map(compact) },
      { key: "focus", label: "Your focus", tasks: focus.map(compact) },
      {
        key: "other",
        label: focus.length || overdue.length ? "Other tasks" : "Your tasks",
        tasks: other.map(compact),
      },
    ].filter((g) => g.tasks.length),
  };
}
