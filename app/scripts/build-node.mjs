import { build } from "esbuild";

await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist/server/main.cjs",
  platform: "node",
  format: "cjs",
  target: "node24",
  bundle: true,
  // Fastify resolves runtime files dynamically; keep it and the small server libraries
  // installed. Bundle the ESM-only Markdown parser tree so CJS does not wrap its
  // plugin namespaces as defaults when recurring task checklists are reset.
  external: ["fastify", "@fastify/*", "chokidar", "proper-lockfile", "yaml", "zod"],
  sourcemap: true,
});
