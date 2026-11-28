import type { Operation } from "./operations";
export const routeFor: Record<
  Operation,
  { method: "GET" | "POST" | "PATCH"; path: string }
> = {
  snapshot: { method: "GET", path: "/api/workspace" },
  createTask: { method: "POST", path: "/api/tasks" },
  updateTask: { method: "PATCH", path: "/api/tasks/:id" },
  bulkSchedule: { method: "POST", path: "/api/tasks/bulk-schedule" },
  createProject: { method: "POST", path: "/api/projects" },
  updateProject: { method: "PATCH", path: "/api/projects/:id" },
  setPreferences: { method: "POST", path: "/api/preferences" },
  versions: { method: "GET", path: "/api/tasks/:id/versions" },
  restore: { method: "POST", path: "/api/tasks/:id/restore" },
};
export type SessionInfo = {
  authenticated: boolean;
  csrf: string | null;
  version: string;
};
export type ErrorInfo = {
  status: number;
  code: string;
  message: string;
  current?: unknown;
};
