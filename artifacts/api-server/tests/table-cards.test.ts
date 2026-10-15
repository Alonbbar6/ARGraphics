import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { cardBody, createCard, signIn } from "./support/requests";
import { artworkBytes, artworkPath, objects, storage, uploadArtwork } from "./support/storage";

const privateUrl = `/api/storage/objects/${artworkPath.replace("/objects/", "")}`;
const uploadBody = { name: "card.png", size: artworkBytes.length, contentType: "image/png" };

describe("signed-in owner table-card lifecycle", () => {
  it("updates saved details without deleting the card or artwork and advances the menu version", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    const [before] = (await db.select().from(schema.menuVersionTable))
      .filter(row => row.barId === "garnish-demo-bar");
    const updated = await request(app).patch(`/api/table-cards/${saved.body.id}`)
      .set("Cookie", cookie).send({ name: "  Edited card  ", physicalWidthCm: 20, isActive: false }).expect(200);
    expect(updated.body).toMatchObject({
      id: saved.body.id, name: "Edited card", physicalWidthCm: 20,
      isActive: false, referenceImageUrl: saved.body.referenceImageUrl,
    });
    expect(await db.select().from(schema.tableCardsTable)).toHaveLength(1);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    expect(objects.has(artworkPath)).toBe(true);
    const [after] = (await db.select().from(schema.menuVersionTable))
      .filter(row => row.barId === "garnish-demo-bar");
    expect(after.version).toBe(before.version + 1);
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
  });

  it("rejects empty or unsupported updates and keeps another bar's saved card untouched", async () => {
    const cookie = await signIn();
    const other = await signIn("other@example.test");
    const saved = await createCard(cookie);
    await request(app).patch(`/api/table-cards/${saved.body.id}`).send({ name: "No access" }).expect(401);
    await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", other)
      .send({ name: "No access" }).expect(404);
    for (const body of [{}, { objectPath: "/objects/replacement" }, { physicalWidthCm: 0 }, { name: "   " }]) {
      await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).send(body).expect(400);
    }
    const [card] = await db.select().from(schema.tableCardsTable);
    expect(card.name).toBe(saved.body.name);
    expect(card.referenceImageUrl).toBe(artworkPath);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
  });

  it("requests an upload, saves, lists, streams private artwork, and deletes", async () => {
    const cookie = await signIn();
    const upload = await request(app).post("/api/storage/uploads/request-url")
      .set("Cookie", cookie).send(uploadBody).expect(200);
    expect(upload.body).toEqual({
      uploadURL: "https://storage.example.test/signed-upload",
      objectPath: artworkPath, metadata: uploadBody,
    });
    expect(storage.getObjectEntityUploadURL).toHaveBeenCalledOnce();
    // The signed PUT lives outside our API; deliver its bytes to the storage double.
    uploadArtwork(upload.body.objectPath);
    const saved = await request(app).post("/api/table-cards").set("Cookie", cookie)
      .send({ ...cardBody, name: "  Front table  " }).expect(201);
    expect(saved.body).toMatchObject({
      name: "Front table", referenceImageUrl: privateUrl,
      physicalWidthCm: 12.5, isActive: true,
    });
    expect(saved.body.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(new Date(saved.body.createdAt).toISOString()).toBe(saved.body.createdAt);
    const [persisted] = await db.select().from(schema.tableCardsTable);
    expect(persisted.barId).toBe("garnish-demo-bar");
    expect(Number(persisted.physicalWidthMeters)).toBe(0.125);

    const list = await request(app).get("/api/table-cards").set("Cookie", cookie).expect(200);
    expect(list.body).toEqual([saved.body]);
    const image = await request(app).get(privateUrl).set("Cookie", cookie).expect(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cache-control"]).toBe("private, max-age=300");
    expect(image.body).toEqual(artworkBytes);

    await request(app).delete(`/api/table-cards/${saved.body.id}`)
      .set("Cookie", cookie).expect(200, { message: "Table card deleted." });
    expect(storage.deleteObjectEntity).toHaveBeenCalledWith(artworkPath);
    expect(objects.has(artworkPath)).toBe(false);
    await request(app).get("/api/table-cards").set("Cookie", cookie).expect(200, []);
    await request(app).get(privateUrl).set("Cookie", cookie).expect(404);
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(404);
  });

  it("rejects anonymous upload, listing, create, artwork read, and deletion", async () => {
    await request(app).post("/api/storage/uploads/request-url").send(uploadBody).expect(401);
    await request(app).get("/api/table-cards").expect(401);
    await request(app).post("/api/table-cards").send(cardBody).expect(401);
    await request(app).get(privateUrl).expect(401);
    await request(app).delete("/api/table-cards/missing").expect(401);
    expect(storage.getObjectEntityUploadURL).not.toHaveBeenCalled();
    expect(storage.getObjectEntityFile).not.toHaveBeenCalled();
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
  });

  it("rejects tampered and expired session cookies", async () => {
    const cookie = await signIn();
    await request(app).get("/api/table-cards").set("Cookie", `${cookie}x`).expect(401);
    const { createHmac } = await import("node:crypto");
    const payload = Buffer.from(JSON.stringify({ userId: "owner", expiresAt: Date.now() - 1 })).toString("base64url");
    const signature = createHmac("sha256", "session-regression-fixture-secret").update(payload).digest("base64url");
    await request(app).get("/api/table-cards")
      .set("Cookie", `garnish_session=${payload}.${signature}`).expect(401);
  });

  it("keeps another owner's cards and artwork private and prevents their deletion", async () => {
    const owner = await signIn();
    const other = await signIn("other@example.test");
    const saved = await createCard(owner);
    await request(app).get("/api/table-cards").set("Cookie", other).expect(200, []);
    await request(app).get(privateUrl).set("Cookie", other).expect(404);
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", other).expect(404);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    expect(objects.has(artworkPath)).toBe(true);
    expect(await db.select().from(schema.tableCardsTable)).toHaveLength(1);
  });

  it.each([
    { contentType: "application/pdf" }, { size: 0 }, { size: 10 * 1024 * 1024 + 1 },
    { size: 1.5 }, { name: "" }, { name: "x".repeat(161) },
  ])("rejects invalid upload metadata %j before signing", async (invalid) => {
    const cookie = await signIn();
    await request(app).post("/api/storage/uploads/request-url").set("Cookie", cookie)
      .send({ ...uploadBody, ...invalid }).expect(400);
    expect(storage.getObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s at the upload limit", async (contentType) => {
    const cookie = await signIn();
    await request(app).post("/api/storage/uploads/request-url").set("Cookie", cookie)
      .send({ ...uploadBody, contentType, size: 10 * 1024 * 1024 }).expect(200);
  });

  it.each([
    { physicalWidthCm: 0 }, { physicalWidthCm: -1 }, { physicalWidthCm: 100.1 },
    { physicalWidthCm: "10" }, { name: "" }, { name: "x".repeat(81) },
    { objectPath: "https://example.test/image.png" }, { objectPath: "/objects/not-an-upload" },
  ])("rejects invalid card input %j without touching storage or saving", async (invalid) => {
    const cookie = await signIn();
    await request(app).post("/api/table-cards").set("Cookie", cookie)
      .send({ ...cardBody, ...invalid }).expect(400);
    expect(storage.getObjectEntityFile).not.toHaveBeenCalled();
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
  });

  it("rejects artwork not uploaded yet", async () => {
    const cookie = await signIn();
    await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(400);
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
  });

  it.each([
    ["application/pdf", 100],
    ["image/png", 10 * 1024 * 1024 + 1],
  ])("checks actual stored type %s and size %s, not only client metadata", async (type, size) => {
    const cookie = await signIn();
    uploadArtwork(artworkPath, type, size);
    await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(400);
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
    const versions = await db.select().from(schema.menuVersionTable);
    expect(versions.every((row) => row.version === 1)).toBe(true);
  });

  it("does not expose unregistered objects or arbitrary storage paths", async () => {
    const cookie = await signIn();
    uploadArtwork();
    await request(app).get(privateUrl).set("Cookie", cookie).expect(404);
    await request(app).get("/api/storage/objects/private/secret.png").set("Cookie", cookie).expect(404);
    expect(storage.getObjectEntityFile).not.toHaveBeenCalled();
  });

  it("returns 404 when a registered object's bytes are missing", async () => {
    const cookie = await signIn();
    await createCard(cookie);
    objects.clear();
    await request(app).get(privateUrl).set("Cookie", cookie).expect(404);
  });

  it("returns a controlled error if upload signing fails", async () => {
    const cookie = await signIn();
    storage.getObjectEntityUploadURL.mockRejectedValueOnce(new Error("fixture outage"));
    await request(app).post("/api/storage/uploads/request-url").set("Cookie", cookie)
      .send(uploadBody).expect(500, { error: "Could not start the artwork upload." });
  });

  it("updates only the owner's card details without deleting the card or artwork", async () => {
    const cookie = await signIn();
    const other = await signIn("other@example.test");
    const saved = await createCard(cookie);
    const versionBefore = (await db.select().from(schema.menuVersionTable))
      .find((row) => row.barId === "garnish-demo-bar")!.version;
    await request(app).patch(`/api/table-cards/${saved.body.id}`).expect(401);
    await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", other)
      .send({ name: "Not yours" }).expect(404);
    for (const invalid of [{}, { objectPath: artworkPath }, { name: "  " }, { physicalWidthCm: 0 }]) {
      await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie)
        .send(invalid).expect(400);
    }
    const edited = await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie)
      .send({ name: "  Edited card  ", physicalWidthCm: 22, isActive: false }).expect(200);
    expect(edited.body).toMatchObject({
      id: saved.body.id, name: "Edited card", physicalWidthCm: 22,
      isActive: false, referenceImageUrl: saved.body.referenceImageUrl,
    });
    const [persisted] = await db.select().from(schema.tableCardsTable);
    expect(persisted.referenceImageUrl).toBe(artworkPath);
    expect(Number(persisted.physicalWidthMeters)).toBe(0.22);
    expect(objects.has(artworkPath)).toBe(true);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    const versionAfter = (await db.select().from(schema.menuVersionTable))
      .find((row) => row.barId === "garnish-demo-bar")!.version;
    expect(versionAfter).toBe(versionBefore + 1);
    await request(app).get(privateUrl).set("Cookie", cookie).expect(200);
  });

  it("still removes a card and revokes private access if storage cleanup fails", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    storage.deleteObjectEntity.mockRejectedValueOnce(new Error("fixture outage"));
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await request(app).get(privateUrl).set("Cookie", cookie).expect(404);
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
  });
});
