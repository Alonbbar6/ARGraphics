import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { objects, storage } from "./support/storage";

// Never start background HTTP polling or leave real timers running. Only the
// initial generation request is under test; its fetch is mocked explicitly.
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => new Promise(() => {})),
}));

const paths = {
  sourcePhotoPath: "/objects/uploads/22222222-2222-4222-8222-222222222222",
  cleanedPhotoPath: "/objects/uploads/33333333-3333-4333-8333-333333333333",
};
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
type Format = "png" | "jpeg" | "webp";
type Kind = "original" | "cleaned";

async function image(format: Format, width = 8, height = 8) {
  return sharp({ create: { width, height, channels: 3, background: "#009988" } })
    .toFormat(format).toBuffer();
}

function upload(kind: Kind, bytes: Buffer, contentType = "image/png", size = bytes.length) {
  objects.set(kind === "original" ? paths.sourcePhotoPath : paths.cleanedPhotoPath,
    { bytes, contentType, size });
}

async function prepare() {
  vi.stubEnv("MESHY_API_KEY", "offline-fixture-not-a-real-key");
  const cookie = await signIn();
  await db.update(schema.drinksTable).set({
    sourcePhotoUrl: paths.sourcePhotoPath, cleanedPhotoUrl: paths.cleanedPhotoPath,
  }).where(eq(schema.drinksTable.id, "fixture-drink"));
  const bytes = await image("png");
  upload("original", bytes);
  upload("cleaned", bytes);
  return cookie;
}

async function rejectPhoto(cookie: string, message: RegExp) {
  const beforeDrinks = await db.select().from(schema.drinksTable);
  const beforeMenu = await db.select().from(schema.menuVersionTable);
  const fetch = vi.spyOn(globalThis, "fetch");
  const result = await request(app).post("/api/drinks/fixture-drink/generation")
    .set("Cookie", cookie).send(paths).expect(400);
  expect(result.body.error).toMatch(message);
  expect(fetch).not.toHaveBeenCalled();
  expect(storage.getObjectEntityReadURL).not.toHaveBeenCalled();
  expect(await db.select().from(schema.drinksTable)).toEqual(beforeDrinks);
  expect(await db.select().from(schema.menuVersionTable)).toEqual(beforeMenu);
}

describe.each(["original", "cleaned"] as const)("%s drink-photo validation (offline)", (kind) => {
  it.each(["png", "jpeg", "webp"] as const)("rejects spoofed %s before any paid call", async (format) => {
    const cookie = await prepare();
    upload(kind, Buffer.from("<svg><script>alert(1)</script></svg>"), `image/${format}`);
    await rejectPhoto(cookie, new RegExp(`${kind} photo.*complete, valid`));
  });

  it.each(["png", "jpeg", "webp"] as const)("rejects truncated %s with truthful metadata", async (format) => {
    const cookie = await prepare();
    const bytes = await image(format);
    upload(kind, bytes.subarray(0, bytes.length - 4), `image/${format}`);
    await rejectPhoto(cookie, /complete, valid/);
  });

  it("rejects a JPEG disguised as PNG", async () => {
    const cookie = await prepare();
    upload(kind, await image("jpeg"));
    await rejectPhoto(cookie, /do not match/);
  });

  it("rejects corrupt pixels even when PNG metadata and container markers are intact", async () => {
    const cookie = await prepare();
    const bytes = await image("png", 32, 32);
    const idat = bytes.indexOf(Buffer.from("IDAT"));
    const length = bytes.readUInt32BE(idat - 4);
    bytes.fill(0, idat + 4, idat + 4 + length);
    expect((await sharp(bytes).metadata()).width).toBe(32);
    upload(kind, bytes);
    await rejectPhoto(cookie, /complete, valid/);
  });

  it.each([[8193, 1], [1, 8193], [4001, 4000]])(
    "rejects excessive dimensions %s x %s", async (width, height) => {
      const cookie = await prepare();
      upload(kind, await image("png", width, height));
      await rejectPhoto(cookie, /too large to decode/);
    },
  );

  it("checks actual size instead of trusting metadata", async () => {
    const cookie = await prepare();
    upload(kind, await image("png"), "image/png", 1);
    await rejectPhoto(cookie, /complete, valid/);
  });

  it.each([0, MAX_PHOTO_BYTES + 1, NaN])("rejects invalid declared size %s", async (size) => {
    const cookie = await prepare();
    upload(kind, await image("png"), "image/png", size);
    await rejectPhoto(cookie, /supported image under 15 MB/);
  });

  it("bounds downloaded bytes independently of metadata and destroys the stream", async () => {
    const cookie = await prepare();
    const stream = Readable.from([Buffer.alloc(MAX_PHOTO_BYTES), Buffer.alloc(1)]);
    const createReadStream = vi.fn(() => stream);
    if (kind === "cleaned") {
      // Consume the original-photo lookup normally before testing cleaned bytes.
      storage.getObjectEntityFile.mockImplementationOnce(storage.getObjectEntityFile.getMockImplementation()!);
    }
    storage.getObjectEntityFile.mockResolvedValueOnce({
      getMetadata: async () => [{ contentType: "image/png", size: "1" }], createReadStream,
    });
    await rejectPhoto(cookie, /exceeds the 15 MB limit/);
    expect(createReadStream).toHaveBeenCalledWith({ end: MAX_PHOTO_BYTES });
    expect(stream.destroyed).toBe(true);
  });

  it("does not change the drink if the stored photo is missing", async () => {
    const cookie = await prepare();
    objects.delete(kind === "original" ? paths.sourcePhotoPath : paths.cleanedPhotoPath);
    await rejectPhoto(cookie, new RegExp(`${kind} photo could not be read`));
  });
});

describe("valid drink photos reach mocked generation", () => {
  it.each(["png", "jpeg", "webp"] as const)("accepts %s originals and cleaned photos", async (format) => {
    const cookie = await prepare();
    const bytes = await image(format);
    upload("original", bytes, `image/${format}`);
    upload("cleaned", bytes, `image/${format}`);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ result: `offline-task-${format}` }), { status: 200 },
    ));
    await request(app).post("/api/drinks/fixture-drink/generation")
      .set("Cookie", cookie).send(paths).expect(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://api.meshy.ai/openapi/v1/image-to-3d",
      expect.objectContaining({ method: "POST" }));
    expect(storage.getObjectEntityReadURL).toHaveBeenCalledWith(paths.cleanedPhotoPath, 3600);
    const options = fetch.mock.calls[0][1]!;
    expect(JSON.parse(options.body as string).image_url)
      .toContain(encodeURIComponent(paths.cleanedPhotoPath));
    const [drink] = await db.select().from(schema.drinksTable)
      .where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(drink).toMatchObject({
      meshyTaskId: `offline-task-${format}`, generationStatus: "processing", isPublished: false,
    });
  });
});
