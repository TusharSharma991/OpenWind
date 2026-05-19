import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    deps: {
      // Inline workspace packages so Vitest uses a single module instance
      // for both the test file and the module under test. Without this,
      // the test's import and the handler's import resolve through different
      // loaders, producing separate class objects that fail instanceof checks.
      inline: [
        "@platform/workflow-engine",
        "@platform/entity-engine",
        "@platform/logger",
        "@platform/auth",
        "@platform/db",
        "@platform/config",
      ],
    },
    // Provide all required @platform/config env vars so tests don't need to
    // vi.mock the config module. CI job env vars take precedence over these
    // defaults when set (e.g. the real DATABASE_URL in integration jobs).
    env: {
      DATABASE_URL:
        "postgresql://platform:platform_test_password@localhost:5432/platform_test",
      DATABASE_POOL_MIN: "1",
      DATABASE_POOL_MAX: "3",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
      ZITADEL_ISSUER: "http://localhost:8080",
      ZITADEL_AUDIENCE: "platform-api",
      ZITADEL_INTROSPECTION_URL: "http://localhost:8080/oauth/v2/introspect",
      ZITADEL_INTROSPECTION_CLIENT_ID: "test-client-id",
      ZITADEL_INTROSPECTION_CLIENT_SECRET: "test-client-secret",
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
