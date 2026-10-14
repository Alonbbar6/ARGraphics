import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { Express } from "express";
import { client, initializeDatabase, resetDatabase } from "./database";
import { objects } from "./storage";

vi.mock("@workspace/db", async () => {
  const fixture = await import("./database");
  return { db: fixture.db, ...fixture.schema };
});
vi.mock("../../src/lib/objectStorage", async () => import("./storage"));

export let app: Express;
let now = Date.UTC(2026, 9, 14);

beforeAll(async () => {
  // Guard against accidental HTTP integrations, including Meshy and the storage
  // sidecar. Supertest uses local sockets rather than global fetch.
  vi.stubGlobal("fetch", () => {
    throw new Error("External network calls are forbidden in regression tests.");
  });
  await initializeDatabase();
  app = (await import("../../src/app")).default;
});

beforeEach(async () => {
  vi.clearAllMocks();
  objects.clear();
  await resetDatabase();
  // Move beyond the previous rate window; no sleeps or production-only reset API.
  now += 60_001;
  vi.spyOn(Date, "now").mockReturnValue(now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await client.close();
});

