// Small, dependency-free helpers shared by the full app and Mini.
export type ReminderTask = {
  id: string;
  title: string;
  revision: string;
  reminder: string | null;
};

export function reminderInput(
  instant: string | null,
  timezone: string,
): string {
  if (!instant || !Number.isFinite(Date.parse(instant))) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Resolve a wall-clock time in the vault timezone, including non-hour offsets.
// Missing spring-forward times are rejected. Repeated fall-back times use the
// earlier occurrence; retaining an unchanged input retains its original instant.
export function reminderInstant(
  input: string,
  timezone: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const wall = Date.parse(input + ":00Z");
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== input
  )
    return null;
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3_600_000;
    const local = reminderInput(new Date(sample).toISOString(), timezone);
    offsets.add(Date.parse(local + ":00Z") - sample);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter(
      (instant) =>
        reminderInput(new Date(instant).toISOString(), timezone) === input,
    )
    .sort((a, b) => a - b);
  return candidates.length ? new Date(candidates[0]).toISOString() : null;
}

export function dueReminders<T extends ReminderTask>(
  tasks: T[],
  now: number,
): T[] {
  return tasks
    .filter((task) => task.reminder && Date.parse(task.reminder) <= now)
    .sort(
      (a, b) =>
        Date.parse(a.reminder!) - Date.parse(b.reminder!) ||
        a.id.localeCompare(b.id),
    );
}

export function completedOn(
  instant: string | null,
  day: string,
  timezone: string,
): boolean {
  if (!instant || !Number.isFinite(Date.parse(instant))) return false;
  return reminderInput(instant, timezone).slice(0, 10) === day;
}
