import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only tenant-org-lookup.test.ts needs a real DB connection — every other
    // test file in this package fully vi.mock()s "@platform/config" and
    // "@platform/db", which overrides these regardless.
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgresql://platform:platform_dev_password@localhost:5432/platform_test",
      DATABASE_POOL_MIN: "1",
      DATABASE_POOL_MAX: "3",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
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
