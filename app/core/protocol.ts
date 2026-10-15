import type { Operation } from "./operations";
export const routeFor: Record<
  Operation,
  { method: "GET" | "POST" | "PATCH"; path: string }
> = {
  snapshot: { method: "GET", path: "/api/workspace" },
  today: { method: "GET", path: "/api/today" },
  createTask: { method: "POST", path: "/api/tasks" },
  updateTask: { method: "PATCH", path: "/api/tasks/:id" },
  createProject: { method: "POST", path: "/api/projects" },
  updateProject: { method: "PATCH", path: "/api/projects/:id" },
  setPreferences: { method: "POST", path: "/api/preferences" },
  versions: { method: "GET", path: "/api/tasks/:id/versions" },
  restore: { method: "POST", path: "/api/tasks/:id/restore" },
  adopt: { method: "POST", path: "/api/imports/:id/adopt" },
  previewImport: { method: "POST", path: "/api/imports/preview" },
  importNotes: { method: "POST", path: "/api/imports/commit" },
  exportNotes: { method: "GET", path: "/api/export" },
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
