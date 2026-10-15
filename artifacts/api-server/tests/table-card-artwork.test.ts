import { Readable } from "node:stream";
import sharp from "sharp";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { cardBody, signIn } from "./support/requests";
import { acceptedArtworkPath, artworkPath, objects, storage } from "./support/storage";
import { MAX_ARTWORK_BYTES } from "../src/lib/tableCardArtwork";

async function image(format: "png" | "jpeg" | "webp", width = 8, height = 8) {
  return sharp({ create: { width, height, channels: 3, background: "#009988" } })
    .toFormat(format).toBuffer();
}

function upload(bytes: Buffer, contentType = "image/png", size = bytes.length) {
  objects.set(artworkPath, { bytes, contentType, size });
}

async function rejectArtwork(message: RegExp) {
  const cookie = await signIn();
  const before = await db.select().from(schema.menuVersionTable);
  const result = await request(app).post("/api/table-cards").set("Cookie", cookie)
    .send(cardBody).expect(400);
  expect(result.body.error).toMatch(message);
  expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
  expect(await db.select().from(schema.menuVersionTable)).toEqual(before);
}

describe("table-card artwork content validation (offline)", () => {
  it.each(["png", "jpeg", "webp"] as const)("accepts fully decodable %s artwork", async (format) => {
    const bytes = await image(format, 32, 32);
    upload(bytes, `image/${format}`);
    const cookie = await signIn();
    const saved = await request(app).post("/api/table-cards").set("Cookie", cookie)
      .send(cardBody).expect(201);
    expect(saved.body.referenceImageUrl).toContain(acceptedArtworkPath.slice("/objects".length));
    expect(await db.select().from(schema.tableCardsTable)).toHaveLength(1);
    expect(objects.get(artworkPath)?.bytes).toEqual(bytes);
    expect(objects.get(acceptedArtworkPath)?.bytes).toEqual(bytes);
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("rejects arbitrary bytes labeled %s", async (type) => {
    upload(Buffer.from("<svg><script>alert(1)</script></svg>"), type);
    await rejectArtwork(/complete, valid PNG, JPEG, or WebP/);
  });

  it("rejects a real JPEG mislabeled as PNG", async () => {
    upload(await image("jpeg"), "image/png");
    await rejectArtwork(/do not match/);
  });

  it.each(["png", "jpeg", "webp"] as const)("rejects truncated %s even with truthful size", async (format) => {
    const bytes = await image(format, 32, 32);
    upload(bytes.subarray(0, bytes.length - 4), `image/${format}`);
    await rejectArtwork(/complete, valid/);
  });

  it.each(["png", "jpeg", "webp"] as const)("rejects corrupt %s with intact container markers", async (format) => {
    const bytes = await image(format, 32, 32);
    // Keep the signature and ending intact, but remove the compressed body.
    const corrupt = Buffer.concat([bytes.subarray(0, 24), bytes.subarray(-12)]);
    if (format === "webp") corrupt.writeUInt32LE(corrupt.length - 8, 4);
    upload(corrupt, `image/${format}`);
    await rejectArtwork(/complete, valid/);
  });

  it("fully decodes pixels rather than accepting readable PNG metadata", async () => {
    const bytes = await image("png", 32, 32);
    const idat = bytes.indexOf(Buffer.from("IDAT"));
    expect(idat).toBeGreaterThan(0);
    const payloadLength = bytes.readUInt32BE(idat - 4);
    bytes.fill(0, idat + 4, idat + 4 + payloadLength);
    expect((await sharp(bytes).metadata()).width).toBe(32);
    upload(bytes);
    await rejectArtwork(/complete, valid/);
  });

  it.each([[8193, 1], [1, 8193], [4001, 4000]])(
    "rejects excessive decoded dimensions %s x %s", async (width, height) => {
      upload(await image("png", width, height));
      await rejectArtwork(/too large to decode/);
    },
  );

  it("rejects an empty stored image", async () => {
    upload(Buffer.alloc(0));
    await rejectArtwork(/supported image under 10 MB/);
  });

  it("checks downloaded size instead of trusting metadata", async () => {
    upload(await image("png"), "image/png", 1);
    await rejectArtwork(/complete, valid/);
  });

  it("bounds the actual read even if metadata understates the size", async () => {
    upload(Buffer.from("fixture"));
    const stream = Readable.from([Buffer.alloc(MAX_ARTWORK_BYTES), Buffer.alloc(1)]);
    const createReadStream = vi.fn(() => stream);
    storage.getObjectEntityFile.mockResolvedValueOnce({
      getMetadata: async () => [{ contentType: "image/png", size: "1" }],
      createReadStream,
    });
    await rejectArtwork(/exceeds the 10 MB limit/);
    expect(createReadStream).toHaveBeenCalledWith({ end: MAX_ARTWORK_BYTES });
    expect(stream.destroyed).toBe(true);
  });
});
