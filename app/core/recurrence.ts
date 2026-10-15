import type { Repeat } from "./model";

const dayMilliseconds = 86_400_000;
const calendar = (day: string) => new Date(`${day}T12:00:00Z`);
export function daysBetween(from: string, to: string) {
  return Math.round(
    (calendar(to).valueOf() - calendar(from).valueOf()) / dayMilliseconds,
  );
}
export function addDays(day: string, count: number) {
  const result = calendar(day);
  result.setUTCDate(result.getUTCDate() + count);
  if (result.getUTCFullYear() > 9999)
    throw new Error("The next occurrence is outside the supported calendar.");
  return result.toISOString().slice(0, 10);
}
// Every month is measured from the original anchor, so Jan 31 -> Feb 28 -> Mar 31.
export function occurrenceAt(anchor: string, repeat: Repeat, index: number) {
  if (repeat.frequency !== "monthly")
    return addDays(
      anchor,
      repeat.interval * index * (repeat.frequency === "weekly" ? 7 : 1),
    );
  const original = calendar(anchor);
  const target = calendar(anchor);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + repeat.interval * index);
  const lastDay = new Date(target.valueOf());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(original.getUTCDate(), lastDay.getUTCDate()));
  if (target.getUTCFullYear() > 9999)
    throw new Error("The next occurrence is outside the supported calendar.");
  return target.toISOString().slice(0, 10);
}
export function nextOccurrence(anchor: string, repeat: Repeat, after: string) {
  let index =
    repeat.frequency === "monthly"
      ? Math.max(
          1,
          Math.floor(
            ((Number(after.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 +
              Number(after.slice(5, 7)) -
              Number(anchor.slice(5, 7))) /
              repeat.interval,
          ),
        )
      : Math.max(
          1,
          Math.floor(
            daysBetween(anchor, after) /
              (repeat.interval * (repeat.frequency === "weekly" ? 7 : 1)),
          ),
        );
  let next = occurrenceAt(anchor, repeat, index);
  while (next <= after) next = occurrenceAt(anchor, repeat, ++index);
  return next;
}
// Use calendar days in the workspace timezone rather than 24 elapsed hours.
// A reminder in the skipped spring-forward hour moves forward by the DST gap.
export function shiftReminder(value: string, count: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const local = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const get = (type: string) =>
      parts.find((part) => part.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  };
  const source = new Date(value);
  const wall = local(source);
  const target = Date.parse(
    addDays(wall.slice(0, 10), count) + wall.slice(10) + "Z",
  );
  let candidate = source.valueOf() + count * dayMilliseconds;
  const seen = new Set<number>();
  for (let i = 0; i < 5; i++) {
    const difference = target - Date.parse(local(new Date(candidate)) + "Z");
    if (!difference) return new Date(candidate).toISOString();
    seen.add(candidate);
    const next = candidate + difference;
    if (seen.has(next))
      return new Date(Math.max(candidate, next)).toISOString();
    candidate = next;
  }
  return new Date(candidate).toISOString();
}
