import { useEffect, useRef, useState } from "react";
import { Icon } from "./components";
import { MenuItem } from "./Popover";
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (date: string) => new Date(date + "T12:00:00Z");
export const shiftDate = (date: string, n: number) => {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export function nextMonday(today: string) {
  const day = parse(today).getUTCDay();
  return shiftDate(today, ((8 - day) % 7) || 7);
}
const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(
    parse(date),
  );
/** "Today", "Tomorrow", "Mon 23 Nov" or "23 Nov 2027". */
export function dateLabel(value: string, today: string) {
  if (value === today) return "Today";
  if (value === shiftDate(today, 1)) return "Tomorrow";
  if (value === shiftDate(today, -1)) return "Yesterday";
  const near = Math.abs(parse(value).getTime() - parse(today).getTime()) < 300 * 86400000;
  return near
    ? fmt(value, { weekday: "short", day: "numeric", month: "short" })
    : fmt(value, { day: "numeric", month: "short", year: "numeric" });
}

/** Quick picks and a compact month calendar, shown inside a Popover. */
export function DatePicker({
  value,
  today,
  weekStartsOn = 1,
  kind = "plan",
  onPick,
}: {
  value: string | null;
  today: string;
  weekStartsOn?: 0 | 1;
  kind?: "plan" | "deadline";
  onPick: (value: string | null) => void;
}) {
  const [month, setMonth] = useState((value ?? today).slice(0, 7));
  const [cursor, setCursor] = useState(value ?? today);
  const [moved, setMoved] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const first = parse(month + "-01");
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const total = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const days = Array.from(
    { length: Math.ceil((offset + total) / 7) * 7 },
    (_, i) =>
      i < offset || i >= offset + total
        ? null
        : `${month}-${String(i - offset + 1).padStart(2, "0")}`,
  );
  const names = (weekStartsOn === 1 ? "MTWTFSS" : "SMTWTFS").split("");
  function moveMonth(delta: number) {
    const d = parse(month + "-01");
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(iso(d).slice(0, 7));
    setCursor(iso(d));
    setMoved(true);
  }
  useEffect(() => {
    if (moved)
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)
        ?.focus();
  }, [cursor, month, moved]);
  const picks: [string, string][] = [
    ["Today", today],
    ["Tomorrow", shiftDate(today, 1)],
    ["Next Monday", nextMonday(today)],
  ];
  return (
    <div className="date-picker">
      {picks.map(([name, date]) => (
        <MenuItem
          key={name}
          icon="calendar-week"
          hint={fmt(date, { weekday: "short" })}
          active={value === date}
          onSelect={() => onPick(date)}
        >
          {name}
        </MenuItem>
      ))}
      <div className="calendar">
        <div className="calendar-heading">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous month"
            onClick={() => moveMonth(-1)}
          >
            <Icon name="arrow-left" size={14} />
          </button>
          <strong>{fmt(month + "-01", { month: "long", year: "numeric" })}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Next month"
            onClick={() => moveMonth(1)}
          >
            <Icon name="arrow-right" size={14} />
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {names.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
        <div
          ref={grid}
          className="calendar-grid"
          role="group"
          aria-label="Choose a calendar date"
        >
          {days.map((day, i) =>
            day ? (
              <button
                key={day}
                type="button"
                data-date={day}
                tabIndex={cursor === day ? 0 : -1}
                aria-pressed={value === day}
                aria-label={fmt(day, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                className={
                  (day === value ? "selected " : "") +
                  (day === today ? "today " : "") +
                  (day < today ? "past" : "")
                }
                onClick={() => onPick(day)}
                onKeyDown={(e) => {
                  const step: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  };
                  if (e.key in step) {
                    e.preventDefault();
                    e.stopPropagation();
                    const target = shiftDate(day, step[e.key]);
                    setMonth(target.slice(0, 7));
                    setCursor(target);
                    setMoved(true);
                  }
                }}
              >
                {parse(day).getUTCDate()}
              </button>
            ) : (
              <span key={"empty" + i} />
            ),
          )}
        </div>
      </div>
      {value && (
        <MenuItem icon="x" onSelect={() => onPick(null)}>
          {kind === "deadline" ? "Remove deadline" : "Remove date"}
        </MenuItem>
      )}
    </div>
  );
}
