import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // env.ts parses process.env at module load time as a side effect
    // (`export const env = EnvSchema.parse(process.env)`) — importing the
    // module to reach the exported EnvSchema for direct testing still runs
    // that side effect, so a minimal valid fixture is required here even
    // though env.test.ts calls EnvSchema.parse() itself with its own object.
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://platform:platform_test_password@localhost:5432/platform_test",
      REDIS_URL: "redis://localhost:6379",
      AUTHNEXUS_ISSUER: "https://auth.rokkalabs.com",
      AUTHNEXUS_JWKS_URL: "https://auth.rokkalabs.com/api/v1/auth/jwks",
      AUTHNEXUS_AUDIENCE: "platform-api",
      AUTHNEXUS_PROJECT_ID: "project-xyz",
      NOVU_API_KEY: "test",
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "test",
      S3_ACCESS_KEY: "test",
      S3_SECRET_KEY: "test",
      ANTHROPIC_API_KEY: "test",
      OPENBAO_ADDR: "http://localhost:8200",
      OPENBAO_TOKEN: "dev-root-token",
    },
  },
});
