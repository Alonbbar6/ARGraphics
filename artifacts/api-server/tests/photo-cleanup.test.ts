import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import express from "express";
import request from "supertest";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./support/database";
import { acquireCleanupLease, cleanupLeaseMs, cleanupRequestTimeoutMs, releaseCleanupLease } from "../src/lib/photo-cleanup-limits";

const mocks = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    images = { edit: mocks.edit };
  }
  return { default: OpenAI, toFile: vi.fn(async (data) => data) };
});

import { cleanupDrinkPhoto, prepareCleanupPhoto } from "../src/lib/photo-cleanup";
import cleanupRouter from "../src/routes/photo-cleanup";

/** A camera-sized photo: a solid rectangle "drink" on a transparent canvas. Also a valid cutout. */
const image = (size = 480) => sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: 120, height: 160, channels: 4, background: { r: 200, g: 40, b: 30, alpha: 1 } } }, left: 180, top: 160 }])
  .png().toBuffer();

beforeEach(() => {
  mocks.edit.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-real-key");
  // The provider path is what these tests mock; the local model has its own test below.
  vi.stubEnv("PHOTO_CUTOUT", "openai");
});

describe("AI drink photo cleanup", () => {
  it("decodes and normalizes a real image", async () => {
    const normalized = await prepareCleanupPhoto(await image());
    expect((await sharp(normalized).metadata()).format).toBe("png");
  });
  it("rejects disguised images before any paid call", async () => {
    await expect(cleanupDrinkPhoto(Buffer.from("<html>not a photo</html>"))).rejects.toThrow("decoded");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("rejects empty and oversized inputs before any paid call", async () => {
    await expect(cleanupDrinkPhoto(Buffer.alloc(0))).rejects.toThrow("15 MB");
    await expect(cleanupDrinkPhoto(Buffer.alloc(15 * 1024 * 1024 + 1))).rejects.toThrow("15 MB");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("reports a missing server key explicitly", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(cleanupDrinkPhoto(await image())).rejects.toThrow("Photo cleanup isn't switched on");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("rejects photos too small to model, before any paid call", async () => {
    await expect(cleanupDrinkPhoto(await image(300))).rejects.toThrow("too small");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("requests a transparent edit and returns the provider's cutout framed around the subject", async () => {
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    const output = await cleanupDrinkPhoto(png);
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-image-1", background: "transparent", output_format: "png", n: 1,
    }), { signal: undefined });
    // Trimmed to the 120×160 subject plus padding, still transparent around it.
    const meta = await sharp(output).metadata();
    expect(meta.width).toBeGreaterThan(120);
    expect(meta.width).toBeLessThan(200);
    expect(meta.height).toBeLessThan(240);
    const alpha = (await sharp(output).ensureAlpha().stats()).channels[3];
    expect(alpha.min).toBe(0);
    expect(alpha.max).toBe(255);
  });
  it("rejects a cutout whose edges are still opaque", async () => {
    // Opaque everywhere except a small transparent hole, so the simple min/max check passes.
    const size = 480;
    const raw = Buffer.alloc(size * size * 4, 255);
    for (let y = 220; y < 260; y++) for (let x = 220; x < 260; x++) raw[(y * size + x) * 4 + 3] = 0;
    const halo = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: halo.toString("base64") }] });
    await expect(cleanupDrinkPhoto(await image())).rejects.toThrow("around the edges");
  });
  it("cuts a photo out with the local model, keeping the subject and clearing the background", async () => {
    vi.stubEnv("PHOTO_CUTOUT", "local");
    // A red tumbler on a plain white table.
    const photo = await sharp({ create: { width: 640, height: 640, channels: 3, background: "white" } })
      .composite([{ input: { create: { width: 220, height: 300, channels: 4, background: { r: 190, g: 30, b: 40, alpha: 1 } } }, left: 210, top: 200 }])
      .jpeg().toBuffer();
    const output = await cleanupDrinkPhoto(photo);
    expect(mocks.edit).not.toHaveBeenCalled();
    const alpha = (await sharp(output).ensureAlpha().stats()).channels[3];
    expect(alpha.min).toBe(0);
    expect(alpha.max).toBe(255);
  }, 60_000);
  it("does not start a paid call with a cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(cleanupDrinkPhoto(await image(), controller.signal)).rejects.toThrow();
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("never silently returns an opaque background", async () => {
    const opaque = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: opaque.toString("base64") }] });
    await expect(cleanupDrinkPhoto(await image())).rejects.toThrow("transparent cutout");
  });
  it("handles an empty provider result", async () => {
    mocks.edit.mockResolvedValue({ data: [] });
    await expect(cleanupDrinkPhoto(await image())).rejects.toThrow("no cleaned photo");
  });
});

