import { z } from "zod";
import { Vault } from "./vault";
import { AppError, uuid } from "./model";
import { todaySummary } from "./today";
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const edit = z.object({ id: uuid, revision, patch: z.unknown() }).strict();
export const importSchema = z
  .object({
    items: z
      .array(
        z
          .object({ name: z.string().max(240), raw: z.string().max(600_000) })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine(
    (v) =>
      v.items.reduce((n, i) => n + Buffer.byteLength(i.raw), 0) <= 2_000_000,
    "Import at most 2 MB at a time.",
  );
export const operations = [
  "snapshot",
  "today",
  "createTask",
  "updateTask",
  "createProject",
  "updateProject",
  "setPreferences",
  "versions",
  "restore",
  "adopt",
  "previewImport",
  "importNotes",
  "exportNotes",
] as const;
export type Operation = (typeof operations)[number];
export async function operate(
  vault: Vault,
  operation: string,
  payload: unknown,
): Promise<unknown> {
  if (!operations.includes(operation as Operation))
    throw new AppError(
      400,
      "OPERATION_INVALID",
      "This action is not supported.",
    );
  switch (operation) {
    case "snapshot":
      return vault.snapshot();
    case "today":
      return todaySummary(await vault.snapshot());
    case "createTask":
      return vault.createTask(payload);
    case "updateTask": {
      const p = edit.parse(payload);
      return vault.updateTask(p.id, p.revision, p.patch);
    }
    case "createProject":
      return vault.createProject(payload);
    case "updateProject": {
      const p = edit.parse(payload);
      return vault.updateProject(p.id, p.revision, p.patch);
    }
    case "setPreferences":
      return vault.setPreferences(payload);
    case "versions": {
      const p = z.object({ id: uuid }).strict().parse(payload);
      return vault.versions(p.id);
    }
    case "restore": {
      const p = z
        .object({ id: uuid, revision, version: z.string().max(100) })
        .strict()
        .parse(payload);
      return vault.restore(p.id, p.revision, p.version);
    }
    case "adopt": {
      const p = z
        .object({ id: z.string().regex(/^[a-f0-9]{64}$/), revision })
        .strict()
        .parse(payload);
      return vault.adopt(p.id, p.revision);
    }
    case "previewImport":
      return vault.previewImport(importSchema.parse(payload).items);
    case "importNotes":
      return vault.importNotes(importSchema.parse(payload).items);
    case "exportNotes":
      return vault.exportNotes();
  }
}
export function errorData(error: unknown) {
  if (error instanceof AppError)
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      current: error.current,
    };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      code: "VALIDATION",
      message: error.issues[0]?.message ?? "Check the entered values.",
    };
  if ((error as { statusCode?: number })?.statusCode === 429)
    return {
      status: 429,
      code: "RATE_LIMIT",
      message:
        "Too many sign-in attempts. Wait a few minutes before trying again.",
    };
  const http = (error as { statusCode?: number })?.statusCode;
  if (http && http >= 400 && http < 500)
    return {
      status: http,
      code: "REQUEST_INVALID",
      message: "Check the request format and size before trying again.",
    };
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "EACCES" || code === "EROFS")
    return {
      status: 503,
      code: "VAULT_UNAVAILABLE",
      message:
        "The vault is unavailable or read-only. Your draft has not been saved.",
    };
  return {
    status: 500,
    code: "SAVE_FAILED",
    message:
      "This action could not be completed. Keep your draft and try again.",
  };
}
