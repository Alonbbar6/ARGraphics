import { expect, it } from "vitest";
import { SmokeManifest, smokeScope } from "./storage-smoke/safety";
import { trackSmokeUploads } from "./browser-smoke/track-uploads";
import express from "express";
import request from "supertest";

it("records browser uploads before delivering responses through nested routers", async () => {
  const manifest = new SmokeManifest("/fixture/private/storage-smoke/run");
  const objectPath = "/objects/uploads/11111111-1111-4111-8111-111111111111";
  const uploadURL = `https://storage.googleapis.com${manifest.directory}/${objectPath.slice(9)}?signature=fixture`;
  const app = express();
  app.use(trackSmokeUploads(manifest));
  const nested = express.Router();
  nested.post("/storage/uploads/request-url", (req, res) => {
    expect(req.path).toBe("/storage/uploads/request-url");
    res.json({ uploadURL, objectPath });
  });
  app.use("/api", nested);
  await request(app).post("/api/storage/uploads/request-url").expect(200);
  expect(() => manifest.assertOwned(objectPath)).not.toThrow();
  const removed: string[] = [];
  await manifest.cleanup(async (path) => { removed.push(path); });
  expect(removed).toEqual([objectPath]);
});

it("isolates each smoke namespace and refuses public paths or invalid origins", () => {
  const first = smokeScope("/fixture/private", "/fixture/public", "https://dev.example.test");
  const second = smokeScope("/fixture/private", "/fixture/public", "https://dev.example.test");
  expect(first.directory).not.toBe(second.directory);
  expect(first.directory).toMatch(/^\/fixture\/private\/storage-smoke\/[a-f0-9-]{36}$/);
  expect(() => smokeScope("/fixture/public/private", "/fixture/public", "https://dev.example.test")).toThrow();
  expect(() => smokeScope("/fixture/../private", "", "https://dev.example.test")).toThrow();
  expect(() => smokeScope("/fixture/private", "", "https://dev.example.test/app")).toThrow();
});

it("tracks accepted copies before validation or response delivery and cleans them alongside staging uploads", async () => {
  const manifest = new SmokeManifest("/fixture/private/storage-smoke/run");
  const upload = "/objects/uploads/11111111-1111-4111-8111-111111111111";
  const accepted = "/objects/accepted-artwork/22222222-2222-4222-8222-222222222222";
  expect(() => manifest.recordAccepted(upload, accepted)).toThrow();
  manifest.record(`https://storage.googleapis.com${manifest.directory}/${upload.slice(9)}?signature=fixture`, upload);
  expect(() => manifest.recordAccepted(upload, "/objects/private/secret")).toThrow();
  expect(() => manifest.recordAccepted(upload, "/objects/accepted-artwork/../secret")).toThrow();
  manifest.recordAccepted(upload, accepted);
  expect(() => manifest.assertOwned(accepted)).not.toThrow();
  expect(() => manifest.recordAccepted(accepted, accepted)).toThrow();
  const removed: string[] = [];
  // Simulate route cleanup failure: the manifest must retain the snapshot for
  // afterAll, which verifies absence even when the smoke itself has failed.
  await expect(manifest.cleanup(async (path) => {
    if (path === accepted) throw new Error("fixture cleanup failure");
    removed.push(path);
  })).rejects.toThrow("Disposable artwork cleanup failed");
  expect(removed).toEqual([upload]);
  await manifest.cleanup(async (path) => { removed.push(path); });
  expect(removed).toEqual([upload, accepted]);
  expect(() => manifest.assertOwned(accepted)).toThrow();
});

it("cleans only manifest objects and continues after individual cleanup failures", async () => {
  const manifest = new SmokeManifest("/fixture/private/storage-smoke/run");
  const first = "/objects/uploads/11111111-1111-4111-8111-111111111111";
  const second = "/objects/uploads/22222222-2222-4222-8222-222222222222";
  for (const path of [first, second]) {
    manifest.record(`https://storage.googleapis.com${manifest.directory}/${path.slice(9)}?signature=fixture`, path);
  }
  expect(() => manifest.assertOwned("/objects/uploads/unrelated")).toThrow();
  expect(() => manifest.record(`https://storage.googleapis.com/fixture/private/uploads/x`, first)).toThrow();
  const deleted: string[] = [];
  await expect(manifest.cleanup(async (path) => {
    deleted.push(path);
    if (path === first) throw new Error("simulated failure");
  })).rejects.toThrow("Disposable artwork cleanup failed");
  expect(deleted).toEqual([first, second]);
  const retried: string[] = [];
  await manifest.cleanup(async (path) => { retried.push(path); });
  expect(retried).toEqual([first]);
});
