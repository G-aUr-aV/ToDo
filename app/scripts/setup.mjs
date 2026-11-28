import { prepareBuild } from "./lifecycle.mjs";
try {
  await prepareBuild({ freshInstall: true });
  console.log("Todo is installed. Run npm start to open your SQLite workspace.");
} catch (error) {
  console.error("Todo setup failed: " + error.message);
  process.exitCode = 1;
}