describe("cleanup HTTP boundary", () => {
  const app = (owner?: string) => {
    const server = express();
    server.use((req, _res, next) => {
      if (owner) req.owner = { id: owner } as NonNullable<typeof req.owner>;
      req.log = { warn: vi.fn() } as unknown as typeof req.log;
      next();
    });
    server.use(cleanupRouter);
    return server;
  };
  it("requires sign-in", async () => {
    expect((await request(app()).post("/drinks/photo-cleanup").type("png").send(await image())).status).toBe(401);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("rejects unsupported MIME types", async () => {
    expect((await request(app("owner")).post("/drinks/photo-cleanup").type("text").send("x")).status).toBe(415);
    expect(await db.select().from(schema.photoCleanupLimitsTable)).toHaveLength(0);
  });
  it("returns an uncacheable PNG", async () => {
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    const response = await request(app("owner")).post("/drinks/photo-cleanup").type("png").send(png);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("limits paid attempts per owner", async () => {
    const server = app("owner");
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    for (let i = 0; i < 4; i++) {
      expect((await request(server).post("/drinks/photo-cleanup").type("png").send(png)).status).toBe(200);
    }
    // A fresh Express server and router import cannot reset shared spending state.
    const restartedRoutePath = "../src/routes/photo-cleanup?restart";
    const restartedRouter = (await import(restartedRoutePath)).default;
    const restarted = express();
    restarted.use((req, _res, next) => {
      req.owner = { id: "owner" } as NonNullable<typeof req.owner>;
      next();
    });
    restarted.use(restartedRouter);
    const denied = await request(restarted).post("/drinks/photo-cleanup").type("png").send(png);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers["retry-after"])).toBeGreaterThan(590);
    expect(Number(denied.headers["retry-after"])).toBeLessThanOrEqual(600);
    expect(mocks.edit).toHaveBeenCalledTimes(4);
  });
  it("allows only one simultaneous paid call across independent servers and isolates owners", async () => {
    const png = await image();
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    let finish!: () => void;
    mocks.edit.mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ data: [{ b64_json: png.toString("base64") }] });
      started();
    })).mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    const first = request(app("owner")).post("/drinks/photo-cleanup").type("png").send(png).then(response => response);
    await pending;
    try {
      const denied = await Promise.all(Array.from({ length: 8 }, () =>
        request(app("owner")).post("/drinks/photo-cleanup").type("png").send(png)));
      expect(denied.every(response => response.status === 429)).toBe(true);
      expect(denied.every(response => Number(response.headers["retry-after"]) > 290)).toBe(true);
      expect(mocks.edit).toHaveBeenCalledOnce();
      expect((await request(app("other-owner")).post("/drinks/photo-cleanup").type("png").send(png)).status).toBe(200);
    } finally { finish(); }
    expect((await first).status).toBe(200);
    const [entry] = await db.select().from(schema.photoCleanupLimitsTable)
      .where(eq(schema.photoCleanupLimitsTable.ownerId, "owner"));
    expect(entry.count).toBe(1);
  });
  it("releases validation, upload-size and provider failures without refunding attempts", async () => {
    const post = (bytes: Buffer) => request(app("owner")).post("/drinks/photo-cleanup").type("png").send(bytes);
    expect((await post(Buffer.from("not an image"))).status).toBe(400);
    expect((await post(Buffer.alloc(15 * 1024 * 1024 + 1))).status).toBe(413);
    mocks.edit.mockRejectedValueOnce(new Error("fixture provider failure"));
    expect((await post(await image())).status).toBe(502);
    mocks.edit.mockResolvedValue({ data: [{ b64_json: (await image()).toString("base64") }] });
    expect((await post(await image())).status).toBe(200);
    expect((await post(await image())).status).toBe(429);
    expect(mocks.edit).toHaveBeenCalledTimes(2);
  });
  it("cancels the provider at the request deadline and releases only after it settles", async () => {
    let deadline!: () => void;
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
      if (ms === cleanupRequestTimeoutMs) deadline = callback;
      return Reflect.apply(originalSetTimeout, globalThis, [callback, ms, ...args]);
    }) as typeof setTimeout);
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    let settle!: () => void;
    mocks.edit.mockImplementationOnce((_input, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          settle = () => reject(signal.reason);
        }, { once: true });
        started();
      }));
    const first = request(app("owner")).post("/drinks/photo-cleanup").type("png").send(await image()).then(response => response);
    await pending;
    deadline();
    expect((await request(app("owner")).post("/drinks/photo-cleanup").type("png").send(await image())).status).toBe(429);
    settle();
    expect((await first).status).toBe(504);
    const lease = await acquireCleanupLease("owner");
    expect(lease.allowed).toBe(true);
    if (lease.allowed) await releaseCleanupLease("owner", lease.token);
  });
  it("fails closed when shared admission is unavailable", async () => {
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("fixture DB unavailable"));
    expect((await request(app("owner")).post("/drinks/photo-cleanup").type("png").send(await image())).status).toBe(503);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("expires a stalled upload without ever starting a paid call", async () => {
    let deadline!: () => void;
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
      if (ms === cleanupRequestTimeoutMs) deadline = callback;
      return Reflect.apply(originalSetTimeout, globalThis, [callback, ms, ...args]);
    }) as typeof setTimeout);
    const server = app("owner").listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected test port");
    const upload = httpRequest({
      host: "127.0.0.1", port: address.port, path: "/drinks/photo-cleanup", method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": 10_000 },
    });
    const response = new Promise<number | undefined>((resolve, reject) => {
      upload.on("response", incoming => { incoming.resume(); resolve(incoming.statusCode); });
      upload.on("error", reject);
    });
    upload.write(Buffer.alloc(10));
    try {
      await vi.waitFor(async () => {
        const [entry] = await db.select().from(schema.photoCleanupLimitsTable);
        expect(entry?.leaseToken).toBeTruthy();
      });
      deadline();
      expect(await response).toBe(504);
      expect(mocks.edit).not.toHaveBeenCalled();
      const admitted = await acquireCleanupLease("owner");
      expect(admitted.allowed).toBe(true);
      if (admitted.allowed) await releaseCleanupLease("owner", admitted.token);
    } finally {
      upload.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("does not unlock an active provider operation when its client disconnects", async () => {
    const server = app("owner").listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected test port");
    const png = await image();
    let started!: () => void;
    let cancelled!: () => void;
    let settle!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const aborted = new Promise<void>(resolve => { cancelled = resolve; });
    mocks.edit.mockImplementationOnce((_input, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          settle = () => reject(signal.reason);
          cancelled();
        }, { once: true });
        started();
      }));
    const upload = httpRequest({
      host: "127.0.0.1", port: address.port, path: "/drinks/photo-cleanup", method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": png.length },
    });
    upload.on("error", () => { /* Expected socket close from the client. */ });
    upload.end(png);
    try {
      await pending;
      upload.destroy();
      await aborted;
      expect((await acquireCleanupLease("owner")).allowed).toBe(false);
      settle();
      await vi.waitFor(async () => {
        const [entry] = await db.select().from(schema.photoCleanupLimitsTable);
        expect(entry.leaseToken).toBeNull();
        expect(entry.count).toBe(1);
      });
    } finally {
      settle?.();
      upload.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe("durable cleanup leases", () => {
  it("serializes competing admissions, preserving quota on denied calls", async () => {
    const admissions = await Promise.all(Array.from({ length: 20 }, () => acquireCleanupLease("owner")));
    expect(admissions.filter(result => result.allowed)).toHaveLength(1);
    const [entry] = await db.select().from(schema.photoCleanupLimitsTable);
    expect(entry.count).toBe(1);
    expect(entry.leaseExpiresAt!.getTime() - entry.windowExpiresAt.getTime()).toBe(cleanupLeaseMs - 600_000);
  });
  it("expires abandoned leases and prevents stale releases from unlocking a replacement", async () => {
    const first = await acquireCleanupLease("owner");
    expect(first.allowed).toBe(true);
    await db.update(schema.photoCleanupLimitsTable).set({ leaseExpiresAt: new Date(0) });
    const replacement = await acquireCleanupLease("owner");
    expect(replacement.allowed).toBe(true);
    if (!first.allowed || !replacement.allowed) throw new Error("Expected leases");
    await releaseCleanupLease("owner", first.token);
    expect((await acquireCleanupLease("owner")).allowed).toBe(false);
    await releaseCleanupLease("other-owner", replacement.token);
    expect((await acquireCleanupLease("owner")).allowed).toBe(false);
    await releaseCleanupLease("owner", replacement.token);
    expect((await acquireCleanupLease("owner")).allowed).toBe(true);
  });
  it("resets expired windows but never bypasses an unexpired lease", async () => {
    const first = await acquireCleanupLease("owner");
    if (!first.allowed) throw new Error("Expected lease");
    await db.update(schema.photoCleanupLimitsTable).set({ windowExpiresAt: new Date(0), count: 4 });
    expect((await acquireCleanupLease("owner")).allowed).toBe(false);
    await releaseCleanupLease("owner", first.token);
    expect((await acquireCleanupLease("owner")).allowed).toBe(true);
    const [entry] = await db.select().from(schema.photoCleanupLimitsTable);
    expect(entry.count).toBe(1);
  });
  it("calculates retry timing from the later of quota and lease expiry", async () => {
    await acquireCleanupLease("owner");
    await db.update(schema.photoCleanupLimitsTable).set({
      count: 4,
      windowExpiresAt: sql`clock_timestamp() + interval '125 seconds'`,
      leaseExpiresAt: sql`clock_timestamp() + interval '315 seconds'`,
    });
    const denied = await acquireCleanupLease("owner");
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 315 });
  });
});
