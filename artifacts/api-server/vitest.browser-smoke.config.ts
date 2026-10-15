import { defineConfig } from "vitest/config";
import { selectedEngines } from "./tests/browser-smoke/engines";

if (process.env.NODE_ENV !== "development" || process.env.STORAGE_SMOKE !== "1"
  || process.env.BROWSER_STORAGE_SMOKE !== "1") {
  throw new Error("Browser storage smoke requires NODE_ENV=development, STORAGE_SMOKE=1 and BROWSER_STORAGE_SMOKE=1.");
}

export default defineConfig({
  test: {
    include: ["tests/browser-smoke/**/*.smoke.ts"],
    environment: "node",
    setupFiles: ["tests/storage-smoke/setup.ts"],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 240_000,
    env: {
      DATABASE_URL: "",
      IOS_API_KEY: "ios-storage-smoke-fixture-key",
      SESSION_SECRET: "session-storage-smoke-fixture-secret",
      MESHY_API_KEY: "",
      LOG_LEVEL: "silent",
      STORAGE_SMOKE_ORIGIN: "http://127.0.0.1:4179",
      PORT: "4179",
      BASE_PATH: "/",
      BROWSER_SMOKE_BROWSERS: selectedEngines(process.env.BROWSER_SMOKE_BROWSERS).join(","),
    },
  },
});
