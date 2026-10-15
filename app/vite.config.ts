import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "mini-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/mini" || req.url === "/mini/")
            req.url = "/mini.html";
          next();
        });
      },
    },
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
  base: "./",
  build: {
    outDir: "dist/client",
    rollupOptions: {
      input: {
        main: path.resolve("index.html"),
        mini: path.resolve("mini.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": { target: "http://127.0.0.1:4313", changeOrigin: false },
      "/healthz": { target: "http://127.0.0.1:4313", changeOrigin: false },
    },
  },
});
