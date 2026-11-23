import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "development-csp",
      transformIndexHtml: {
        order: "pre",
        handler: (html, ctx) =>
          ctx.server
            ? html.replace(
                /<meta http-equiv="Content-Security-Policy"[^>]*>/,
                "",
              )
            : html,
      },
    },
  ],
  appType: "mpa",
  base: "./",
  build: {
    outDir: "dist/client",
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": { target: "http://127.0.0.1:4313", changeOrigin: false },
      "/mcp": { target: "http://127.0.0.1:4313", changeOrigin: false },
      "/healthz": { target: "http://127.0.0.1:4313", changeOrigin: false },
    },
  },
});
