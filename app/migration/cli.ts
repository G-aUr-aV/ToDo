import { parseArgs } from "node:util";
import path from "node:path";
import { backupStorage, migrate, restoreStorage } from "./storage";

const usage = `Todo storage commands
  import --vault <legacy-vault> --state <state-dir> --dry-run
  import --vault <legacy-vault> --state <state-dir> --backup <new-archive-dir>
         [--resolutions <file>] [--vault-key <old-key>] [--vault-name <old-name>]
  backup --state <state-dir> --backup <new-archive-dir>
  restore --backup <archive-dir> --state <empty-target-dir>
  restore --database <downloaded-db> --state <empty-target-dir> [--auth-state <stopped-state-dir>]

Pause Todo and any other writers before cutover or full backup.
STATE_PATH and VAULT_PATH can supply the source paths.
The backup path must be new and the parent directory must exist.
Restoring only a database enrolls a new owner on the next start unless an authentication source is supplied.`;

async function main() {
  const { positionals, values } = parseArgs({
    options: {
      vault: { type: "string" }, state: { type: "string" },
      backup: { type: "string" }, database: { type: "string" }, "auth-state": { type: "string" },
      resolutions: { type: "string" }, "vault-key": { type: "string" }, "vault-name": { type: "string" },
      "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  const [command] = positionals;
  if (values.help || !command) {
    console.log(usage);
    if (!values.help) process.exitCode = 1;
    return;
  }
  if (positionals.length !== 1) throw new Error("Pass values via named flags. See --help.");
  // npm runs scripts at the package root. Flag paths belong to the caller.
  const caller = process.env.npm_lifecycle_event ? process.env.INIT_CWD || process.cwd() : process.cwd();
  const fromCaller = (value?: string) => value ? path.resolve(caller, value) : undefined;
  const appRoot = path.resolve(__dirname, "../..");
  const state = fromCaller(values.state) ?? path.resolve(appRoot, process.env.STATE_PATH || "../.todo-state/server");
  const archive = fromCaller(values.backup);
  const allowed = {
    import: ["vault", "state", "backup", "resolutions", "vault-key", "vault-name", "dry-run"],
    backup: ["state", "backup"],
    restore: ["state", "backup", "database", "auth-state"],
  };
  if (!Object.hasOwn(allowed, command) || Object.keys(values).some((name) => !allowed[command as keyof typeof allowed].includes(name)))
    throw new Error("Unknown command or option for that command. See --help.");

  if (command === "import") {
    const vault = fromCaller(values.vault) ?? (process.env.VAULT_PATH ? path.resolve(appRoot, process.env.VAULT_PATH) : undefined);
    if (!vault) throw new Error("Use --vault or VAULT_PATH to identify the legacy vault.");
    if (values["dry-run"] && archive) throw new Error("Use --dry-run for a read-only rehearsal or --backup for cutover.");
    if (values["vault-key"] !== undefined && !/^[a-f0-9]{16}$/.test(values["vault-key"]))
      throw new Error("The legacy vault key is a 16-character hexadecimal value.");
    if (values["vault-name"] !== undefined && !values["vault-name"].trim()) throw new Error("Supply a nonempty legacy vault name.");
    const report = await migrate({
      vault, state, archive, dryRun: values["dry-run"] ?? false,
      resolutions: fromCaller(values.resolutions), vaultKey: values["vault-key"], vaultName: values["vault-name"],
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.counts.unresolved) process.exitCode = 2;
  } else if (command === "backup") {
    if (!archive) throw new Error("Choose a new backup directory with --backup.");
    console.log(JSON.stringify(await backupStorage({ state, archive }), null, 2));
  } else {
    if (!values.state) throw new Error("Use --state to explicitly select a new or empty restore destination.");
    if (Boolean(archive) === Boolean(values.database) || (archive && values["auth-state"]))
      throw new Error("Select one SQLite backup directory or one database download. --auth-state is for database downloads.");
    console.log(JSON.stringify(await restoreStorage({
      state, archive, database: fromCaller(values.database), authState: fromCaller(values["auth-state"]),
    }), null, 2));
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
