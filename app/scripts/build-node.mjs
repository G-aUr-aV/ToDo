import { build } from "esbuild";

await build({
  entryPoints: { main: "server/main.ts", "storage-cli": "migration/cli.ts" },
  outdir: "dist/server",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  target: "node24",
  bundle: true,
  // Fastify resolves runtime files dynamically; keep it and the small server libraries
  // installed. Bundle the ESM-only Markdown parser tree so CJS does not wrap its
  // plugin namespaces as defaults when recurring task checklists are reset.
  external: ["fastify", "@fastify/*", "proper-lockfile", "yaml", "zod"],
  sourcemap: true,
});
