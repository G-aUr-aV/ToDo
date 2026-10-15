import type { Task, Project } from "./model";
export function active(task: Task) {
  return !task.trashed && task.status !== "done";
}
export function inToday(task: Task, today: string) {
  return (
    active(task) &&
    !!(
      (task.scheduled && task.scheduled <= today) ||
      (task.due && task.due <= today)
    )
  );
}
export function byPriority(a: Task, b: Task) {
  return (
    Number(b.focus) - Number(a.focus) ||
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    (a.scheduled ?? "9999").localeCompare(b.scheduled ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
export function projectFor(task: Task, projects: Project[]) {
  return projects.find((p) => p.id === task.projectId);
}
