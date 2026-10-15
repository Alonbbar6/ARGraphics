import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import express from "express";
import request from "supertest";

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

const image = () => sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 200, g: 100, b: 10, alpha: 0.5 } } }).png().toBuffer();

beforeEach(() => {
  mocks.edit.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-real-key");
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
    await expect(cleanupDrinkPhoto(await image())).rejects.toThrow("OPENAI_API_KEY");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("requests a transparent edit and returns the real provider image", async () => {
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    expect(await cleanupDrinkPhoto(png)).toEqual(png);
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-image-1", background: "transparent", output_format: "png", n: 1,
    }));
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
    expect((await request(app("mime-test")).post("/drinks/photo-cleanup").type("text").send("x")).status).toBe(415);
  });
  it("returns an uncacheable PNG", async () => {
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    const response = await request(app("success-test")).post("/drinks/photo-cleanup").type("png").send(png);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("limits paid attempts per owner", async () => {
    const server = app("rate-test");
    const png = await image();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: png.toString("base64") }] });
    for (let i = 0; i < 4; i++) {
      expect((await request(server).post("/drinks/photo-cleanup").type("png").send(png)).status).toBe(200);
    }
    expect((await request(server).post("/drinks/photo-cleanup").type("png").send(png)).status).toBe(429);
    expect(mocks.edit).toHaveBeenCalledTimes(4);
  });
});
