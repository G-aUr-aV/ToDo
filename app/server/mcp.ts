// A small, stateless MCP server (Streamable HTTP, JSON responses) so agents can
// find, update and close tasks. Every write goes through the same Vault engine
// as the web app, so revisions, recovery versions and day lists stay intact.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "../core/operations";
import {
  AppError,
  dayInZone,
  validDate,
  type Project,
  type Snapshot,
  type Task,
} from "../core/model";
import { errorData } from "../core/operations";
import { active } from "../core/task-views";

const VERSIONS = ["2025-06-18", "2025-03-26"];

export const instructions = [
  "Todo is the owner's personal task list. To change a task whose id you don't already have, find it with find_tasks across all projects; if more than one task plausibly fits the request, ask the owner which one.",
  "Notes are each task's working record in Markdown for the owner to read later: plain words, only what the owner said or you verified, no secrets.",
  "add_task notes: real context only (a source link, what done means); omit them otherwise. Record findings with update_task.progress, one line each; Todo adds the workspace time and the '## Progress' heading.",
  "Close with complete_task.outcome: what was done or decided, the root cause for a bug, and how it was verified, without repeating Progress lines. Todo saves it under '## Outcome'. Add each URL (PR, commit, trace, Slack) with update_task.link; issue keys can stay inline.",
  "Complete a task only when the work is verified done or the owner says so.",
  "For a new task inside a git repository, use the project named after the repository folder (create it with add_project, description 'Repo: <name>'); otherwise choose a project whose description fits, or none. Do not invent other projects.",
].join("\n");

const date = z
  .string()
  .refine(validDate, "Use a calendar date like 2026-11-23.")
  .nullable();
const id = z.string().uuid("Use the task id returned by find_tasks.");

