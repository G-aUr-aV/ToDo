import path from "node:path";
import { existsSync } from "node:fs";
import { Vault } from "../core/vault";
import { Auth } from "./auth";
import { createServer } from "./app";
import { prepareVault, runtimeConfig, validateStoragePaths } from "./runtime";
async function main() {
  let vault: Vault | undefined;
  try {
    const { port, host, root, state, publicOrigin } = runtimeConfig();
    if (await prepareVault(root)) console.log("Created your task vault at: " + root);
    await validateStoragePaths(root, state);
    // Acquire the vault before making an account; a second server must not change state.
    vault = await new Vault(root, state).start();
    const auth = new Auth(state);
    const loginFile = await auth.initialize();
    if (loginFile)
      console.log("Owner login created. Read it locally at: " + loginFile);
    const app = await createServer({
      vault,
      auth,
      publicOrigin,
      clientDir: existsSync("dist/client")
        ? path.resolve("dist/client")
        : undefined,
    });
    await app.listen({ port, host });
    console.log("Todo is ready at " + publicOrigin);
    console.log("Obsidian vault: " + root);
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await app.close();
      await vault?.close();
      process.exit(0);
    };
    process.on("SIGTERM", () => void stop());
    process.on("SIGINT", () => void stop());
  } catch (error) {
    console.error("Todo could not start: " + (error as Error).message);
    await vault?.close();
    process.exit(1);
  }
}
void main();
