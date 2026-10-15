import fs from "node:fs/promises";
import path from "node:path";
import { createVault } from "../core/vault";

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
  if (root === state || state.startsWith(root + path.sep))
    throw new Error("STATE_PATH must be outside VAULT_PATH so credentials stay outside your notes.");
  return { port, host, root, state, publicOrigin: origin.origin };
}

export async function prepareVault(root: string) {
  try {
    const stat = await fs.lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("VAULT_PATH must be an ordinary folder, not a file or symlink.");
    if ((await fs.readdir(root)).length === 0) {
      // Docker bind mounts exist before startup. Share the same exclusive scaffold.
      await createVault(root, { existingEmpty: true });
      return true;
    }
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // createVault uses exclusive folder creation. Existing notes and vaults are never replaced.
  await fs.mkdir(path.dirname(root), { recursive: true });
  await createVault(root);
  return true;
}

export async function validateStoragePaths(root: string, state: string) {
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const stateStat = await fs.lstat(state);
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory())
    throw new Error("STATE_PATH must be an ordinary folder, not a file or symlink.");
  const [realRoot, realState] = await Promise.all([
    fs.realpath(root),
    fs.realpath(state),
  ]);
  if (realRoot === realState || realState.startsWith(realRoot + path.sep))
    throw new Error("STATE_PATH must be outside VAULT_PATH so credentials stay outside your notes.");
}
