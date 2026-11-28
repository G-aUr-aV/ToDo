import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspace } from "../core/sqlite-workspace";
import { acquire, databaseFile, exists, missing, ordinaryDirectory, ordinaryFile, restorePending, separate, storageLock } from "../migration/files";

export type RuntimeConfig = {
  port: number;
  host: string;
  root: string;
  state: string;
  publicOrigin: string;
};

export function runtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): RuntimeConfig {
  const port = Number(env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a whole number from 1 to 65535.");
  const host = env.HOST?.trim() || "127.0.0.1";
  const root = path.resolve(cwd, env.VAULT_PATH || "../Todo Vault");
  const state = path.resolve(cwd, env.STATE_PATH || "../.todo-state/server");
  const configuredOrigin = env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  let origin: URL;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new Error("PUBLIC_ORIGIN must be an http:// or https:// address.");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN must contain only the http:// or https:// scheme, hostname and optional port.",
    );
  separate(root, state);
  return { port, host, root, state, publicOrigin: origin.origin };
}

async function canonicalPath(location: string): Promise<string> {
  try {
    return await fs.realpath(location);
  } catch (error) {
    if (!missing(error)) throw error;
    return path.join(await canonicalPath(path.dirname(location)), path.basename(location));
  }
}

function migrationRecorded(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'settings' AND type = 'table'").get()) return false;
    return !!db.prepare("SELECT 1 FROM settings WHERE key = 'legacyMigration'").get();
  } finally {
    db.close();
  }
}

export async function openWorkspace(root: string, state: string) {
  const [realRoot, realState] = await Promise.all([canonicalPath(root), canonicalPath(state)]);
  separate(realRoot, realState);
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const stateDirectory = await ordinaryDirectory(state);
  const lease = await acquire(stateDirectory, storageLock);
  let workspace: SqliteWorkspace | undefined;
  try {
    if (await exists(path.join(stateDirectory, restorePending))) {
      throw new Error("A Todo restore is pending. Finish recovery before starting the server.");
    }
    const database = path.join(stateDirectory, databaseFile);
    const hasDatabase = await exists(database);
    if (hasDatabase) await ordinaryFile(database);
    if (!(hasDatabase && migrationRecorded(database)) && await exists(root)) {
      await ordinaryDirectory(root);
      if ((await fs.readdir(root)).length) {
        throw new Error("An existing Markdown vault needs migration before Todo can open. Run npm run migrate -- --vault <VAULT_PATH> --state <STATE_PATH> --dry-run first.");
      }
    }
    if (!hasDatabase) {
      const existingState = [
        "owner.json", "initial-login.txt", "sessions.json", "tokens.json",
        "preferences.json", "versions",
        ...["wal", "shm", "journal"].map((suffix) => databaseFile + "-" + suffix),
      ];
      for (const name of existingState) {
        if (await exists(path.join(stateDirectory, name))) {
          throw new Error("Existing Todo state has no todo.sqlite database. Check the configured state and legacy vault mounts, then restore a backup or migrate the original vault.");
        }
      }
      const handle = await fs.open(database, "wx", 0o600);
      await handle.close();
    }
    lease.check();
    workspace = new SqliteWorkspace(database, undefined, lease.check);
    workspace.start();
    const current = workspace;
    return {
      workspace: current,
      async close() {
        try {
          current.close();
        } finally {
          await lease.release();
        }
      },
    };
  } catch (error) {
    try {
      workspace?.close();
    } finally {
      await lease.release();
    }
    throw error;
  }
}
