import { useEffect, useId, useState } from "react";
import type { TaskPatch } from "../core/model";
import { reminderInput, reminderInstant } from "./task-time";

export function ScheduleFields({
  reminder,
  repeat,
  timezone,
  onChange,
  disabled = false,
}: {
  reminder: string | null;
  repeat: TaskPatch["repeat"];
  timezone: string;
  onChange: (patch: Pick<TaskPatch, "reminder" | "repeat">) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState(() => reminderInput(reminder, timezone));
  const [error, setError] = useState("");
  const hintId = useId();
  useEffect(() => {
    setInput(reminderInput(reminder, timezone));
    setError("");
  }, [reminder, timezone]);
  function editReminder(control: HTMLInputElement) {
    const value = control.value;
    setInput(value);
    const instant = value ? reminderInstant(value, timezone) : null;
    const message =
      value && !instant
        ? "Choose a valid time. This time may be skipped by daylight saving."
        : "";
    setError(message);
    control.setCustomValidity(message);
    if (!message) onChange({ reminder: instant });
  }
  return (
    <div className="schedule-fields">
      <label className="field">
        <span>Reminder</span>
        <input
          type="datetime-local"
          aria-label="Reminder"
          value={input}
          disabled={disabled}
          aria-describedby={hintId}
          aria-invalid={!!error}
          onInput={(event) => editReminder(event.currentTarget)}
          onChange={(event) => editReminder(event.currentTarget)}
        />
        <small id={hintId}>
          {error || `In ${timezone}. Keep Todo or Mini open for reminders.`}
        </small>
      </label>
      <div className="repeat-fields">
        <label className="field">
          <span>Repeat</span>
          <select
            aria-label="Repeat"
            value={repeat?.frequency ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                repeat: event.target.value
                  ? {
                      frequency: event.target.value as
                        "daily" | "weekly" | "monthly",
                      interval: repeat?.interval ?? 1,
                    }
                  : null,
              })
            }
          >
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {repeat && (
          <label className="field repeat-interval">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              aria-label="Repeat interval"
              value={repeat.interval}
              disabled={disabled}
              onChange={(event) => {
                const interval = Number(event.target.value);
                if (
                  Number.isInteger(interval) &&
                  interval >= 1 &&
                  interval <= 365
                )
                  onChange({ repeat: { ...repeat, interval } });
              }}
            />
            <small>
              {repeat.frequency === "daily"
                ? "day(s)"
                : repeat.frequency === "weekly"
                  ? "week(s)"
                  : "month(s)"}
            </small>
          </label>
        )}
        {repeat && (
          <small className="repeat-hint">
            Completing this task creates the next one. Missed dates are skipped.
          </small>
        )}
      </div>
    </div>
  );
}
