import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

function envJsPlugin(vars: Record<string, string | undefined>): Plugin {
  // AuthNexus's SPA client is public/PKCE — there is no client secret to exclude here.
  const js = `window.__CONFIG__ = ${JSON.stringify({
    AUTHNEXUS_AUTHORITY:
      vars["AUTHNEXUS_AUTHORITY"] ?? vars["VITE_AUTH_AUTHORITY"] ?? "",
    AUTHNEXUS_CLIENT_ID:
      vars["AUTHNEXUS_CLIENT_ID"] ?? vars["VITE_CLIENT_ID"] ?? "",
    AUTHNEXUS_ORG_ID: vars["AUTHNEXUS_ORG_ID"] ?? vars["VITE_ORG_ID"] ?? "",
    AUTHNEXUS_PROJECT_ID:
      vars["AUTHNEXUS_PROJECT_ID"] ?? vars["VITE_PROJECT_ID"] ?? "",
  })};`;
  return {
    name: "serve-env-js",
    configureServer(server) {
      server.middlewares.use("/env.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.end(js);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load environment variables from the monorepo root (.env.local)
  const env = loadEnv(mode, "../../", "");

  return {
    plugins: [react(), envJsPlugin(env)],
    build: { target: "es2022" },
    optimizeDeps: { esbuildOptions: { target: "es2022" } },
    server: {
      port: 3001,
      host: "0.0.0.0",
      ...(env["VITE_ALLOWED_HOSTS"]
        ? { allowedHosts: env["VITE_ALLOWED_HOSTS"].split(",") }
        : {}),
      watch: {
        usePolling: true,
        interval: 300,
      },
      ...(env["VITE_API_PROXY_TARGET"]
        ? {
            proxy: {
              "/api": {
                target: env["VITE_API_PROXY_TARGET"],
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ""),
              },
              // Notification hub's live push (docs/specs/in-app-notification-hub.md,
              // T5) — same backend, needs `ws: true` since this is an upgrade, not a
              // plain HTTP proxy. No path rewrite: apps/api serves this route as-is
              // at /ws/notifications, unlike /api which strips its prefix.
              "/ws": {
                target: env["VITE_API_PROXY_TARGET"],
                ws: true,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
