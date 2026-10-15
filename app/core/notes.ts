import { createHash } from "node:crypto";
import { parseDocument, Document } from "yaml";
import type { Task, Project } from "./model";
import { validDate, validTimestamp, repeatSchema, uuid } from "./model";
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const MAX_NOTE_BYTES = 600_000;
export type ParsedNote = {
  document: Document;
  body: string;
  newline: string;
  data: Record<string, unknown>;
};
export function parseNote(raw: string): ParsedNote {
  if (Buffer.byteLength(raw) > MAX_NOTE_BYTES)
    throw new Error("This note is too large to edit safely.");
  const lines = raw.split(/(?<=\n)/);
  const first = lines[0]?.replace(/\r?\n$/, "");
  if (first !== "---")
    throw new Error(
      "Add YAML properties starting with --- before adopting this task.",
    );
  const end = lines.findIndex(
    (line, i) => i > 0 && line.replace(/\r?\n$/, "") === "---",
  );
  if (end < 0) throw new Error("The properties block has no closing ---.");
  const document = parseDocument(lines.slice(1, end).join(""), {
    keepSourceTokens: true,
    uniqueKeys: true,
    strict: true,
  });
  if (document.errors.length)
    throw new Error(
      "The YAML properties are invalid: " +
        document.errors[0].message.split("\n")[0],
    );
  if (document.warnings.length)
    throw new Error("This YAML uses an unsupported directive or tag.");
  const data = document.toJS({ maxAliasCount: 10 });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Task properties must be a YAML map.");
  return {
    document,
    body: lines.slice(end + 1).join(""),
    newline: raw.includes("\r\n") ? "\r\n" : "\n",
    data,
  };
}
export function serialize(note: ParsedNote) {
  const header = note.document
    .toString({ lineWidth: 0 })
    .replace(/\n/g, note.newline);
  return "---" + note.newline + header + "---" + note.newline + note.body;
}
export function freshNote(data: Record<string, unknown>, notes = "") {
  return serialize({
    document: new Document(data),
    body: notes ? `\n${notes}\n` : "\n",
    newline: "\n",
    data,
  });
}
const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : fallback;
function checks(data: Record<string, unknown>, kind: string) {
  if (data.schema_version !== 1)
    throw new Error("Unsupported schema version. Expected schema_version: 1.");
  if (data.type !== kind) throw new Error(`Expected type: ${kind}.`);
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 240
  )
    throw new Error("The note needs a valid title.");
  if (data.id !== undefined && !uuid.safeParse(data.id).success)
    throw new Error("The task identity is not a UUID.");
}
export function taskFrom(
  note: ParsedNote,
  path: string,
  revision: string,
  fallbackTime: string,
): Task {
  const d = note.data;
  checks(d, "task");
  for (const name of ["created_at", "updated_at", "completed_at"])
    if (
      d[name] != null &&
      (typeof d[name] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(str(d[name])) ||
        !Number.isFinite(Date.parse(str(d[name]))))
    )
      throw new Error(`Invalid ${name} timestamp. Use an ISO date and time.`);
  if (
    d.status !== undefined &&
    !["inbox", "todo", "doing", "done"].includes(str(d.status))
  )
    throw new Error("Invalid task status.");
  for (const name of [
    "scheduled",
    "due",
    "original_scheduled",
    "repeat_anchor",
    "repeat_occurrence_scheduled",
  ])
    if (
      d[name] != null &&
      (typeof d[name] !== "string" || !validDate(str(d[name])))
    )
      throw new Error(`Invalid ${name} date. Use YYYY-MM-DD.`);
  for (const name of ["reminder_at", "last_rolled_at"])
    if (
      d[name] != null &&
      (typeof d[name] !== "string" || !validTimestamp(str(d[name])))
    )
      throw new Error(
        `Invalid ${name} timestamp. Use an ISO date and time with a timezone.`,
      );
  if (d.repeat != null && !repeatSchema.safeParse(d.repeat).success)
    throw new Error(
      "Repeat must have a daily, weekly or monthly frequency and an interval from 1 to 365.",
    );
  if (
    d.rollover_count != null &&
    (!Number.isSafeInteger(d.rollover_count) || Number(d.rollover_count) < 0)
  )
    throw new Error(
      "The rollover_count property must be a nonnegative integer.",
    );
  for (const name of ["recurrence_source_id", "next_occurrence_id"])
    if (d[name] != null && !uuid.safeParse(d[name]).success)
      throw new Error(`Invalid ${name} identity.`);
  for (const name of ["focus", "trashed"])
    if (d[name] != null && typeof d[name] !== "boolean")
      throw new Error(`The ${name} property must be true or false.`);
  if (d.project != null && typeof d.project !== "string")
    throw new Error("The project property must be a wiki link.");
  if (
    d.tags != null &&
    (!Array.isArray(d.tags) || d.tags.some((t) => typeof t !== "string"))
  )
    throw new Error("Tags must be a list of text labels.");
  return {
    id: str(d.id).toLowerCase(),
    title: str(d.title).trim(),
    status: (d.status ?? "inbox") as Task["status"],
    scheduled: (d.scheduled as string) ?? null,
    due: (d.due as string) ?? null,
    project: (d.project as string) ?? null,
    projectId: null,
    focus: d.focus === true,
    trashed: d.trashed === true,
    tags: (d.tags as string[]) ?? [],
    createdAt: str(d.created_at, fallbackTime),
    updatedAt: str(d.updated_at, fallbackTime),
    completedAt: typeof d.completed_at === "string" ? d.completed_at : null,
    previousStatus: ["inbox", "todo", "doing"].includes(str(d.previous_status))
      ? (d.previous_status as Task["previousStatus"])
      : "todo",
    notes: note.body,
    revision,
    path,
    reminder: (d.reminder_at as string) ?? null,
    repeat: d.repeat == null ? null : repeatSchema.parse(d.repeat),
    originalScheduled: (d.original_scheduled as string) ?? null,
    rolloverCount: Number(d.rollover_count ?? 0),
    lastRolledAt: (d.last_rolled_at as string) ?? null,
    recurrenceSourceId:
      d.recurrence_source_id == null
        ? null
        : uuid.parse(d.recurrence_source_id),
    nextOccurrenceId:
      d.next_occurrence_id == null ? null : uuid.parse(d.next_occurrence_id),
  };
}
export function projectFrom(
  note: ParsedNote,
  path: string,
  revision: string,
  fallbackTime: string,
): Project {
  const d = note.data;
  checks(d, "project");
  if (d.archived != null && typeof d.archived !== "boolean")
    throw new Error("Archived must be true or false.");
  return {
    id: str(d.id).toLowerCase(),
    title: str(d.title).trim(),
    notes: note.body,
    archived: d.archived === true,
    revision,
    path,
    createdAt: str(d.created_at, fallbackTime),
    updatedAt: str(d.updated_at, fallbackTime),
  };
}
