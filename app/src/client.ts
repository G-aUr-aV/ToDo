import { routeFor, type SessionInfo, type ErrorInfo } from "../core/protocol";
import type { Operation } from "../core/operations";
export class ClientError extends Error {
  constructor(public info: ErrorInfo) {
    super(info.message);
  }
}
let csrf: string | null = null;
const changes =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("todo-workspace")
    : null;
function changed() {
  changes?.postMessage("changed");
  window.dispatchEvent(new Event("todo:changed"));
}
export async function call<T = unknown>(
  operation: string,
  payload?: unknown,
): Promise<T> {
  let method: string;
  let url: string;
  let body: unknown = payload;
  const headers: Record<string, string> = {};
  if (operation === "session") {
    method = "GET";
    url = "/api/session";
  } else if (operation === "login") {
    method = "POST";
    url = "/api/login";
  } else if (operation === "logout") {
    method = "POST";
    url = "/api/logout";
    body = {};
  } else if (operation === "changePassword") {
    method = "POST";
    url = "/api/account/password";
  } else {
    const route = routeFor[operation as Operation];
    if (!route)
      throw new ClientError({
        status: 400,
        code: "OPERATION_INVALID",
        message: "This action is unavailable.",
      });
    method = route.method;
    url = route.path;
    const p = payload as
      { id?: string; revision?: string; patch?: unknown } | undefined;
    if (p?.id) url = url.replace(":id", encodeURIComponent(p.id));
    if (operation === "updateTask" || operation === "updateProject") {
      headers["If-Match"] = p!.revision!;
      body = p!.patch;
    }
  }
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    if (csrf) headers["X-Todo-CSRF"] = csrf;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ClientError({
      status: 0,
      code: "OFFLINE",
      message: "The server is unreachable. Your draft has not been saved.",
    });
  }
  const result = await response.json().catch(() => ({
    error: {
      status: response.status,
      code: "SERVER_RESPONSE",
      message: "The server could not complete this action.",
    },
  }));
  if (!response.ok)
    throw new ClientError(
      result.error ?? {
        status: response.status,
        code: "SERVER_RESPONSE",
        message: "This action could not be completed.",
      },
    );
  if (operation === "login" || operation === "session")
    csrf = (result as SessionInfo).csrf;
  if (operation === "logout") csrf = null;
  if (
    ![
      "session",
      "snapshot",
      "today",
      "versions",
      "exportNotes",
      "previewImport",
    ].includes(operation)
  )
    changed();
  return result as T;
}
export function subscribe(
  callback: () => void,
  options: { events?: boolean } = {},
) {
  changes?.addEventListener("message", callback);
  window.addEventListener("todo:changed", callback);
  const stream =
    options.events === false ? null : new EventSource("/api/events");
  stream?.addEventListener("changed", callback);
  return () => {
    stream?.close();
    changes?.removeEventListener("message", callback);
    window.removeEventListener("todo:changed", callback);
  };
}
