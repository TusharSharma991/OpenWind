import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

function envJsPlugin(vars: Record<string, string | undefined>): Plugin {
  const js = `window.__CONFIG__ = ${JSON.stringify({
    ZITADEL_ISSUER: vars["ZITADEL_ISSUER"] ?? "",
    ZITADEL_OIDC_CLIENT_ID: vars["ZITADEL_OIDC_CLIENT_ID"] ?? "",
    ZITADEL_OIDC_CLIENT_SECRET: vars["ZITADEL_OIDC_CLIENT_SECRET"] ?? "",
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
      allowedHosts: ["openwind.rokkalabs.com"],
      watch: {
        usePolling: true,
        interval: 300,
      },
      proxy: {
        "/api": {
          target: "http://api:3000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
