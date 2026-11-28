import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export const databaseFile = "todo.sqlite";
export const storageLock = ".todo-storage.lock";
export const legacyLock = ".todo-writer.lock";
export const restorePending = ".todo-restore-pending";
const transientState = new Set([storageLock, restorePending, databaseFile, ...["wal", "shm", "journal"].map((name) => `${databaseFile}-${name}`)]);
export const privateStateFile = (name: string) => !transientState.has(name) && !name.startsWith(".todo-import-");
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export async function exists(file: string) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

export async function ordinaryDirectory(input: string) {
  const stat = await fs.lstat(input);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Choose an ordinary directory for ${input}.`);
  return fs.realpath(input);
}

export async function ordinaryFile(input: string) {
  const stat = await fs.lstat(input);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Choose an ordinary file for ${input}.`);
  return fs.realpath(input);
}

export async function newPath(input: string) {
  const absolute = path.resolve(input);
  return path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute));
}

function contains(base: string, child: string) {
  const relative = path.relative(base, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

export function separate(first: string, second: string) {
  if (contains(first, second) || contains(second, first)) throw new Error("The vault, private state and backup directories must be separate.");
}

export async function acquire(directory: string, name: string) {
  let failure: Error | undefined;
  const release = await lockfile.lock(directory, {
    lockfilePath: path.join(directory, name),
    stale: 30_000,
    update: 10_000,
    retries: 0,
    onCompromised: (error) => { failure = error; },
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ELOCKED") throw new Error(`${directory} has an active Todo writer. Stop it before continuing.`);
    throw error;
  });
  return {
    check() {
      if (failure) throw failure;
    },
    release,
  };
}

export type Entry = {
  path: string;
  type: "file" | "directory" | "symlink";
  sha256?: string;
  target?: string;
  mtime?: string;
};

export async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

export async function inventory(
  source: string,
  options: { filter?: (name: string) => boolean; allowLinks?: boolean; copyTo?: string } = {},
): Promise<Entry[]> {
  const seen: Entry[] = [];
  async function visit(folder: string, relative: string) {
    const names = (await fs.readdir(folder)).sort();
    for (const name of names) {
      if (!relative && options.filter && !options.filter(name)) continue;
      const child = relative ? relative + "/" + name : name;
      const file = path.join(folder, name);
      const destination = options.copyTo ? path.join(options.copyTo, child) : undefined;
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) {
        seen.push({ path: child, type: "directory" });
        if (destination) await fs.mkdir(destination, { mode: 0o700 });
        await visit(file, child);
        if (destination) {
          await fs.utimes(destination, stat.atime, stat.mtime);
          await syncDirectory(destination);
        }
      } else if (stat.isSymbolicLink() && options.allowLinks) {
        seen.push({ path: child, type: "symlink", target: await fs.readlink(file) });
        if (destination) await fs.cp(file, destination, { verbatimSymlinks: true, force: false, errorOnExist: true });
      } else if (stat.isFile()) {
        if (destination) {
          await fs.copyFile(file, destination, constants.COPYFILE_EXCL);
          await fs.chmod(destination, 0o600);
          await fs.utimes(destination, stat.atime, stat.mtime);
          const handle = await fs.open(destination, "r+");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        seen.push({ path: child, type: "file", sha256: await digest(destination ?? file), mtime: stat.mtime.toISOString() });
      } else {
        throw new Error(`Cannot safely archive unsupported file ${file}.`);
      }
    }
  }
  await visit(source, "");
  if (options.copyTo) await syncDirectory(options.copyTo);
  return seen;
}

export async function writeJson(file: string, data: unknown) {
  const handle = await fs.open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readJson(file: string) {
  return JSON.parse(await fs.readFile(await ordinaryFile(file), "utf8")) as unknown;
}

export async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
