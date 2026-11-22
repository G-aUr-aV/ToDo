import { useState, type ReactNode } from "react";
import type { Snapshot, Task } from "../core/model";
import { dayInZone } from "../core/dates";
import { Button, Empty } from "./components";
import { dateLabel, shiftDate } from "./DateControl";

/** Finished work grouped by the local day it was completed. */
export function DoneView({
  snapshot: s,
  projectId,
  row,
}: {
  snapshot: Snapshot;
  projectId: string | null;
  row: (task: Task) => ReactNode;
}) {
  const [older, setOlder] = useState(false);
  const zone = s.preferences.timezone;
  const done = s.tasks
    .filter(
      (t) =>
        !t.trashed &&
        t.status === "done" &&
        (!projectId || t.projectId === projectId),
    )
    .map((t) => ({
      t,
      day: t.completedAt ? dayInZone(new Date(t.completedAt), zone) : "",
    }))
    .sort((a, b) => (b.t.completedAt ?? "").localeCompare(a.t.completedAt ?? ""));
  const cutoff = shiftDate(s.today, -30);
  // Tasks marked done outside Todo may lack a completion time; always show them.
  const shown = older ? done : done.filter((d) => !d.day || d.day >= cutoff);
  const days = [...new Set(shown.map((d) => d.day))];
  if (!done.length)
    return (
      <Empty title="Nothing finished yet.">
        Completed tasks gather here by day, with what was done.
      </Empty>
    );
  return (
    <>
      {days.map((day) => {
        const tasks = shown.filter((d) => d.day === day);
        return (
          <section className="group" key={day || "unknown"}>
            <h2 className="group-title">
              {day ? dateLabel(day, s.today) : "Completed"}
              <span className="count">{tasks.length}</span>
            </h2>
            {tasks.map((d) => row(d.t))}
          </section>
        );
      })}
      {!older && shown.length < done.length && (
        <Button kind="ghost" onClick={() => setOlder(true)}>
          Show older · {done.length - shown.length}
        </Button>
      )}
    </>
  );
}
