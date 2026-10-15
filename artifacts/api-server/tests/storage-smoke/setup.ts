import { afterAll, beforeAll, vi } from "vitest";
import type { Express } from "express";
import { client, initializeDatabase } from "../support/database";
import { SmokeManifest, smokeScope } from "./safety";

vi.mock("@workspace/db", async () => {
  const fixture = await import("../support/database");
  return { db: fixture.db, ...fixture.schema };
});

// Deliberately no object-storage mock and no import of support/setup.ts.
export let app: Express;
export let manifest: SmokeManifest;
export let origin: string;

beforeAll(async () => {
  if (process.env.NODE_ENV !== "development" || process.env.STORAGE_SMOKE !== "1"
    || process.env.DATABASE_URL || process.env.MESHY_API_KEY
    || process.env.IOS_API_KEY !== "ios-storage-smoke-fixture-key"
    || process.env.SESSION_SECRET !== "session-storage-smoke-fixture-secret") {
    throw new Error("Unsafe smoke-check environment; refusing external calls.");
  }
  const scope = smokeScope(
    process.env.PRIVATE_OBJECT_DIR ?? "",
    process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "",
    process.env.STORAGE_SMOKE_ORIGIN ?? "",
  );
  manifest = new SmokeManifest(scope.directory);
  origin = scope.origin;
  vi.stubEnv("PRIVATE_OBJECT_DIR", scope.directory);
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const sidecar = url.origin === "http://127.0.0.1:1106"
      && url.pathname === "/object-storage/signed-object-url";
    const disposableObject = url.origin === "https://storage.googleapis.com"
      && ["uploads", "accepted-artwork"].some((namespace) =>
        decodeURIComponent(url.pathname).startsWith(`${scope.directory}/${namespace}/`));
    if (!sidecar && !disposableObject) {
      throw new Error("Network destination forbidden in storage smoke checks (including Meshy).");
    }
    try {
      return await realFetch(input, {
        ...init, redirect: "error", signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Storage smoke network request failed (details redacted to protect signed URLs).");
    }
  });
  // Observe the real copy operation, not just the eventual HTTP response.
  // Track before validation/DB writes so failed saves and lost responses still
  // clean up every created snapshot. No provider operation is mocked.
  const { ObjectStorageService } = await import("../../src/lib/objectStorage");
  const createSnapshot = ObjectStorageService.prototype.createObjectEntitySnapshot;
  vi.spyOn(ObjectStorageService.prototype, "createObjectEntitySnapshot")
    .mockImplementation(async function(this: InstanceType<typeof ObjectStorageService>, objectPath) {
      manifest.assertOwned(objectPath);
      const snapshot = await createSnapshot.call(this, objectPath);
      manifest.recordAccepted(objectPath, snapshot.objectPath);
      return snapshot;
    });
  await initializeDatabase();
  app = (await import("../../src/app")).default;
});

afterAll(async () => {
  try {
    if (manifest) {
      const { objectStorageClient } = await import("../../src/lib/objectStorage");
      const [, bucket, ...prefix] = manifest.directory.split("/");
      await manifest.cleanup(async (path) => {
        const file = objectStorageClient.bucket(bucket)
          .file(`${prefix.join("/")}/${path.slice("/objects/".length)}`);
        // Handles failed/partial PUTs too; never resolve any unrelated path.
        await file.delete({ ignoreNotFound: true });
        const [exists] = await file.exists();
        if (exists) throw new Error("Disposable artwork still exists after cleanup.");
      });
    }
  } finally {
    await client.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
