import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { initializeSchema } from "../core/sqlite-schema";
import { hash } from "../core/notes";
import {
  acquire, databaseFile, digest, exists, inventory, legacyLock, newPath, ordinaryDirectory, ordinaryFile,
  privateStateFile, readJson, restorePending, separate, storageLock, syncDirectory, writeJson, type Entry,
} from "./files";
import { importLegacy, readResolutions, scanLegacy } from "./legacy";

const manifestFile = "manifest.json";
const stateName = "state";
type MigrationReport = Awaited<ReturnType<typeof scanLegacy>>["report"] & {
  dryRun: boolean;
  published: boolean;
  key: string;
  name: string;
  archive?: string;
  database?: string;
};

function validateDatabase(db: DatabaseSync) {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("The database failed SQLite integrity or foreign-key checks.");
  if (db.prepare("PRAGMA user_version").get()?.user_version !== 1)
    throw new Error("This is not a supported Todo database.");
  for (const table of ["notes", "versions", "settings"])
    db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
  if (!db.prepare("SELECT value FROM settings WHERE key = 'vaultKey'").get()?.value)
    throw new Error("The database is missing its Todo workspace identity.");
}

async function validateFile(file: string) {
  const db = new DatabaseSync(await ordinaryFile(file), { readOnly: true });
  try {
    validateDatabase(db);
  } finally {
    db.close();
  }
}

async function copyDatabase(source: string, destination: string) {
  const db = new DatabaseSync(await ordinaryFile(source), { readOnly: true });
  try {
    validateDatabase(db);
    await backup(db, destination);
  } finally {
    db.close();
  }
  const copy = new DatabaseSync(destination);
  try {
    // A standalone file can be placed on a fresh volume without WAL sidecars.
    copy.exec("PRAGMA journal_mode = DELETE");
    validateDatabase(copy);
  } finally {
    copy.close();
  }
  await fs.chmod(destination, 0o600);
}

