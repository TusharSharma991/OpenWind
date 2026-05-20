import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/outbox-poller.test.ts", "src/automation-worker.test.ts"],
  },
});
