import { appDir, checkNodeVersion, loadSettings, prepareBuild } from "./lifecycle.mjs";
try {
  checkNodeVersion();
  await loadSettings();
  await prepareBuild();
  process.chdir(appDir);
  await import("../dist/server/main.cjs");
} catch (error) {
  console.error("Todo could not start: " + error.message);
  process.exitCode = 1;
}
