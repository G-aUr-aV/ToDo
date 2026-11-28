import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { z } from "zod";
import { AppError } from "../core/model";
import { operate, operations, errorData, type Workspace } from "../core/operations";
import { Auth, WEEK } from "./auth";
import { handleMcp } from "./mcp";
import { routeFor } from "../core/protocol";
export async function createServer({
  vault,
  auth,
  publicOrigin,
  clientDir,
}: {
  vault: Workspace;
  auth: Auth;
  publicOrigin: string;
  clientDir?: string;
}) {
  const origin = new URL(publicOrigin);
  const app = Fastify({
    logger: false,
    bodyLimit: 2_100_000,
    requestTimeout: 20_000,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _req, reply) => {
    const e = errorData(error);
    reply.code(e.status).send({ error: e });
  });
  app.addHook("onRequest", async (req, reply) => {
    // Decide on the matched route, never the raw URL: the router decodes
    // percent-escapes, so "/%61pi/workspace" is the /api/workspace route.
    const route = req.routeOptions.url ?? "";
    if (route === "/healthz" || route === "/readyz") return;
    if (route.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    const host = req.headers.host ?? "";
    if (host !== origin.host)
      throw new AppError(
        403,
        "HOST_INVALID",
        "Open Todo using its configured server address.",
      );
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
    // Agents use a personal token instead of the browser cookie. A browser
    // page from another site always sends Origin, so a foreign one is refused.
    if (route === "/mcp") {
      reply.header("Cache-Control", "no-store");
      if (req.headers.origin && req.headers.origin !== origin.origin)
        throw new AppError(
          403,
          "ORIGIN_INVALID",
          "This request came from a different website.",
        );
      if (!auth.verifyToken(req.headers.authorization)) {
        reply.header("WWW-Authenticate", 'Bearer realm="todo"');
        throw new AppError(
          401,
          "TOKEN_INVALID",
          "Connect with an agent token from Todo Settings.",
        );
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers.origin !== origin.origin)
        throw new AppError(
          403,
          "ORIGIN_INVALID",
          "This request came from a different website.",
        );
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        throw new AppError(415, "CONTENT_TYPE", "Send this action as JSON.");
    }
    if (
      !route.startsWith("/api/") ||
      route === "/api/session" ||
      route === "/api/login"
    )
      return;
    const session = auth.session(req.cookies.todo_session);
    if (!session)
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Sign in to open your workspace.",
      );
    // Sliding sign-in: renew the browser cookie along with the session.
    if (route !== "/api/events" && route !== "/api/logout")
      reply.setCookie("todo_session", session.id, cookieOptions);
    if (req.method !== "GET" && req.headers["x-todo-csrf"] !== session.csrf)
      throw new AppError(
        403,
        "CSRF_INVALID",
        "Refresh Todo before trying this action again.",
      );
  });
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: origin.protocol === "https:",
    maxAge: WEEK / 1000,
  };
  app.get("/api/session", async (req, reply) => {
    const s = auth.session(req.cookies.todo_session);
    // Sliding sign-in: each visit renews the browser cookie along with the session.
    if (s) reply.setCookie("todo_session", s.id, cookieOptions);
    return {
      authenticated: !!s,
      csrf: s?.csrf ?? null,
      version: "0.1.0",
    };
  });
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({
          username: z.string().min(1).max(100),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(req.body);
      const s = await auth.login(input.username, input.password);
      reply.setCookie("todo_session", s.id, cookieOptions);
      return {
        authenticated: true,
        csrf: s.csrf,
        version: "0.1.0",
      };
    },
  );
  app.post("/api/logout", async (req, reply) => {
    auth.logout(req.cookies.todo_session!);
    reply.clearCookie("todo_session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/account/password", async (req) => {
    const p = z
      .object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(12, "Use at least 12 characters.").max(256),
      })
      .strict()
      .parse(req.body);
    await auth.changePassword(
      req.cookies.todo_session!,
      p.currentPassword,
      p.newPassword,
    );
    return { ok: true };
  });
  app.get("/api/tokens", async () => auth.listTokens());
  app.post("/api/tokens", async (req) => {
    const p = z
      .object({ name: z.string().trim().max(60).default("Claude Code") })
      .strict()
      .parse(req.body ?? {});
    const created = await auth.createToken(p.name);
    return { ...created, endpoint: origin.origin + "/mcp" };
  });
  app.post("/api/tokens/:id/revoke", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await auth.revokeToken(id);
    return { ok: true };
  });
  for (const operation of operations) {
    const route = routeFor[operation];
    app.route({
      method: route.method,
      url: route.path,
      handler: async (req) => {
        const params = req.params as { id?: string };
        let payload: unknown = req.body;
        if (operation === "versions") payload = { id: params.id };
        else if (["updateTask", "updateProject"].includes(operation)) {
          const revision = req.headers["if-match"];
          if (typeof revision !== "string")
            throw new AppError(
              428,
              "REVISION_REQUIRED",
              "This edit needs the current note revision.",
            );
          payload = {
            id: params.id,
            revision: revision.replace(/^"|"$/g, ""),
            patch: req.body,
          };
        } else if (operation === "restore") {
          payload = { ...(req.body as object), id: params.id };
        }
        return operate(vault, operation, payload);
      },
    });
  }
  app.get("/api/backup", async (request, reply) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "todo-backup-"));
    const file = path.join(directory, "todo.sqlite");
    const remove = () => fs.rm(directory, { force: true, recursive: true }).catch(() => undefined);
    try {
      await vault.backupTo(file);
      const { size } = await fs.stat(file);
      if (request.raw.aborted || reply.raw.destroyed) {
        await remove();
        return;
      }
      const stream = createReadStream(file);
      stream.once("close", () => void remove());
      reply.raw.once("close", () => stream.destroy());
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .type("application/octet-stream")
        .header("Content-Disposition", `attachment; filename="todo-${day}.sqlite"`)
        .header("Content-Length", size)
        .send(stream);
    } catch (error) {
      await remove();
      throw error;
    }
  });
  app.post(
    "/mcp",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const response = await handleMcp(vault, req.body);
      return response ? response : reply.code(202).send();
    },
  );
  for (const method of ["GET", "DELETE"] as const)
    app.route({
      method,
      url: "/mcp",
      handler: async (_req, reply) =>
        reply
          .code(405)
          .header("Allow", "POST")
          .send({
            error: {
              status: 405,
              code: "METHOD",
              message: "This MCP endpoint accepts POST requests only.",
            },
          }),
    });
  const streams = new Set<() => void>();
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const send = () => {
      if (auth.session(req.cookies.todo_session))
        reply.raw.write("event: changed\ndata: {}\n\n");
      else close();
    };
    const heartbeat = setInterval(() => {
      if (auth.session(req.cookies.todo_session))
        reply.raw.write(": heartbeat\n\n");
      else close();
    }, 20_000);
    heartbeat.unref();
    const close = () => {
      clearInterval(heartbeat);
      vault.off("changed", send);
      streams.delete(close);
      reply.raw.end();
    };
    streams.add(close);
    vault.on("changed", send);
    req.raw.on("close", close);
  });
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await vault.ready();
      return { ready: true };
    } catch {
      reply.code(503);
      return { ready: false };
    }
  });
  if (clientDir) {
    await app.register(staticFiles, {
      root: clientDir,
      cacheControl: true,
      maxAge: "1h",
      index: "index.html",
      setHeaders(res, filePath) {
        if (/\.html$/.test(filePath))
          res.header("Cache-Control", "no-cache");
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const api = req.url.startsWith("/api/");
    return reply.code(404).send({
      error: {
        status: 404,
        code: "NOT_FOUND",
        message: api ? "Unknown action." : "Page not found.",
      },
    });
  });
  // SSE must end before Fastify waits for active HTTP connections to drain.
  app.addHook("preClose", async () => {
    for (const close of streams) close();
  });
  return app;
}
