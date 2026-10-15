import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? args[portArg + 1] : "4173";
const origin = process.env.TODO_DEV_ORIGIN ?? `http://localhost:${port}`;
const api = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
  stdio: "inherit",
  env: { ...process.env, PORT: "4313", PUBLIC_ORIGIN: origin },
});
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", port, ...args],
  { stdio: "inherit", env: process.env },
);
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", stop);
vite.on("exit", stop);
