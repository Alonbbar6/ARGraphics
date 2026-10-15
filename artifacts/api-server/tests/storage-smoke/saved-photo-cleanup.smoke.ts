import request from "supertest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db, schema } from "../support/database";
import { ObjectStorageService } from "../../src/lib/objectStorage";
import { getObjectAclPolicy } from "../../src/lib/objectAcl";
import { prepareCleanupPhoto } from "../../src/lib/photo-cleanup";
import { app, manifest } from "./setup";

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
type Draft = { id: string; sourcePhotoPath: string; cleanedPhotoPath: string; status: string };

async function signIn(email = "demo@garnish.app") {
  const response = await request(app).post("/api/auth/login")
    .send({ email, password: "fixture-password" }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

async function checkImages(draft: Draft, source: Buffer, cleaned: Buffer, owner: string, other: string) {
  const storage = new ObjectStorageService();
  for (const [kind, path, bytes] of [
    ["source", draft.sourcePhotoPath, source],
    ["cleaned", draft.cleanedPhotoPath, cleaned],
  ] as const) {
    manifest.assertOwned(path);
    // Keep provider failures from printing bucket paths or credential details.
    const file = await storage.getObjectEntityFile(path).catch(() => {
      throw new Error("Disposable private image could not be resolved.");
    });
    const details = await (async () => {
      try {
        const [metadata] = await file.getMetadata();
        const [stored] = await file.download();
        return { metadata, stored, acl: await getObjectAclPolicy(file) };
      } catch {
        throw new Error("Disposable private image metadata/download failed.");
      }
    })();
    expect(details.stored).toEqual(bytes);
    expect(details.metadata.contentType).toBe("image/png");
    expect(details.metadata.cacheControl).toBe("private, no-store");
    expect(Number(details.metadata.size)).toBe(bytes.length);
    expect(details.acl).toEqual({ owner: "owner", visibility: "private" });

    const imageURL = `${endpoint}/${draft.id}/${kind}`;
    await request(app).get(imageURL).expect(401);
    await request(app).get(imageURL).set("Cookie", other).expect(404);
    const response = await request(app).get(imageURL).set("Cookie", owner).expect(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    // The generic artwork route must not expose cleanup images to other owners.
    await request(app).get(`/api/storage${path}`).expect(401);
    await request(app).get(`/api/storage${path}`).set("Cookie", other).expect(404);
    // Private at the cloud provider too, not just behind the Express route.
    const unsigned = `https://storage.googleapis.com${manifest.directory}/${path.slice("/objects/".length)}`;
    const denied = await fetch(unsigned, { redirect: "error" });
    expect([401, 403]).toContain(denied.status);
    await denied.body?.cancel();
  }
}

it("stores real private cutouts, resumes exact bytes, and recovers interrupted metadata without another paid call", async () => {
  const owner = await signIn();
  const other = await signIn("other@example.test");
  const input = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#a43010" } })
    .jpeg().toBuffer();
  const source = await prepareCleanupPhoto(input);
  const cleaned = await sharp({ create: { width: 12, height: 10, channels: 4, background: { r: 120, g: 30, b: 10, alpha: 0.5 } } })
    .png().toBuffer();
  mocks.edit.mockResolvedValue({ data: [{ b64_json: cleaned.toString("base64") }] });
  const [drinkBefore] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
  const [menuBefore] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "garnish-demo-bar"));
  await request(app).post(endpoint).type("jpeg").send(input).expect(401);
  await request(app).get(endpoint).expect(401);
  await request(app).get(endpoint).set("Cookie", other).expect(404);
  await request(app).post(endpoint).set("Cookie", other).type("jpeg").send(input).expect(404);
  expect(mocks.edit).not.toHaveBeenCalled();

  const saved = await request(app).post(endpoint).set("Cookie", owner).type("jpeg").send(input).expect(200);
  const draft: Draft = saved.body.draft;
  expect(draft.status).toBe("ready");
  await checkImages(draft, source, cleaned, owner, other);
  for (let reopen = 0; reopen < 2; reopen++) {
    const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
    expect(resumed.body.draft).toEqual(draft);
    expect(resumed.headers["cache-control"]).toBe("private, no-store");
  }
  expect(mocks.edit).toHaveBeenCalledTimes(1);

  // Fail only the final metadata updates, not reservation or real storage.
  // All three retries fail after the paid output has been durably written.
  const update = vi.spyOn(db, "update").mockImplementation(() => {
    throw new Error("Synthetic final metadata interruption");
  });
  try {
    await request(app).post(endpoint).set("Cookie", owner).type("jpeg").send(input).expect(503);
    expect(update).toHaveBeenCalledTimes(3);
  } finally {
    update.mockRestore();
  }
  const [interrupted] = await db.select().from(schema.photoCleanupsTable)
    .where(eq(schema.photoCleanupsTable.status, "processing"));
  expect(interrupted).toBeDefined();
  expect(interrupted.cleanedSize).toBeNull();
  manifest.assertOwned(interrupted.sourcePhotoPath);
  manifest.assertOwned(interrupted.cleanedPhotoPath!);
  // Other owners cannot trigger metadata recovery or read the pending result.
  await request(app).get(endpoint).set("Cookie", other).expect(404);
  await request(app).get(`${endpoint}/${interrupted.id}/cleaned`).set("Cookie", owner).expect(404);
  const recovered = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
  expect(recovered.body.draft.id).toBe(interrupted.id);
  expect(recovered.body.draft.status).toBe("ready");
  const [persisted] = await db.select().from(schema.photoCleanupsTable)
    .where(eq(schema.photoCleanupsTable.id, interrupted.id));
  expect(persisted.status).toBe("ready");
  expect(persisted.cleanedSize).toBe(cleaned.length);
  expect(persisted.ownerId).toBe("owner");
  expect(persisted.sourceSize).toBe(source.length);
  await checkImages(recovered.body.draft, source, cleaned, owner, other);
  const reopened = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
  expect(reopened.body.draft).toEqual(recovered.body.draft);
  expect(mocks.edit).toHaveBeenCalledTimes(2); // One per explicit POST, none on recovery.
  // Private drafts must not publish anything or start a 3D generation.
  const [drinkAfter] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
  const [menuAfter] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "garnish-demo-bar"));
  expect(drinkAfter).toEqual(drinkBefore);
  expect(menuAfter).toEqual(menuBefore);
});
