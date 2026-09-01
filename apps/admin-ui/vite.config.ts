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
    IDLE_LOGOUT_ENABLED: vars["VITE_IDLE_LOGOUT_ENABLED"] ?? "",
    IDLE_LOGOUT_TIMEOUT_MINUTES: vars["VITE_IDLE_LOGOUT_TIMEOUT_MINUTES"] ?? "",
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
      // host.docker.internal is always allowed — it's how a container reaches
      // this dev server via the host's Docker networking, not an env-specific
      // hostname a deployment would want to opt into via VITE_ALLOWED_HOSTS.
      allowedHosts: [
        "host.docker.internal",
        ...(env["VITE_ALLOWED_HOSTS"]?.split(",") ?? []),
      ],
      watch: {
        usePolling: true,
        interval: 300,
      },
      ...(env["VITE_API_PROXY_TARGET"]
        ? {
            proxy: {
              // Must come before the "/api" rule below — Vite matches proxy
              // keys in insertion order (first prefix match wins), and the
              // third-party API is mounted at the literal /api/v1 prefix
              // (apps/api/src/app.ts's app.route("/api/v1", thirdPartyRouter)),
              // unlike admin-ui's own internal routes which are unprefixed
              // (/workflows, not /v1/workflows) and need "/api" stripped.
              "/api/v1": {
                target: env["VITE_API_PROXY_TARGET"],
                changeOrigin: true,
                // no rewrite — the backend expects the literal /api/v1/... prefix
              },
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
