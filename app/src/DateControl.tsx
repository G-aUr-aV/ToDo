import { useState, useEffect, useRef } from "react";
import { Button, Icon, Modal } from "./components";
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (date: string) => new Date(date + "T12:00:00Z");
const shift = (date: string, n: number) => {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export function DateControl({
  value,
  onChange,
  today,
  weekStartsOn = 1,
  kind = "plan",
  disabled = false,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  today: string;
  weekStartsOn?: 0 | 1;
  kind?: "plan" | "deadline";
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value ?? today).slice(0, 7));
  const [cursor, setCursor] = useState(value ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const title = kind === "deadline" ? "Deadline" : "Plan for";
  const text =
    value === today
      ? "Today"
      : value === shift(today, 1)
        ? "Tomorrow"
        : value
          ? new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(parse(value))
          : kind === "deadline"
            ? "No deadline"
            : "No date";
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
  const names =
    weekStartsOn === 1
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function select(value: string | null) {
    onChange(value);
    setOpen(false);
  }
  function moveMonth(delta: number) {
    const d = parse(month + "-01");
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(iso(d).slice(0, 7));
    setCursor(iso(d));
  }
  useEffect(() => {
    if (open)
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)
        ?.focus();
  }, [cursor, month, open]);
  return (
    <>
      <Button
        kind="secondary"
        type="button"
        className="date-control"
        aria-label={label ?? `${title}: ${text}`}
        disabled={disabled}
        onClick={() => {
          setMonth((value ?? today).slice(0, 7));
          setCursor(value ?? today);
          setOpen(true);
        }}
      >
        <span>{text}</span>
        <Icon name="calendar-week" />
      </Button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <div className="date-picker">
            <p className="muted">
              {kind === "deadline"
                ? "When must this task be finished?"
                : "Choose when you intend to work on this task."}
            </p>
            <div className="date-shortcuts">
              <Button
                kind={value === today ? "primary" : "secondary"}
                onClick={() => select(today)}
              >
                Today
              </Button>
              <Button
                kind={value === shift(today, 1) ? "primary" : "secondary"}
                onClick={() => select(shift(today, 1))}
              >
                Tomorrow
              </Button>
            </div>
            <div className="calendar-heading">
              <button
                className="icon-button"
                aria-label="Previous month"
                onClick={() => moveMonth(-1)}
              >
                <Icon name="arrow-left" />
              </button>
              <strong>
                {new Intl.DateTimeFormat("en-GB", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(first)}
              </strong>
              <button
                className="icon-button"
                aria-label="Next month"
                onClick={() => moveMonth(1)}
              >
                <Icon name="arrow-right" />
              </button>
            </div>
            <div className="calendar-weekdays" aria-hidden="true">
              {names.map((n) => (
                <span key={n}>{n}</span>
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
                    aria-label={new Intl.DateTimeFormat("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(parse(day))}
                    className={day === value ? "selected" : ""}
                    onClick={() => select(day)}
                    onKeyDown={(e) => {
                      let target: string | undefined;
                      if (e.key === "ArrowLeft") target = shift(day, -1);
                      if (e.key === "ArrowRight") target = shift(day, 1);
                      if (e.key === "ArrowUp") target = shift(day, -7);
                      if (e.key === "ArrowDown") target = shift(day, 7);
                      if (e.key === "Home")
                        target = shift(
                          day,
                          -((parse(day).getUTCDay() - weekStartsOn + 7) % 7),
                        );
                      if (e.key === "End")
                        target = shift(
                          day,
                          6 - ((parse(day).getUTCDay() - weekStartsOn + 7) % 7),
                        );
                      if (e.key === "PageUp" || e.key === "PageDown") {
                        e.preventDefault();
                        moveMonth(e.key === "PageUp" ? -1 : 1);
                      }
                      if (target) {
                        e.preventDefault();
                        setMonth(target.slice(0, 7));
                        setCursor(target);
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
            <Button kind="ghost" onClick={() => select(null)}>
              {kind === "deadline" ? "No deadline" : "No planned date"}
            </Button>
            <p className="date-helper">
              {kind === "deadline"
                ? "The planned date stays unchanged."
                : "The deadline stays unchanged."}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
