import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        // Inline all @platform/* packages so vitest resolves them from source
        // rather than requiring a pre-built dist/ — without this, instanceof
        // checks and module-boundary types fail across the loader boundary.
        inline: [/^@platform\//],
      },
    },
  },
});
