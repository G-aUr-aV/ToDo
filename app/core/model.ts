import { z } from "zod";
import { validDate } from "./dates";
export { validDate, dayInZone } from "./dates";
export const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const date = z
  .string()
  .refine(validDate, "Choose a valid calendar date.")
  .nullable();
export function validTimestamp(value: string) {
  const parts =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  return (
    !!parts &&
    validDate(parts[1]) &&
    Number(parts[2]) < 24 &&
    Number(parts[3]) < 60 &&
    Number(parts[4]) < 60 &&
    (parts[5] === "Z" ||
      (Number(parts[5].slice(1, 3)) < 24 && Number(parts[5].slice(4)) < 60)) &&
    Number.isFinite(Date.parse(value))
  );
}
export const repeatSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(365),
  })
  .strict();
export type Repeat = z.infer<typeof repeatSchema>;
export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a task name.").max(240),
    status: z.enum(["inbox", "todo", "doing", "done"]),
    scheduled: date,
    due: date,
    projectId: uuid.nullable(),
    focus: z.boolean(),
    trashed: z.boolean(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30),
    notes: z.string().max(500_000),
    reminder: z
      .string()
      .refine(
        validTimestamp,
        "Choose a reminder date and time with a timezone.",
      )
      .nullable(),
    repeat: repeatSchema.nullable(),
  })
  .partial()
  .strict();
export const taskCreateSchema = taskPatchSchema
  .extend({
    title: z.string().trim().min(1, "Enter a task name.").max(240),
    requestId: uuid,
  })
  .strict();
export const projectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    notes: z.string().max(500_000),
    archived: z.boolean(),
  })
  .partial()
  .strict();
export const projectCreateSchema = projectPatchSchema
  .extend({ title: z.string().trim().min(1).max(120), requestId: uuid })
  .strict();
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type Task = {
  id: string;
  title: string;
  status: "inbox" | "todo" | "doing" | "done";
  scheduled: string | null;
  due: string | null;
  project: string | null;
  projectId: string | null;
  focus: boolean;
  trashed: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  previousStatus: "inbox" | "todo" | "doing";
  notes: string;
  revision: string;
  path: string;
  reminder: string | null;
  repeat: Repeat | null;
  originalScheduled: string | null;
  rolloverCount: number;
  lastRolledAt: string | null;
  recurrenceSourceId: string | null;
  nextOccurrenceId: string | null;
  undoVersion?: string;
};
export type Project = {
  id: string;
  title: string;
  notes: string;
  archived: boolean;
  revision: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};
export type Diagnostic = {
  id: string;
  path: string;
  message: string;
  adoptable: boolean;
  revision: string;
};
export type Preferences = {
  timezone: string;
  weekStartsOn: 0 | 1;
  startPage: string;
  obsidianVault: string;
  autoRollover: boolean;
};
export const preferenceSchema = z
  .object({
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    startPage: z.enum(["today", "inbox", "upcoming", "all", "projects"]),
    obsidianVault: z.string().max(160),
    autoRollover: z.boolean().default(true),
  })
  .strict();
export const defaultPreferences: Preferences = {
  timezone: "Asia/Kolkata",
  weekStartsOn: 1,
  startPage: "today",
  obsidianVault: "",
  autoRollover: true,
};
export type Snapshot = {
  tasks: Task[];
  projects: Project[];
  diagnostics: Diagnostic[];
  preferences: Preferences;
  vaultName: string;
  vaultKey: string;
  now: string;
  today: string;
  version: string;
};
export type Version = {
  id: string;
  savedAt: string;
  title: string;
  notes: string;
};
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public current?: Task | Project,
  ) {
    super(message);
  }
}
export { active, inToday, byPriority, projectFor } from "./task-views";
