import request from "supertest";
import { expect, it } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import { ObjectStorageService } from "../../src/lib/objectStorage";
import { app, manifest, origin } from "./setup";

// Tiny disposable, encoded image fixtures; no owner artwork is read or copied.
const images = [
  { type: "image/png", name: "pixel.png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC" },
  { type: "image/jpeg", name: "pixel.jpg", base64: "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAB//9k=" },
  { type: "image/webp", name: "pixel.webp", base64: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA" },
];

async function signIn(email: string) {
  const result = await request(app).post("/api/auth/login")
    .send({ email, password: "fixture-password" }).expect(200);
  return (result.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

function assertCors(response: globalThis.Response) {
  expect([origin, "*"]).toContain(response.headers.get("access-control-allow-origin"));
}

function signedLifetime(rawURL: string) {
  const url = new URL(rawURL);
  const duration = Number(url.searchParams.get("X-Goog-Expires"));
  const date = url.searchParams.get("X-Goog-Date") ?? "";
  if (/^\d{8}T\d{6}Z$/.test(date) && duration > 0) {
    const start = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
    return { duration, expiresAt: start + duration * 1000 };
  }
  // The sidecar may use GCS V2 signatures instead of V4.
  const expiresAt = Number(url.searchParams.get("Expires")) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Storage provider returned an unrecognized signed expiry.");
  }
  return { duration: Math.round((expiresAt - Date.now()) / 1000), expiresAt };
}

it("uses real private storage for supported PUTs, owner/iOS reads, CORS, expiry, and scoped cleanup", async () => {
  const storage = new ObjectStorageService();
  const owner = await signIn("demo@garnish.app");
  const other = await signIn("other@example.test");
  await request(app).post("/api/storage/uploads/request-url")
    .send({ name: "anonymous.png", contentType: "image/png", size: 1 }).expect(401);
  const uploaded: { path: string; bytes: Buffer; cardId: string }[] = [];
  for (const image of images) {
    const bytes = Buffer.from(image.base64, "base64");
    const result = await request(app).post("/api/storage/uploads/request-url").set("Cookie", owner)
      .send({ name: image.name, contentType: image.type, size: bytes.length }).expect(200);
    const { uploadURL, objectPath } = result.body as { uploadURL: string; objectPath: string };
    // Register before PUT so failure at any later point still triggers cleanup.
    manifest.record(uploadURL, objectPath);
    const preflight = await fetch(uploadURL, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
    expect(preflight.ok, "Storage PUT preflight failed").toBe(true);
    assertCors(preflight);
    expect(preflight.headers.get("access-control-allow-methods")?.split(/,\s*/)).toContain("PUT");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase().split(/,\s*/)).toContain("content-type");
    const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": image.type, Origin: origin }, body: bytes });
    expect(put.ok, "Signed storage PUT failed").toBe(true);
    assertCors(put);
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    expect(metadata.contentType).toBe(image.type);
    expect(Number(metadata.size)).toBe(bytes.length);
    const stagingURL = `/api/storage${objectPath}`;
    await request(app).get(stagingURL).set("Cookie", owner).expect(404); // Not saved yet.
    const saved = await request(app).post("/api/table-cards").set("Cookie", owner)
      .send({ name: image.name, objectPath, physicalWidthCm: 10 }).expect(201);
    const privateURL: string = saved.body.referenceImageUrl;
    expect(privateURL).toMatch(/^\/api\/storage\/objects\/accepted-artwork\/[a-f0-9-]{36}$/i);
    const acceptedPath = privateURL.slice("/api/storage".length);
    manifest.assertOwned(acceptedPath);
    await request(app).get(stagingURL).set("Cookie", owner).expect(404); // Never registered.
    await request(app).get(privateURL).expect(401);
    await request(app).get(privateURL).set("Cookie", other).expect(404);
    const read = await request(app).get(privateURL).set("Cookie", owner).expect(200);
    expect(read.body).toEqual(bytes);
    expect(read.headers["content-type"]).toBe(image.type);
    // Removing the signature must not turn a private cloud object into a public read.
    const unsigned = new URL(uploadURL);
    unsigned.search = "";
    const denied = await fetch(unsigned);
    expect([401, 403]).toContain(denied.status);
    uploaded.push({ path: acceptedPath, bytes, cardId: saved.body.id });
  }

  const iosPath = "/api/v1/bars/demo-bar/table-cards";
  await request(app).get(iosPath).expect(401);
  await request(app).get(iosPath).set("x-api-key", "wrong-smoke-key").expect(401);
  const ios = await request(app).get(iosPath).set("x-api-key", "ios-storage-smoke-fixture-key").expect(200);
  expect(ios.body).toHaveLength(images.length);
  for (const item of uploaded) {
    const card = ios.body.find((value: { id: string }) => value.id === item.cardId);
    expect(card).toBeDefined();
    const lifetime = signedLifetime(card.referenceImageUrl);
    expect(lifetime.duration).toBeGreaterThanOrEqual(3595);
    expect(lifetime.duration).toBeLessThanOrEqual(3600);
    const download = await fetch(card.referenceImageUrl, { headers: { Origin: origin } });
    expect(download.status).toBe(200);
    assertCors(download);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(item.bytes);
  }

  // Exercise the same sidecar signer with a short TTL, without shortening the
  // production iOS one-hour contract or waiting an hour in development.
  const shortURL = await storage.getObjectEntityReadURL(uploaded[0].path, 8);
  const shortLifetime = signedLifetime(shortURL);
  expect(shortLifetime.duration).toBeGreaterThanOrEqual(6);
  expect(shortLifetime.duration).toBeLessThanOrEqual(8);
  const initial = await fetch(shortURL, { cache: "no-store" });
  expect(initial.status).toBe(200);
  expect(Buffer.from(await initial.arrayBuffer())).toEqual(uploaded[0].bytes);
  await sleep(Math.max(0, shortLifetime.expiresAt - Date.now()) + 2000);
  const expired = await fetch(shortURL, { cache: "no-store" });
  // GCS can return 400 InvalidArgument for an expired credential/signature.
  // Require an expiry-specific body too: an unrelated 4xx is not proof of TTL.
  expect([400, 401, 403]).toContain(expired.status);
  const expiryBody = await expired.text();
  expect(/expired|expiration/i.test(expiryBody), "Provider denial must explicitly identify expiry").toBe(true);
  // Also prove deletion of one run-owned object leaves another intact.
  manifest.assertOwned(uploaded[0].path);
  await request(app).delete(`/api/table-cards/${uploaded[0].cardId}`).set("Cookie", owner).expect(200);
  const sentinel = await storage.getObjectEntityFile(uploaded[1].path);
  expect((await sentinel.exists())[0]).toBe(true);
  // afterAll checks absence of every manifest object, including this deleted one.
});
