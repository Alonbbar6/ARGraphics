import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Runs separately against an isolated real-PostgreSQL schema via node:test.
    exclude: ["tests/isolation.test.ts"],
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
    // These are public fixtures, never the workspace's real credentials.
    env: {
      IOS_API_KEY: "ios-regression-fixture-key",
      SESSION_SECRET: "session-regression-fixture-secret",
      DATABASE_URL: "",
      MESHY_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      LOG_LEVEL: "silent",
    },
  },
});
