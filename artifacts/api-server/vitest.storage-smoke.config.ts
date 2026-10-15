import { defineConfig } from "vitest/config";

// Fail before collecting tests or importing any application/database modules.
if (process.env.NODE_ENV !== "development" || process.env.STORAGE_SMOKE !== "1") {
  throw new Error("Real storage smoke checks require NODE_ENV=development and STORAGE_SMOKE=1.");
}

export default defineConfig({
  test: {
    include: ["tests/storage-smoke/**/*.smoke.ts"],
    environment: "node",
    setupFiles: ["tests/storage-smoke/setup.ts"],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 180_000,
    env: {
      DATABASE_URL: "",
      IOS_API_KEY: "ios-storage-smoke-fixture-key",
      SESSION_SECRET: "session-storage-smoke-fixture-secret",
      MESHY_API_KEY: "",
      LOG_LEVEL: "silent",
    },
  },
});
