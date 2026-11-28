import path from "node:path";
import { existsSync } from "node:fs";
import { Auth } from "./auth";
import { createServer } from "./app";
import { openWorkspace, runtimeConfig } from "./runtime";
async function main() {
  let storage: Awaited<ReturnType<typeof openWorkspace>> | undefined;
  try {
    const { port, host, root, state, publicOrigin } = runtimeConfig();
    storage = await openWorkspace(root, state);
    const auth = new Auth(state);
    const loginFile = await auth.initialize();
    if (loginFile)
      console.log("Owner login created. Read it locally at: " + loginFile);
    const app = await createServer({
      vault: storage.workspace,
      auth,
      publicOrigin,
      clientDir: existsSync("dist/client")
        ? path.resolve("dist/client")
        : undefined,
    });
    await app.listen({ port, host });
    console.log("Todo is ready at " + publicOrigin);
    console.log("SQLite workspace: " + state);
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await app.close();
      await auth.flush();
      await storage?.close();
      process.exit(0);
    };
    process.on("SIGTERM", () => void stop());
    process.on("SIGINT", () => void stop());
  } catch (error) {
    console.error("Todo could not start: " + (error as Error).message);
    await storage?.close();
    process.exit(1);
  }
}
void main();