/** Add a list line to a "## <section>" of the note, creating the section if needed. */
export function addLine(body: string, name: string, entry: string) {
  const heading = new RegExp(`^## ${name}[ \\t]*$`, "m").exec(body);
  if (!heading) return appendText(body, `## ${name}\n${entry}`);
  if (body.includes(entry)) return body;
  const start = heading.index + heading[0].length;
  const next = body.slice(start).search(/^## /m);
  const end = next < 0 ? body.length : start + next;
  const section = body.slice(start, end).trimEnd();
  const rest = body.slice(end);
  return body.slice(0, start) + section + "\n" + entry + "\n" + (rest ? "\n" + rest : "");
}
const oneLine = (text: string) => text.trim().replace(/\s*\n\s*/g, " ");
/** Add a timestamped line to the note's Progress section. */
export function addProgress(body: string, line: string, stamp: string) {
  return addLine(body, "Progress", `- ${stamp} — ${oneLine(line)}`);
}
// Words split on spaces and on _ - / . : so "schema_builder" finds "schema builder".
const words = (text: string) =>
  text.toLowerCase().split(/[\s_\-/.:]+/).filter(Boolean);
const stampFormat = (zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
/** "21 Nov 12:15" in the workspace timezone. */
export function progressStamp(now: string, zone: string) {
  const parts = Object.fromEntries(
    stampFormat(zone)
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/** Append Markdown to a note body, once. Keeps the body's leading blank line. */
export function appendText(body: string, text: string) {
  const addition = text.trim();
  if (!addition) return body;
  if (!body.trim()) return "\n" + addition + "\n";
  if (body.trimEnd().endsWith(addition)) return body;
  return body.trimEnd() + "\n\n" + addition + "\n";
}

const projectTitle = (s: Snapshot, task: Task) =>
  s.projects.find((p) => p.id === task.projectId)?.title ?? null;
const compact = (s: Snapshot, t: Task) => ({
  id: t.id,
  title: t.title,
  project: projectTitle(s, t),
  status: t.status,
  scheduled: t.scheduled,
  due: t.due,
  completedAt: t.completedAt,
  hasNotes: t.notes.trim() !== "",
  path: t.path,
});
const full = (s: Snapshot, t: Task) => ({
  ...compact(s, t),
  notes: t.notes,
  revision: t.revision,
  labels: t.tags,
  reminder: t.reminder,
  repeat: t.repeat,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});
const describe = (p: Project) => p.notes.trim().split(/\n\s*\n/)[0] ?? "";

function findTask(s: Snapshot, taskId: string) {
  const task = s.tasks.find((t) => t.id === taskId.toLowerCase() && !t.trashed);
  if (!task)
    throw new AppError(404, "NOT_FOUND", "No task with this id. Use find_tasks to look it up.");
  return task;
}
function resolveProject(
  s: Snapshot,
  ref: string | null | undefined,
  allowArchived = false,
) {
  if (ref === undefined) return undefined;
  if (ref === null) return null;
  if (!ref.trim())
    throw new AppError(400, "UNKNOWN_PROJECT", "Give a project title or id, or null for no project.");
  const key = ref.trim().toLowerCase();
  const project = s.projects.find(
    (p) => p.id === key || p.title.toLowerCase() === key,
  );
  if (!project)
    throw new AppError(
      400,
      "UNKNOWN_PROJECT",
      `Unknown project "${ref}". Call list_projects, or add_project if the owner's rules call for a new one.`,
    );
  if (project.archived && !allowArchived)
    throw new AppError(400, "PROJECT_ARCHIVED", `The project "${project.title}" is archived.`);
  return project.id;
}
// Re-read and retry once when the note changed between reading and writing,
// e.g. the owner saved it in the web app. Only for writes that merge safely.
async function withLatest<T>(
  vault: Workspace,
  taskId: string,
  write: (task: Task, s: Snapshot) => Promise<T>,
) {
  for (let attempt = 0; ; attempt++) {
    const s = await vault.snapshot();
    try {
      return await write(findTask(s, taskId), s);
    } catch (e) {
      if (attempt === 0 && e instanceof AppError && e.code === "CONFLICT") continue;
      throw e;
    }
  }
}
async function taskResult(vault: Workspace, task: Task) {
  const s = await vault.snapshot();
  return { task: full(s, s.tasks.find((t) => t.id === task.id) ?? task) };
}

type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  readOnly?: boolean;
  args: z.ZodType;
  run: (vault: Workspace, args: any) => Promise<object>;
};
const str = (description: string, extra: object = {}) => ({ type: "string", description, ...extra });
const nullableDate = (description: string) => ({
  type: ["string", "null"],
  description: description + " As YYYY-MM-DD, or null to clear.",
});

const tools: Tool[] = [
  {
    name: "find_tasks",
    description:
      "Search the owner's tasks. Every word of the query must appear in the title, notes or project. Open means inbox, todo or doing. Also returns today's date and the workspace timezone.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: str("Words to look for, e.g. 'login timeout'. Empty lists everything."),
        status: { type: "string", enum: ["open", "done", "all"], default: "open" },
        project: str("Project title or id to limit the search."),
        day: str("Calendar date YYYY-MM-DD. Open tasks use their plan date, falling back to deadline. Done tasks use their local completion day."),
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
    },
    args: z.object({
      query: z.string().max(500).default(""),
      status: z.enum(["open", "done", "all"]).default("open"),
      project: z.string().max(120).optional(),
      day: z.string().refine(validDate, "Use a calendar date like 2026-11-28.").optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    async run(vault, a) {
      const s = await vault.snapshot();
      const projectId = a.project ? resolveProject(s, a.project, true) : undefined;
      const query = words(a.query);
      const matches = s.tasks
        .filter((t) =>
          a.status === "open"
            ? active(t)
            : a.status === "done"
              ? !t.trashed && t.status === "done"
              : !t.trashed,
        )
        .filter((t) => !projectId || t.projectId === projectId)
        .filter((t) => !a.day || (
          t.status === "done"
            ? t.completedAt !== null && dayInZone(new Date(t.completedAt), s.preferences.timezone) === a.day
            : (t.scheduled ?? t.due) === a.day
        ))
        .map((t) => {
          const title = words(t.title).join(" ");
          const hay = `${title} ${words(t.notes).join(" ")} ${words(projectTitle(s, t) ?? "").join(" ")}`;
          return {
            t,
            hit: query.every((w) => hay.includes(w)),
            inTitle: query.every((w) => title.includes(w)),
          };
        })
        .filter((m) => m.hit)
        .sort(
          (a, b) =>
            Number(b.inTitle) - Number(a.inTitle) ||
            b.t.updatedAt.localeCompare(a.t.updatedAt),
        );
      return {
        today: s.today,
        timezone: s.preferences.timezone,
        total: matches.length,
        tasks: matches.slice(0, a.limit).map((m) => compact(s, m.t)),
      };
    },
  },
  {
    name: "get_task",
    description: "Read one task in full, including its Markdown notes and revision.",
    readOnly: true,
    inputSchema: { type: "object", properties: { id: str("Task id.") }, required: ["id"] },
    args: z.object({ id }),
    async run(vault, a) {
      const s = await vault.snapshot();
      return { task: full(s, findTask(s, a.id)) };
    },
  },
  {
    name: "add_task",
    description:
      "Create a task. Give notes only for real context (a source link, what done means); never repeat the title. The project must exist (see list_projects).",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Short task name. Keep links and issue keys the owner typed in it."),
        notes: str("Optional Markdown context."),
        project: str("Existing project title or id."),
        scheduled: nullableDate("Day the owner plans to work on it."),
        due: nullableDate("Deadline, only if the owner gave one."),
        requestId: str("Reuse the returned requestId when retrying the same creation."),
      },
      required: ["title"],
    },
    args: z.object({
      title: z.string().trim().min(1).max(240),
      notes: z.string().max(500_000).optional(),
      project: z.string().max(120).nullable().optional(),
      scheduled: date.optional(),
      due: date.optional(),
      requestId: z.string().uuid().optional(),
    }),
    async run(vault, a) {
      const s = await vault.snapshot();
      const requestId = a.requestId ?? randomUUID();
      const task = await vault.createTask({
        requestId,
        title: a.title,
        ...(a.notes?.trim() ? { notes: a.notes.trim() } : {}),
        ...(a.scheduled !== undefined ? { scheduled: a.scheduled } : {}),
        ...(a.due !== undefined ? { due: a.due } : {}),
        projectId: resolveProject(s, a.project) ?? null,
      });
      return { requestId, ...(await taskResult(vault, task)) };
    },
  },
  {
    name: "update_task",
    description:
      "Change a task. Use progress for a one-line finding (Todo adds the workspace time and the '## Progress' heading), link for a URL (added under '## Links'), and append_notes for other Markdown. None of them overwrites. Replacing notes needs the revision from get_task.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        title: str("New task name."),
        progress: str("One-line finding, e.g. 'The test depends on dict ordering.'"),
        link: str("One URL with an optional label, e.g. 'PR 57: https://…'."),
        append_notes: str("Markdown appended to the end of the notes."),
        notes: str("Replaces all notes. Requires revision."),
        revision: str("Revision from get_task, required with notes."),
        project: { type: ["string", "null"], description: "Project title or id, or null for none." },
        scheduled: nullableDate("Planned day."),
        due: nullableDate("Deadline."),
      },
      required: ["id"],
    },
    args: z
      .object({
        id,
        title: z.string().trim().min(1).max(240).optional(),
        progress: z.string().trim().min(1).max(2_000).optional(),
        link: z.string().trim().min(1).max(2_000).optional(),
        append_notes: z.string().max(100_000).optional(),
        notes: z.string().max(500_000).optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        project: z.string().max(120).nullable().optional(),
        scheduled: date.optional(),
        due: date.optional(),
      })
      .refine(
        (a) =>
          !(a.notes !== undefined && (a.append_notes ?? a.progress ?? a.link) !== undefined),
        "Replacing notes can't be combined with progress, link or append_notes.",
      )
      .refine((a) => a.notes === undefined || !!a.revision, "Replacing notes needs the revision from get_task; use append_notes to add text."),
    async run(vault, a) {
      const result = await withLatest(vault, a.id, async (task, s) => {
        const patch: Record<string, unknown> = {};
        if (a.title !== undefined) patch.title = a.title;
        if (a.scheduled !== undefined) patch.scheduled = a.scheduled;
        if (a.due !== undefined) patch.due = a.due;
        const projectId = resolveProject(s, a.project);
        if (projectId !== undefined) patch.projectId = projectId;
        let notes = task.notes;
        if (a.progress)
          notes = addProgress(notes, a.progress, progressStamp(s.now, s.preferences.timezone));
        if (a.link) notes = addLine(notes, "Links", "- " + oneLine(a.link));
        if (a.append_notes !== undefined) notes = appendText(notes, a.append_notes);
        if (notes !== task.notes) patch.notes = notes;
        if (a.notes !== undefined) {
          patch.notes = a.notes;
          // Replacing the whole body must be based on what the agent read.
          return vault.updateTask(task.id, a.revision, patch);
        }
        return vault.updateTask(task.id, task.revision, patch);
      });
      return taskResult(vault, result as Task);
    },
  },
  {
    name: "complete_task",
    description:
      "Mark a task done, only after the work is verified done or the owner says so. Put what was done, the root cause for bugs and how it was verified in outcome; it is saved under '## Outcome'.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        outcome: str("1-4 lines of Markdown: what was done or decided, the root cause for a bug, how it was verified."),
      },
      required: ["id"],
    },
    args: z.object({ id, outcome: z.string().max(100_000).optional() }),
    async run(vault, a) {
      const result = await withLatest(vault, a.id, async (task) => {
        const patch: Record<string, unknown> = {};
        if (task.status !== "done") patch.status = "done";
        if (a.outcome?.trim()) {
          const notes = appendText(task.notes, "## Outcome\n" + a.outcome.trim());
          if (notes !== task.notes) patch.notes = notes;
        }
        return Object.keys(patch).length
          ? vault.updateTask(task.id, task.revision, patch)
          : task;
      });
      return taskResult(vault, result as Task);
    },
  },
  {
    name: "reopen_task",
    description: "Reopen a completed task.",
    inputSchema: { type: "object", properties: { id: str("Task id.") }, required: ["id"] },
    args: z.object({ id }),
    async run(vault, a) {
      const result = await withLatest(vault, a.id, async (task) =>
        task.status === "done"
          ? vault.updateTask(task.id, task.revision, { status: task.previousStatus })
          : task,
      );
      return taskResult(vault, result as Task);
    },
  },
  {
    name: "list_projects",
    description:
      "List projects with their descriptions. A description like 'Repo: web-api' marks a repository's project; others describe a category of work.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { include_archived: { type: "boolean", default: false } },
    },
    args: z.object({ include_archived: z.boolean().default(false) }),
    async run(vault, a) {
      const s = await vault.snapshot();
      return {
        projects: s.projects
          .filter((p) => a.include_archived || !p.archived)
          .map((p) => ({
            id: p.id,
            title: p.title,
            description: describe(p),
            archived: p.archived,
            openCount: s.tasks.filter((t) => active(t) && t.projectId === p.id).length,
          })),
      };
    },
  },
  {
    name: "add_project",
    description:
      "Create a project. For a repository use the repository folder name as the title and 'Repo: <name>' as the description. Don't create other categories unless the owner asks.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Project name."),
        description: str("One line saying what belongs in it."),
      },
      required: ["title", "description"],
    },
    args: z.object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(2_000).default(""),
    }),
    async run(vault, a) {
      const project = await vault.createProject({
        requestId: randomUUID(),
        title: a.title,
        notes: a.description.trim(),
      });
      return { project: { id: project.id, title: project.title, description: describe(project) } };
    },
  },
];

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** Handles one JSON-RPC message. Returns null for notifications (HTTP 202). */
export async function handleMcp(vault: Workspace, body: unknown): Promise<object | null> {
  const msg = body as Message;
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return rpcError(msg?.id, -32600, "Send one JSON-RPC 2.0 request.");
  if (msg.id === undefined || msg.id === null) return null;
  const ok = (result: object) => ({ jsonrpc: "2.0", id: msg.id, result });
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return ok({
        protocolVersion: VERSIONS.includes(asked as string) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "todo", title: "Todo", version: "0.1.0" },
        instructions,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false },
        })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const result = await tool.run(vault, tool.args.parse(params.arguments ?? {}));
        return ok({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (e) {
        return ok({ isError: true, content: [{ type: "text", text: errorData(e).message }] });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
