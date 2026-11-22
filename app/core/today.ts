import type { Snapshot, Task } from "./model";
import { inNow, byPriority } from "./task-views";
export type TodayTask = Pick<
  Task,
  "id" | "title" | "revision" | "scheduled" | "due"
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
// Mini shows the same "now" work as the Tasks list, without note bodies.
export function todaySummary(snapshot: Snapshot): TodaySnapshot {
  const tasks = snapshot.tasks
    .filter((t) => inNow(t, snapshot.today))
    .sort(byPriority);
  const overdue = tasks.filter((t) => !!t.due && t.due < snapshot.today);
  const rest = tasks.filter((t) => !overdue.includes(t));
  const title = (id: string | null) =>
    snapshot.projects.find((p) => p.id === id)?.title ?? null;
  const compact = (task: Task): TodayTask => ({
    id: task.id,
    title: task.title,
    revision: task.revision,
    due: task.due,
    scheduled: task.scheduled,
    project: title(task.projectId),
  });
  const known = new Set(snapshot.projects.map((p) => p.id));
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
      { key: "overdue", label: "Deadline passed", tasks: overdue },
      ...snapshot.projects.map((p) => ({
        key: "project:" + p.id,
        label: p.title,
        tasks: rest.filter((t) => t.projectId === p.id),
      })),
      {
        key: "none",
        label: "No project",
        tasks: rest.filter((t) => !t.projectId || !known.has(t.projectId)),
      },
    ]
      .filter((g) => g.tasks.length)
      .map((g) => ({ ...g, tasks: g.tasks.map(compact) })),
  };
}
