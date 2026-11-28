import type { Task } from "./model";
export function active(task: Task) {
  return !task.trashed && task.status !== "done";
}
// Work to do now: anything without a future plan date. A deadline that is due
// keeps a task here even when its plan date was moved ahead.
export function inNow(task: Task, today: string) {
  return (
    active(task) &&
    (!(task.scheduled && task.scheduled > today) ||
      !!(task.due && task.due <= today))
  );
}
export function isLater(task: Task, today: string) {
  return active(task) && !inNow(task, today);
}
export function inToday(task: Task, today: string) {
  return active(task) && (
    (task.scheduled !== null && task.scheduled <= today) ||
    (task.due !== null && task.due <= today)
  );
}
export function inUpcoming(task: Task, today: string) {
  return active(task) && task.scheduled !== null && task.scheduled > today;
}
export function isUnscheduled(task: Task) {
  return active(task) && task.scheduled === null;
}
export function byPriority(a: Task, b: Task) {
  return (
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
