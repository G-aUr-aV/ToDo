export function miniHref() {
  return new URL("/mini", location.origin).toString();
}
export function openMini() {
  location.assign(miniHref());
}
export function fullHref(taskId?: string) {
  const url = new URL("/", location.origin);
  if (taskId) url.searchParams.set("task", taskId);
  return url.toString();
}
