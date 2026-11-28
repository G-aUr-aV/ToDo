import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Snapshot, Task } from "../core/model";
import { call } from "./client";
import { Button, Empty, Icon, errorMessage } from "./components";
import { DatePicker, dateLabel } from "./DateControl";
import { Popover } from "./Popover";

type Selection = { selected: boolean; toggle: () => void };

export function Upcoming({
  tasks,
  snapshot,
  row,
  onAdd,
  onMoved,
  onRefresh,
}: {
  tasks: Task[];
  snapshot: Snapshot;
  row: (task: Task, selection?: Selection) => ReactNode;
  onAdd: (date: string) => void;
  onMoved: (tasks: Task[]) => void;
  onRefresh: () => Promise<Snapshot | null>;
}) {
  const [selected, setSelected] = useState<Map<string, string> | null>(null);
  const [destination, setDestination] = useState<string | undefined>();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selectButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!destination) return;
    const frame = requestAnimationFrame(() => confirmButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [destination]);
  const days = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.scheduled) continue;
    const entries = days.get(task.scheduled) ?? [];
    entries.push(task);
    days.set(task.scheduled, entries);
  }
  const moving = tasks.filter(({ id }) => selected?.has(id));
  const deadlineWarnings = moving.filter(({ due }) => destination && due && due < destination);
  function closeSelection() {
    setSelected(null);
    setDestination(undefined);
    setError("");
    requestAnimationFrame(() => selectButton.current?.focus());
  }
  async function move() {
    if (pending || !destination || !selected?.size) return;
    setPending(true);
    setError("");
    try {
      const updated = await call<Task[]>("bulkSchedule", {
        scheduled: destination,
        tasks: [...selected].map(([id, revision]) => ({ id, revision })),
      });
      onMoved(updated);
      closeSelection();
    } catch (e) {
      setError(errorMessage(e));
      const latest = await onRefresh();
      if (latest) {
        setSelected(new Map(latest.tasks
          .filter((task) => selected.has(task.id) && !task.trashed && task.status !== "done" &&
            task.scheduled && task.scheduled > latest.today)
          .map(({ id, revision }) => [id, revision])));
      }
    } finally {
      setPending(false);
    }
  }
  if (!tasks.length && !selected) {
    return (
      <Empty icon="calendar-week" title="No upcoming tasks">
        Choose a future plan date when you add or edit a task.
      </Empty>
    );
  }
  return (
    <>
      {snapshot.storage === "sqlite" && (
        <div className="upcoming-controls">
          {selected ? (
            <>
              <div className="upcoming-selection">
                <span role="status">{moving.length} selected</span>
                <Button kind="secondary" disabled={!moving.length || pending} onClick={(e) => setAnchor(e.currentTarget)}>
                  {destination ? dateLabel(destination, snapshot.today) : "Choose date"}
                </Button>
                {destination && (
                  <button className="button primary" type="button" ref={confirmButton} disabled={!moving.length || pending} onClick={() => void move()}>
                    {pending ? "Moving…" : `Move ${moving.length === 1 ? "task" : "tasks"}`}
                  </button>
                )}
                <Button kind="ghost" disabled={pending} onClick={closeSelection}>Cancel</Button>
              </div>
              {!!deadlineWarnings.length && (
                <div className="move-warnings" role="status">
                  <strong>Deadlines before the new plan date</strong>
                  <ul>{deadlineWarnings.map((task) => (
                    <li key={task.id}>{task.title} · due {dateLabel(task.due!, snapshot.today)}</li>
                  ))}</ul>
                </div>
              )}
              {error && <p className="form-error" role="alert">{error} Review the selected tasks and try again.</p>}
            </>
          ) : (
            <button className="button secondary" ref={selectButton} onClick={() => {
              setSelected(new Map());
              requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>(".row-select")?.focus());
            }}>
              Select tasks
            </button>
          )}
        </div>
      )}
      <div className="task-ledger upcoming-ledger" ref={list}>
        {[...days].map(([date, entries]) => (
          <section key={date} className="group upcoming-group">
            <div className="upcoming-day">
              <h2><time dateTime={date}>{dateLabel(date, snapshot.today)}</time></h2>
              {selected ? (
                <Button
                  kind="ghost"
                  disabled={!moving.length || pending}
                  onClick={() => {
                    if (destination === date) confirmButton.current?.focus();
                    else setDestination(date);
                  }}
                  aria-label={`Move selected tasks to ${dateLabel(date, snapshot.today)}`}
                >
                  Move here
                </Button>
              ) : (
                <Button kind="ghost" onClick={() => onAdd(date)} aria-label={`Add task for ${dateLabel(date, snapshot.today)}`}>
                  <Icon name="plus" size={15} /> Add task
                </Button>
              )}
            </div>
            {entries.map((task) => row(task, selected ? {
              selected: selected.has(task.id),
              toggle() {
                if (pending) return;
                setSelected((previous) => {
                  const next = new Map(previous);
                  if (next.has(task.id)) next.delete(task.id);
                  else if (next.size < 500) next.set(task.id, task.revision);
                  return next;
                });
              },
            } : undefined))}
          </section>
        ))}
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Move tasks to" width={252}>
          <DatePicker
            value={destination ?? null}
            today={snapshot.today}
            weekStartsOn={snapshot.preferences.weekStartsOn}
            onPick={(value) => {
              setDestination(value ?? undefined);
              setAnchor(null);
            }}
          />
        </Popover>
      )}
    </>
  );
}