async function createArchive(directory: string, populate: () => Promise<void>) {
  await fs.mkdir(directory, { mode: 0o700 });
  try {
    await populate();
    await syncDirectory(directory);
    await syncDirectory(path.dirname(directory));
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function fileContents(entries: Entry[]) {
  return entries.map(({ mtime: _mtime, ...content }) => content);
}

function verifyInventory(recorded: unknown, actual: Entry[]) {
  if (!Array.isArray(recorded) || !isDeepStrictEqual(fileContents(recorded), fileContents(actual))) {
    throw new Error("Archive contents do not match the manifest.");
  }
}

async function expectNoDatabase(state: string) {
  for (const file of [databaseFile, ...["wal", "shm", "journal"].map((suffix) => databaseFile + "-" + suffix), restorePending]) {
    if (await exists(path.join(state, file))) throw new Error(`Existing database or incomplete restore in ${state}. Keep it and use a fresh state directory.`);
  }
}

export async function migrate(options: {
  vault: string; state: string; archive?: string; dryRun: boolean;
  resolutions?: string; vaultKey?: string; vaultName?: string;
}): Promise<MigrationReport> {
  const vault = await ordinaryDirectory(options.vault);
  const state = await ordinaryDirectory(options.state);
  separate(vault, state);
  const identity = {
    key: options.vaultKey ?? hash(vault).slice(0, 16),
    name: options.vaultName ?? path.basename(vault),
  };
  const resolutions = await readResolutions(options.resolutions);
  const filterVault = (name: string) => name !== legacyLock;
  if (options.dryRun) {
    const result = await scanLegacy(vault, state,
      await inventory(vault, { filter: filterVault, allowLinks: true }),
      await inventory(state, { filter: privateStateFile }), resolutions);
    if (!result.report.unresolved.length) {
      const db = new DatabaseSync(":memory:");
      try {
        initializeSchema(db);
        importLegacy(db, result, identity.key, identity.name);
        validateDatabase(db);
      } finally {
        db.close();
      }
    }
    return { ...result.report, dryRun: true, published: false, ...identity };
  }

  if (!options.archive) throw new Error("Choose a new backup directory with --backup for a cutover.");
  const archive = await newPath(options.archive);
  separate(vault, archive);
  separate(state, archive);
  const vaultWriter = await acquire(vault, legacyLock);
  try {
    const stateWriter = await acquire(state, storageLock);
    try {
      await expectNoDatabase(state);
      const vaultSnapshot = path.join(archive, "vault");
      const stateSnapshot = path.join(archive, stateName);
      let result: Awaited<ReturnType<typeof scanLegacy>>;
      await createArchive(archive, async () => {
        await fs.mkdir(vaultSnapshot, { mode: 0o700 });
        await fs.mkdir(stateSnapshot, { mode: 0o700 });
        const vaultEntries = await inventory(vault, { filter: filterVault, allowLinks: true, copyTo: vaultSnapshot });
        const stateEntries = await inventory(state, { filter: privateStateFile, copyTo: stateSnapshot });

        // Verify the frozen sources still match the copies. Parsing uses the copies,
        // with the original mtimes for absent note timestamps and history dates.
        if (!isDeepStrictEqual(vaultEntries, await inventory(vault, { filter: filterVault, allowLinks: true })) ||
            !isDeepStrictEqual(stateEntries, await inventory(state, { filter: privateStateFile }))) {
          throw new Error("A source changed during backup. Pause all writers and retry.");
        }
        result = await scanLegacy(vaultSnapshot, stateSnapshot, vaultEntries, stateEntries, resolutions);
        await writeJson(path.join(archive, "migration-report.json"), result.report);
        await writeJson(path.join(archive, manifestFile), {
          version: 1, kind: "todo-legacy", workspace: identity, vault: vaultEntries, state: stateEntries,
        });
      });
      const report = { ...result!.report, dryRun: false, published: false, ...identity, archive };
      if (result!.report.unresolved.length) return report;

      const staging = await fs.mkdtemp(path.join(state, ".todo-import-"));
      try {
        const candidate = path.join(staging, databaseFile);
        const db = new DatabaseSync(candidate);
        try {
          initializeSchema(db);
          importLegacy(db, result!, identity.key, identity.name);
          validateDatabase(db);
        } finally {
          db.close();
        }
        await fs.chmod(candidate, 0o600);
        vaultWriter.check();
        stateWriter.check();
        if (!isDeepStrictEqual(fileContents(await inventory(vault, { filter: filterVault, allowLinks: true })),
          fileContents(await inventory(vaultSnapshot, { allowLinks: true }))) ||
            !isDeepStrictEqual(fileContents(await inventory(state, { filter: privateStateFile })),
              fileContents(await inventory(stateSnapshot)))) {
          throw new Error("A source changed after backup. Pause all writers and retry with a fresh archive.");
        }
        await expectNoDatabase(state);
        await fs.rename(candidate, path.join(state, databaseFile));
        await syncDirectory(state);
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
      }
      return { ...report, published: true, database: path.join(state, databaseFile) };
    } finally {
      await stateWriter.release();
    }
  } finally {
    await vaultWriter.release();
  }
}

export async function backupStorage(options: { state: string; archive: string }) {
  const state = await ordinaryDirectory(options.state);
  const archive = await newPath(options.archive);
  separate(state, archive);
  const writer = await acquire(state, storageLock);
  try {
    if (await exists(path.join(state, restorePending))) throw new Error("This state has an incomplete restore.");
    await createArchive(archive, async () => {
      const targetDb = path.join(archive, databaseFile);
      const targetState = path.join(archive, stateName);
      await fs.mkdir(targetState, { mode: 0o700 });
      await copyDatabase(path.join(state, databaseFile), targetDb);
      const entries = await inventory(state, { filter: privateStateFile, copyTo: targetState });
      if (!isDeepStrictEqual(entries, await inventory(state, { filter: privateStateFile })))
        throw new Error("Private state changed during backup. Stop Todo and retry.");
      writer.check();
      await writeJson(path.join(archive, manifestFile), {
        version: 1, kind: "todo-sqlite", database: await digest(targetDb), state: entries,
      });
    });
    return { archive };
  } finally {
    await writer.release();
  }
}

export async function restoreStorage(options: { state: string; archive?: string; database?: string; authState?: string }) {
  let sourceDb: string;
  let sourceState: string | undefined;
  let expectedState: unknown;
  const target = await newPath(options.state);
  if (options.archive) {
    const archive = await ordinaryDirectory(options.archive);
    separate(archive, target);
    const manifest = await readJson(path.join(archive, manifestFile)) as Record<string, unknown> | null;
    if (manifest?.version !== 1 || manifest.kind !== "todo-sqlite")
      throw new Error("Choose a complete SQLite backup directory for --backup.");
    sourceDb = await ordinaryFile(path.join(archive, databaseFile));
    if (manifest.database !== await digest(sourceDb)) throw new Error("Archive database does not match the manifest.");
    expectedState = manifest.state;
    sourceState = await ordinaryDirectory(path.join(archive, stateName));
  } else if (options.database) {
    sourceDb = await ordinaryFile(options.database);
    separate(sourceDb, target);
    if (options.authState) {
      sourceState = await ordinaryDirectory(options.authState);
      separate(sourceState, target);
    }
  } else {
    throw new Error("Choose a backup directory or a database download.");
  }
  await validateFile(sourceDb);
  if (!(await exists(target))) await fs.mkdir(target, { mode: 0o700 });
  const state = await ordinaryDirectory(target);
  const sourceWriter = !options.archive && sourceState ? await acquire(sourceState, storageLock) : undefined;
  try {
    if (sourceState && await exists(path.join(sourceState, restorePending))) throw new Error("The authentication source has an incomplete restore.");
    const writer = await acquire(state, storageLock);
    try {
      if ((await fs.readdir(state)).some((name) => name !== storageLock))
        throw new Error("Restore needs a new or empty state directory. Existing data was kept.");
      const staged = path.join(state, restorePending);
      await fs.mkdir(staged, { mode: 0o700 });
      const moved: string[] = [];
      try {
        const candidate = path.join(staged, databaseFile);
        await copyDatabase(sourceDb, candidate);
        if (sourceState) {
          const entries = await inventory(sourceState, { filter: options.archive ? undefined : privateStateFile, copyTo: staged });
          if (options.archive) {
            verifyInventory(expectedState, entries);
            if (entries.some(({ path: name }) => !privateStateFile(name.split("/")[0])))
              throw new Error("The archive contains reserved state paths.");
          } else if (!isDeepStrictEqual(entries, await inventory(sourceState, { filter: privateStateFile }))) {
            throw new Error("Private state changed during restore.");
          }
        }
        sourceWriter?.check();
        writer.check();
        // Publish credentials before the validated database. The server refuses
        // to start with a pending restore marker if the process is interrupted.
        for (const name of (await fs.readdir(staged)).filter((name) => name !== databaseFile).concat(databaseFile)) {
          await fs.rename(path.join(staged, name), path.join(state, name));
          moved.push(name);
        }
      } catch (error) {
        for (const name of moved.reverse()) await fs.rename(path.join(state, name), path.join(staged, name));
        await fs.rm(staged, { recursive: true, force: true });
        throw error;
      }
      await syncDirectory(state);
      await fs.rmdir(staged);
      await syncDirectory(state);
      return { database: path.join(state, databaseFile), restoredOwner: await exists(path.join(state, "owner.json")) };
    } finally {
      await writer.release();
    }
  } finally {
    await sourceWriter?.release();
  }
}
