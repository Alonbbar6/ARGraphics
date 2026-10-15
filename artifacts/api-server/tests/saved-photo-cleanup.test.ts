import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { objects, storage } from "./support/storage";
import { cleanupRequestTimeoutMs } from "../src/lib/photo-cleanup-limits";

const mocks = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    images = { edit: mocks.edit };
  }
  return { default: OpenAI, toFile: vi.fn(async (bytes) => bytes) };
});

const endpoint = "/api/drinks/fixture-drink/photo-cleanup";
const png = () => sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 120, g: 30, b: 10, alpha: 0.5 } } }).png().toBuffer();
let rateWindow = Date.UTC(2026, 0, 1);

beforeEach(async () => {
  rateWindow += 600_001;
  vi.spyOn(Date, "now").mockReturnValue(rateWindow);
  vi.stubEnv("OPENAI_API_KEY", "mocked-openai-key");
  mocks.edit.mockReset();
  mocks.edit.mockResolvedValue({ data: [{ b64_json: (await png()).toString("base64") }] });
});

describe("saved paid cutout lifecycle", () => {
  it("saves private bytes and owner metadata, then resumes without another paid call or changing the live menu", async () => {
    const cookie = await signIn();
    const response = await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    const draft = response.body.draft;
    expect(draft.status).toBe("ready");
    expect(objects.get(draft.cleanedPhotoPath)?.bytes).toEqual(await png());
    expect(storage.savePrivateImage).toHaveBeenCalledWith(expect.any(Buffer), "owner", draft.cleanedPhotoPath);
    const [saved] = await db.select().from(schema.photoCleanupsTable);
    expect(saved.ownerId).toBe("owner");
    expect(saved.cleanedSize).toBeGreaterThan(0);
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(drink.generationStatus).toBe("none");
    expect(drink.sourcePhotoUrl).toBeNull();
    expect(drink.isPublished).toBe(true);
    for (let i = 0; i < 3; i++) {
      const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
      expect(resumed.body.draft.id).toBe(draft.id);
    }
    for (const kind of ["source", "cleaned"]) {
      const image = await request(app).get(`${endpoint}/${draft.id}/${kind}`).set("Cookie", cookie).expect(200);
      expect(image.headers["cache-control"]).toBe("private, no-store");
      expect(image.headers["content-type"]).toContain("image/png");
    }
    // Accepted saved paths reach the provider-configuration boundary, not upload mismatch.
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie)
      .send({ sourcePhotoPath: draft.sourcePhotoPath, cleanedPhotoPath: draft.cleanedPhotoPath }).expect(503);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("keeps both metadata and bytes inaccessible to another owner and unauthenticated requests", async () => {
    const cookie = await signIn();
    const other = await signIn("other@example.test");
    const { body } = await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    await request(app).get(endpoint).expect(401);
    await request(app).get(endpoint).set("Cookie", other).expect(404);
    await request(app).post(endpoint).set("Cookie", other).type("png").send(await png()).expect(404);
    for (const kind of ["source", "cleaned"]) {
      await request(app).get(`${endpoint}/${body.draft.id}/${kind}`).expect(401);
      await request(app).get(`${endpoint}/${body.draft.id}/${kind}`).set("Cookie", other).expect(404);
      await request(app).get(`/api/storage/objects/${body.draft.cleanedPhotoPath.replace("/objects/", "")}`).set("Cookie", other).expect(404);
    }
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("continues saving when the client closes before OpenAI responds", async () => {
    const cookie = await signIn();
    const output = await png();
    let finish!: (value: { data: { b64_json: string }[] }) => void;
    mocks.edit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = request(app).post(endpoint).set("Cookie", cookie).type("png").send(output);
    const completed = pending.then(() => undefined, () => undefined);
    await vi.waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    const resumed = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(resumed.body.draft.status).toBe("processing");
    pending.abort();
    await request(app).post("/api/drinks/photo-cleanup").set("Cookie", cookie).type("png").send(output).expect(429);
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(output).expect(429);
    finish({ data: [{ b64_json: output.toString("base64") }] });
    await completed;
    await vi.waitFor(async () => {
      const saved = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
      expect(saved.body.draft.status).toBe("ready");
      const [lease] = await db.select().from(schema.photoCleanupLimitsTable);
      expect(lease.leaseToken).toBeNull();
    });
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("does not charge when source storage is unavailable, and recovers already-stored results", async () => {
    const cookie = await signIn();
    storage.savePrivateImage.mockRejectedValueOnce(new Error("storage unavailable"));
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(502);
    expect(mocks.edit).not.toHaveBeenCalled();
    const response = await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    await db.update(schema.photoCleanupsTable).set({ status: "processing", cleanedSize: null })
      .where(eq(schema.photoCleanupsTable.id, response.body.draft.id));
    const recovered = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(recovered.body.draft.status).toBe("ready");
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("retries a cutout storage failure without making another OpenAI call", async () => {
    const cookie = await signIn();
    const save = storage.savePrivateImage.getMockImplementation()!;
    storage.savePrivateImage.mockImplementationOnce(save).mockRejectedValueOnce(new Error("temporary storage failure"));
    const result = await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    expect(result.body.draft.status).toBe("ready");
    expect(storage.savePrivateImage).toHaveBeenCalledTimes(3);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("recovers the paid cutout after all final metadata writes fail", async () => {
    const cookie = await signIn();
    const originalUpdate = db.update.bind(db);
    const update = vi.spyOn(db, "update").mockImplementation((table) => {
      if (table === schema.photoCleanupsTable) throw new Error("temporary database outage");
      return originalUpdate(table);
    });
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(503);
    expect(update.mock.calls.filter(([table]) => table === schema.photoCleanupsTable)).toHaveLength(3);
    update.mockRestore();
    const result = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(result.body.draft.status).toBe("ready");
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("prevents a second server from spending on the same in-progress drink and unlocks interrupted jobs", async () => {
    const cookie = await signIn();
    await db.insert(schema.photoCleanupsTable).values({
      id: "pending-cutout", ownerId: "owner", drinkId: "fixture-drink",
      sourcePhotoPath: "/objects/uploads/pending-source", sourceSize: 50,
      updatedAt: new Date(Date.now()),
    });
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(409);
    expect(mocks.edit).not.toHaveBeenCalled();
    await db.update(schema.photoCleanupsTable).set({ updatedAt: new Date(Date.now() - 300_001) });
    const interrupted = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(interrupted.body.draft.status).toBe("failed");
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });

  it("reports failed cleanup and rejects non-images without spending or starting Meshy", async () => {
    const cookie = await signIn();
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(Buffer.from("not a photo")).expect(400);
    expect(mocks.edit).not.toHaveBeenCalled();
    mocks.edit.mockResolvedValue({ data: [] });
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(502);
    const failed = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(failed.body.draft.status).toBe("failed");
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie)
      .send({ sourcePhotoPath: failed.body.draft.sourcePhotoPath, cleanedPhotoPath: failed.body.draft.cleanedPhotoPath }).expect(400);
  });

  it("resumes the earlier paid cutout after a failed replacement and accepts it for generation", async () => {
    const cookie = await signIn();
    const { body: original } = await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(200);
    // Move the fixture clock so the replacement has a distinct creation instant.
    vi.spyOn(Date, "now").mockReturnValue(rateWindow + 1000);
    mocks.edit.mockResolvedValue({ data: [] });
    await request(app).post(endpoint).set("Cookie", cookie).type("png").send(await png()).expect(502);
    for (let reopen = 0; reopen < 2; reopen++) {
      const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
      expect(resumed.body.draft.status).toBe("failed");
      expect(resumed.body.previousReadyDraft).toEqual(original.draft);
    }
    for (const kind of ["source", "cleaned"]) {
      await request(app).get(`${endpoint}/${original.draft.id}/${kind}`).set("Cookie", cookie).expect(200);
    }
    // The saved original reaches Meshy configuration, without any re-upload or cleanup.
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send({
      sourcePhotoPath: original.draft.sourcePhotoPath, cleanedPhotoPath: original.draft.cleanedPhotoPath,
    }).expect(503);
    const other = await signIn("other@example.test");
    await request(app).get(endpoint).set("Cookie", other).expect(404);
    expect(mocks.edit).toHaveBeenCalledTimes(2);
  });
  it("shares its four-attempt quota with legacy cleanups, not one quota per route or drink", async () => {
    const cookie = await signIn();
    const output = await png();
    for (let i = 0; i < 4; i++) {
      const path = i % 2 === 0 ? endpoint : "/api/drinks/photo-cleanup";
      await request(app).post(path).set("Cookie", cookie).type("png").send(output).expect(200);
    }
    for (const path of [endpoint, "/api/drinks/photo-cleanup"]) {
      const denied = await request(app).post(path).set("Cookie", cookie).type("png").send(output).expect(429);
      expect(Number(denied.headers["retry-after"])).toBeGreaterThan(590);
      expect(Number(denied.headers["retry-after"])).toBeLessThanOrEqual(600);
    }
    expect(mocks.edit).toHaveBeenCalledTimes(4);
    const other = await signIn("other@example.test");
    await request(app).post("/api/drinks/other-drink/photo-cleanup").set("Cookie", other).type("png").send(output).expect(200);
    expect(mocks.edit).toHaveBeenCalledTimes(5);
  });
  it("keeps a server deadline for saved cleanups and releases only after cancellation settles", async () => {
    const cookie = await signIn();
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
        signal.addEventListener("abort", () => { settle = () => reject(signal.reason); }, { once: true });
        started();
      }));
    const output = await png();
    const first = request(app).post(endpoint).set("Cookie", cookie).type("png").send(output).then(response => response);
    await pending;
    deadline();
    await request(app).post("/api/drinks/photo-cleanup").set("Cookie", cookie).type("png").send(output).expect(429);
    settle();
    expect((await first).status).toBe(504);
    const saved = await request(app).get(endpoint).set("Cookie", cookie).expect(200);
    expect(saved.body.draft.status).toBe("failed");
    const [lease] = await db.select().from(schema.photoCleanupLimitsTable);
    expect(lease.count).toBe(1);
    expect(lease.leaseToken).toBeNull();
  });
});
