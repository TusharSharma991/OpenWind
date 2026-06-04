import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load environment variables from the monorepo root (.env.local)
  const env = loadEnv(mode, "../../", "");

  // vite.config.ts runs in Node at build time — process.env is intentional here.
  /* eslint-disable no-restricted-syntax */
  const zitadelIssuer = env["ZITADEL_ISSUER"] ?? process.env["ZITADEL_ISSUER"];
  const zitadelClientId =
    env["ZITADEL_OIDC_CLIENT_ID"] ?? process.env["ZITADEL_OIDC_CLIENT_ID"];
  const zitadelClientSecret =
    env["ZITADEL_OIDC_CLIENT_SECRET"] ??
    process.env["ZITADEL_OIDC_CLIENT_SECRET"];
  /* eslint-enable no-restricted-syntax */

  return {
    plugins: [react()],
    server: {
      port: 3001,
    },
    define: {
      "process.env.ZITADEL_ISSUER": JSON.stringify(zitadelIssuer),
      "process.env.ZITADEL_OIDC_CLIENT_ID": JSON.stringify(zitadelClientId),
      "process.env.ZITADEL_OIDC_CLIENT_SECRET":
        JSON.stringify(zitadelClientSecret),
    },
  };
});
