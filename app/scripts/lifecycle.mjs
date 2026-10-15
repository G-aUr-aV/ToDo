import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceDir = path.resolve(appDir, "..");

export function checkNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 18)
    throw new Error("Todo needs Node 24.18 or newer in the Node 24 line. Install Node 24 LTS, then retry.");
}

export async function loadSettings() {
  const file = path.join(workspaceDir, ".env");
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appDir,
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
      else reject(new Error(`${command} exited with status ${code ?? signal}.`));
    });
  });
}

export async function dependenciesInstalled() {
  try {
    const [packageText, wantedText, installedText] = await Promise.all([
      fs.readFile(path.join(appDir, "package.json"), "utf8"),
      fs.readFile(path.join(appDir, "package-lock.json"), "utf8"),
      fs.readFile(path.join(appDir, "node_modules/.package-lock.json"), "utf8"),
    ]);
    const manifest = JSON.parse(packageText);
    const wanted = JSON.parse(wantedText).packages;
    const installed = JSON.parse(installedText).packages;
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const key = "node_modules/" + name;
      if (!installed[key] || installed[key].version !== wanted[key]?.version) return false;
      await fs.access(path.join(appDir, key, "package.json"));
    }
    // Optional packages for other operating systems may be absent; every installed version
    // must still match the current lockfile before a changed checkout is built.
    for (const [name, entry] of Object.entries(installed)) {
      const desired = wanted[name];
      if (!desired || entry.version !== desired.version || entry.integrity !== desired.integrity) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function buildNeeded() {
  let built;
  try {
    const outputs = await Promise.all([
      fs.stat(path.join(appDir, "dist/server/main.cjs")),
      fs.stat(path.join(appDir, "dist/client/index.html")),
      fs.stat(path.join(appDir, "dist/client/mini.html")),
    ]);
    built = Math.min(...outputs.map((s) => s.mtimeMs));
  } catch {
    return true;
  }
  const sources = ["core", "server", "src", "public", "scripts/build-node.mjs", "package.json", "package-lock.json", "index.html", "mini.html", "vite.config.ts"];
  const newer = async (file) => {
    const stat = await fs.stat(file);
    if (stat.mtimeMs > built) return true;
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(file))
        if (await newer(path.join(file, name))) return true;
    }
    return false;
  };
  for (const source of sources)
    if (await newer(path.join(appDir, source))) return true;
  return false;
}

export async function prepareBuild({ freshInstall = false } = {}) {
  checkNodeVersion();
  const npm = await npmInvocation();
  let installed = false;
  if (freshInstall || !(await dependenciesInstalled())) {
    console.log("Installing Todo's locked dependencies…");
    await run(npm.command, [...npm.args, "ci", "--no-audit", "--no-fund"]);
    installed = true;
  }
  if (installed || await buildNeeded()) {
    console.log("Building Todo…");
    await run(npm.command, [...npm.args, "run", "build"]);
  }
}

export async function npmInvocation() {
  if (process.platform !== "win32") return { command: "npm", args: [] };
  // npm.cmd cannot be spawned directly on Windows. Run npm's JS entry through
  // Node, preserving paths with spaces without introducing shell interpolation.
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")].filter(Boolean);
  for (const file of candidates) {
    try {
      if ((await fs.stat(file)).isFile()) return { command: process.execPath, args: [file] };
    } catch { /* Try the next standard npm location. */ }
  }
  throw new Error("npm was not found. Install Node 24 LTS with npm, then run npm start from the Todo folder.");
}
