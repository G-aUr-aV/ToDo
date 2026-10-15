import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { z } from "zod";
import { Vault } from "../core/vault";
import { AppError } from "../core/model";
import { operate, operations, errorData } from "../core/operations";
import { Auth } from "./auth";
import { routeFor } from "../core/protocol";
export async function createServer({
  vault,
  auth,
  publicOrigin,
  clientDir,
}: {
  vault: Vault;
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
    if (req.url === "/healthz" || req.url === "/readyz") return;
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
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
      !req.url.startsWith("/api/") ||
      req.url === "/api/session" ||
      req.url === "/api/login"
    )
      return;
    const session = auth.session(req.cookies.todo_session);
    if (!session)
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Sign in to open your workspace.",
      );
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
    maxAge: 86400,
  };
  app.get("/api/session", async (req) => {
    const s = auth.session(req.cookies.todo_session);
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
        } else if (["restore", "adopt"].includes(operation)) {
          payload = { ...(req.body as object), id: params.id };
        }
        return operate(vault, operation, payload);
      },
    });
  }
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
      await vault.snapshot();
      // Recheck access after startup: mounts can become read-only while the process stays alive.
      await Promise.all([
        fs.access(path.join(vault.root, "Tasks"), constants.R_OK | constants.W_OK | constants.X_OK),
        fs.access(vault.state, constants.R_OK | constants.W_OK | constants.X_OK),
      ]);
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
        if (/\.(html|webmanifest)$/.test(filePath))
          res.header("Cache-Control", "no-cache");
      },
    });
    app.get("/mini", (_req, reply) =>
      reply.header("Cache-Control", "no-cache").sendFile("mini.html"),
    );
    app.get("/mini/", (_req, reply) => reply.redirect("/mini"));
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({
            error: {
              status: 404,
              code: "NOT_FOUND",
              message: "Unknown action.",
            },
          })
        : reply.sendFile("index.html"),
    );
  }
  // SSE must end before Fastify waits for active HTTP connections to drain.
  app.addHook("preClose", async () => {
    for (const close of streams) close();
  });
  return app;
}
