import { prepareBuild } from "./lifecycle.mjs";
try {
  await prepareBuild({ freshInstall: true });
  console.log("Todo is installed. Run npm start to create/open your vault and start the app.");
} catch (error) {
  console.error("Todo setup failed: " + error.message);
  process.exitCode = 1;
}
