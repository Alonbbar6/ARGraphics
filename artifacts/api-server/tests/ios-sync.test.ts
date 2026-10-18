import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { client, db, schema } from "./support/database";
import { cardBody, createCard, iosGet, iosKey, signIn } from "./support/requests";
import { acceptedArtworkPath, artworkPath, objects, storage, uploadArtwork } from "./support/storage";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { expectResponseContract } from "./support/response-contracts";

// Keep background Meshy polling paused without live timers or HTTP requests.
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => new Promise(() => {})),
}));

const drinkEdits = [
  { name: "Updated drink" }, { description: "Updated description" },
  { category: "seasonal" }, { sortOrder: 5 }, { priceCents: 1500 },
  { isAvailable: false }, { isPublished: false }, { isPublished: true },
];

async function prepareGeneration() {
  const taskId = randomUUID();
  const cleanedPhotoPath = "/objects/uploads/22222222-2222-4222-8222-222222222222";
  uploadArtwork();
  uploadArtwork(cleanedPhotoPath);
  await db.update(schema.drinksTable).set({
    sourcePhotoUrl: artworkPath, cleanedPhotoUrl: cleanedPhotoPath,
    modelGlbUrl: "/objects/models/previous.glb", modelUsdzUrl: "/objects/models/previous.usdz",
    generationStatus: "ready",
  }).where(eq(schema.drinksTable.id, "fixture-drink"));
  vi.stubEnv("MESHY_API_KEY", "meshy-regression-fixture-key");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ result: taskId }), { status: 200 }),
  );
  return { body: { sourcePhotoPath: artworkPath, cleanedPhotoPath }, fetchMock, taskId };
}

const endpoints = ["menu-version", "menu", "table-cards", "events"] as const;
function iosRequest(endpoint: typeof endpoints[number], key?: string) {
  const path = `/api/v1/bars/demo-bar/${endpoint}`;
  const req = endpoint === "events" ? request(app).post(path).send({ drinkId: "fixture-drink", eventType: "view" }) : request(app).get(path);
  return key === undefined ? req : req.set("x-api-key", key);
}
function event(body: Record<string, unknown>, slug = "demo-bar") {
  return request(app).post(`/api/v1/bars/${slug}/events`).set("x-api-key", iosKey).send(body);
}

async function rejectVersionWrites() {
  await client.exec(`
    CREATE FUNCTION reject_menu_version_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'injected menu version failure'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_menu_version_write BEFORE INSERT OR UPDATE ON menu_version
      FOR EACH ROW EXECUTE FUNCTION reject_menu_version_write();
  `);
}

async function allowVersionWrites() {
  await client.exec("DROP TRIGGER reject_menu_version_write ON menu_version; DROP FUNCTION reject_menu_version_write();");
}

describe("iOS key protection and sync", () => {
  it.each(endpoints)("protects %s against absent, wrong-length, and same-length incorrect keys", async (endpoint) => {
    for (const key of [undefined, "wrong", "x".repeat(iosKey.length)]) {
      await iosRequest(endpoint, key).expect(401, { error: "Invalid API key." });
    }
    expect(storage.getObjectEntityDownloadURL).not.toHaveBeenCalled();
    expect(await db.select().from(schema.arEventsTable)).toEqual([]);
  });

  it.each(endpoints)("fails closed on %s when the server key is unconfigured", async (endpoint) => {
    vi.stubEnv("IOS_API_KEY", "");
    await iosRequest(endpoint, iosKey).expect(503);
  });

  it.each(endpoints)("accepts the fixture key for %s", async (endpoint) => {
    const response = await iosRequest(endpoint, iosKey).expect(endpoint === "events" ? 201 : 200);
    if (endpoint === "menu-version") expectResponseContract("getPublicMenuVersion", 200, response.body);
    if (endpoint === "menu") expectResponseContract("getPublicMenu", 200, response.body);
    if (endpoint === "table-cards") expectResponseContract("getPublicTableCards", 200, response.body);
  });

  it("returns the documented populated menu with numeric cents, string prices, dates, and nullable assets", async () => {
    await db.update(schema.barsTable).set({ logoUrl: "https://assets.example.test/logo.png" })
      .where(eq(schema.barsTable.id, "argraphics-demo-bar"));
    await db.update(schema.drinksTable).set({
      description: "Fixture description", priceCents: 1250, category: "seasonal",
      thumbnailUrl: "/public-objects/drink.png",
      modelUsdzUrl: "/objects/models/drink.usdz", modelGlbUrl: "/objects/models/drink.glb",
      updatedAt: new Date("2026-10-14T12:00:00.000Z"),
    }).where(eq(schema.drinksTable.id, "fixture-drink"));
    await db.insert(schema.drinksTable).values({
      id: "nullable-assets", barId: "argraphics-demo-bar", name: "No assets", isPublished: true,
    });
    const response = await iosGet("demo-bar/menu").set("Host", "fixture.example.test").expect(200);
    expectResponseContract("getPublicMenu", 200, response.body);
    expect(response.body.logoUrl).toBe("https://assets.example.test/logo.png");
    expect(response.body.drinks).toHaveLength(2);
    expect(response.body.drinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fixture-drink", description: "Fixture description", price: "$12.50", priceCents: 1250,
        category: "seasonal", thumbnailUrl: "http://fixture.example.test/api/storage/public-objects/drink.png",
        modelUsdzUrl: "http://fixture.example.test/api/storage/public-objects/objects/models/drink.usdz",
        modelGlbUrl: "http://fixture.example.test/api/storage/public-objects/objects/models/drink.glb",
        updatedAt: "2026-10-14T12:00:00.000Z",
      }),
      expect.objectContaining({
        id: "nullable-assets", thumbnailUrl: null, modelUsdzUrl: null, modelGlbUrl: null,
      }),
    ]));
  });

  it("returns the documented empty menu with an explicit null logo", async () => {
    await db.delete(schema.drinksTable).where(eq(schema.drinksTable.barId, "argraphics-demo-bar"));
    const response = await iosGet("demo-bar/menu").expect(200);
    expectResponseContract("getPublicMenu", 200, response.body);
    expect(response.body).toEqual({ barName: "Fixture Bar", logoUrl: null, drinks: [] });
  });

  it("exposes signed download URLs only for active cards in the requested bar", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    await db.insert(schema.tableCardsTable).values([
      { id: "inactive", barId: "argraphics-demo-bar", name: "Inactive", referenceImageUrl: artworkPath, isActive: false },
      { id: "other-card", barId: "other-bar", name: "Other", referenceImageUrl: artworkPath },
    ]);
    const response = await iosGet("demo-bar/table-cards").expect(200);
    expectResponseContract("getPublicTableCards", 200, response.body);
    expect(response.body).toEqual([{
      id: saved.body.id, name: cardBody.name, physicalWidthCm: 12.5,
      referenceImageUrl: `https://storage.example.test/signed-download?object=${encodeURIComponent(acceptedArtworkPath)}`,
    }]);
    expect(storage.getObjectEntityDownloadURL).toHaveBeenCalledOnce();
    expect(storage.getObjectEntityDownloadURL).toHaveBeenCalledWith(acceptedArtworkPath);
  });

  it("advances only the owning bar's menu version on successful create and delete", async () => {
    const cookie = await signIn();
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    const saved = await createCard(cookie);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });

    await request(app).post("/api/table-cards").set("Cookie", cookie)
      .send({ ...cardBody, physicalWidthCm: 0 }).expect(400);
    await request(app).delete("/api/table-cards/does-not-exist").set("Cookie", cookie).expect(404);
    const other = await signIn("other@example.test");
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", other).expect(404);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });

    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await iosGet("demo-bar/menu-version").expect(200, { version: 3 });
    await iosGet("demo-bar/table-cards").expect(200, []);
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
  });

  it("creates a menu-version row when one did not previously exist", async () => {
    await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    const cookie = await signIn();
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await createCard(cookie);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    expect(await db.select().from(schema.menuVersionTable)
      .where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"))).toHaveLength(1);
  });

  it("advances the fallback version when deleting a card with no version row", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
  });

  it.each([false, true])("rolls back creation when the version write fails (missing row: %s)", async (missingRow) => {
    const cookie = await signIn();
    uploadArtwork();
    if (missingRow) await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    await rejectVersionWrites();
    try {
      await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(500);
    } finally {
      await allowVersionWrites();
    }
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    expect(objects.has(artworkPath)).toBe(true);
    expect(objects.has(acceptedArtworkPath)).toBe(false);
    expect(storage.deleteObjectEntity).toHaveBeenCalledWith(acceptedArtworkPath);
    await createCard(cookie);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
  });

  it.each([false, true])("rolls back deletion without cleaning artwork when the version write fails (missing row: %s)", async (missingRow) => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    if (missingRow) await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    const expectedVersion = missingRow ? 1 : 2;
    await rejectVersionWrites();
    try {
      await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(500);
    } finally {
      await allowVersionWrites();
    }
    expect((await db.select().from(schema.tableCardsTable)).map((card) => card.id)).toEqual([saved.body.id]);
    await iosGet("demo-bar/menu-version").expect(200, { version: expectedVersion });
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    expect(objects.has(acceptedArtworkPath)).toBe(true);
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await iosGet("demo-bar/menu-version").expect(200, { version: expectedVersion + 1 });
  });

  it("rolls back a saved-card edit when the version write fails", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    await rejectVersionWrites();
    try {
      await request(app).patch(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie)
        .send({ name: "Updated table", isActive: false }).expect(500);
    } finally {
      await allowVersionWrites();
    }
    expect(await db.select().from(schema.tableCardsTable)).toHaveLength(1);
    expect((await db.select().from(schema.tableCardsTable))[0]).toMatchObject({ name: cardBody.name, isActive: true });
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
  });

  it("keeps committed deletion and menu version when artwork cleanup fails", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    vi.mocked(storage.deleteObjectEntity).mockRejectedValueOnce(new Error("storage unavailable"));
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await iosGet("demo-bar/table-cards").expect(200, []);
    await iosGet("demo-bar/menu-version").expect(200, { version: 3 });
    expect(objects.has(acceptedArtworkPath)).toBe(true);
  });

  it.each(drinkEdits)("commits published drink edit %j with only its owner's version", async (body) => {
    const cookie = await signIn();
    await db.update(schema.drinksTable).set({ modelGlbUrl: "/objects/models/previous.glb" })
      .where(eq(schema.drinksTable.id, "fixture-drink"));
    await request(app).patch("/api/drinks/fixture-drink").set("Cookie", cookie).send(body).expect(200);
    expect((await db.select().from(schema.drinksTable)
      .where(eq(schema.drinksTable.id, "fixture-drink")))[0]).toMatchObject(body);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
  });

  it.each([false, true])("rolls back all published drink edits on version failure (missing row: %s)", async (missingRow) => {
    const cookie = await signIn();
    await db.update(schema.drinksTable).set({ modelGlbUrl: "/objects/models/previous.glb" })
      .where(eq(schema.drinksTable.id, "fixture-drink"));
    if (missingRow) await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    const before = await db.select().from(schema.drinksTable);
    const menuBefore = (await iosGet("demo-bar/menu").set("Host", "fixture.example.test").expect(200)).body;
    await rejectVersionWrites();
    try {
      for (const body of drinkEdits) {
        await request(app).patch("/api/drinks/fixture-drink").set("Cookie", cookie).send(body).expect(500);
        expect(await db.select().from(schema.drinksTable)).toEqual(before);
      }
    } finally {
      await allowVersionWrites();
    }
    expect((await iosGet("demo-bar/menu").set("Host", "fixture.example.test").expect(200)).body).toEqual(menuBefore);
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
    await request(app).patch("/api/drinks/fixture-drink").set("Cookie", cookie)
      .send({ name: "Retry saved" }).expect(200);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
  });

  it.each([false, true])("rolls back drink deletion on version failure and allows retry (missing row: %s)", async (missingRow) => {
    const cookie = await signIn();
    if (missingRow) await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    const before = await db.select().from(schema.drinksTable);
    await rejectVersionWrites();
    try {
      await request(app).delete("/api/drinks/fixture-drink").set("Cookie", cookie).expect(500);
    } finally {
      await allowVersionWrites();
    }
    expect(await db.select().from(schema.drinksTable)).toEqual(before);
    expect((await iosGet("demo-bar/menu").expect(200)).body.drinks.map((drink: { id: string }) => drink.id))
      .toEqual(["fixture-drink"]);
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await request(app).delete("/api/drinks/fixture-drink").set("Cookie", cookie)
      .expect(200, { message: "Drink deleted." });
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    expect((await iosGet("demo-bar/menu").expect(200)).body.drinks).toEqual([]);
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
  });

  it.each([false, true])("keeps a published drink visible when regeneration's version write fails (missing row: %s)", async (missingRow) => {
    const cookie = await signIn();
    const { body, fetchMock, taskId } = await prepareGeneration();
    if (missingRow) await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    await rejectVersionWrites();
    try {
      const response = await request(app).post("/api/drinks/fixture-drink/generation")
        .set("Cookie", cookie).send(body).expect(502);
      expect(response.body.error).toContain("menu_version");
    } finally {
      await allowVersionWrites();
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
    expect((await db.select().from(schema.drinksTable)
      .where(eq(schema.drinksTable.id, "fixture-drink")))[0]).toMatchObject({
      isPublished: true, meshyTaskId: null, generationStatus: "failed",
      modelGlbUrl: "/objects/models/previous.glb", modelUsdzUrl: "/objects/models/previous.usdz",
    });
    const menu = (await iosGet("demo-bar/menu").expect(200)).body;
    expect(menu.drinks).toHaveLength(1);
    expect(menu.drinks[0].id).toBe("fixture-drink");
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send(body).expect(200);
    expect(delay).toHaveBeenCalledOnce();
    expect((await db.select().from(schema.drinksTable)
      .where(eq(schema.drinksTable.id, "fixture-drink")))[0]).toMatchObject({
      isPublished: false, meshyTaskId: taskId, generationStatus: "processing",
    });
    expect((await iosGet("demo-bar/menu").expect(200)).body.drinks).toEqual([]);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
  });

  it("preserves missing and foreign drink responses without changing versions", async () => {
    const cookie = await signIn();
    for (const id of ["missing-drink", "other-drink"]) {
      await request(app).patch(`/api/drinks/${id}`).set("Cookie", cookie)
        .send({ name: "Not allowed" }).expect(404, { error: "Item not found." });
      await request(app).delete(`/api/drinks/${id}`).set("Cookie", cookie)
        .expect(404, { error: "Item not found." });
      await request(app).post(`/api/drinks/${id}/generation`).set("Cookie", cookie)
        .send({ sourcePhotoPath: artworkPath, cleanedPhotoPath: artworkPath })
        .expect(404, { error: "Item not found." });
    }
    await request(app).patch("/api/drinks/fixture-drink").set("Cookie", cookie)
      .send({ isPublished: true }).expect(400, { error: "Generate a 3D preview before publishing this drink." });
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await iosGet("other-bar/menu-version").expect(200, { version: 1 });
  });

  it("does not require a version write for editing or regenerating an unpublished draft", async () => {
    const cookie = await signIn();
    const { body } = await prepareGeneration();
    await db.update(schema.drinksTable).set({ isPublished: false })
      .where(eq(schema.drinksTable.id, "fixture-drink"));
    await rejectVersionWrites();
    try {
      await request(app).patch("/api/drinks/fixture-drink").set("Cookie", cookie)
        .send({ name: "Draft edit" }).expect(200);
      await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send(body).expect(200);
    } finally {
      await allowVersionWrites();
    }
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
  });

  it.each(["view", "ar_open", "ar_close"])("records a valid %s event under the selected bar", async (eventType) => {
    await event({ drinkId: "fixture-drink", eventType }).expect(201, { message: "Event recorded." });
    const rows = await db.select().from(schema.arEventsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ barId: "argraphics-demo-bar", drinkId: "fixture-drink", eventType });
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
  });

  it.each([
    {}, { drinkId: "fixture-drink" }, { eventType: "view" },
    { drinkId: "", eventType: "view" }, { drinkId: "x".repeat(129), eventType: "view" },
    { drinkId: 123, eventType: "view" }, { drinkId: "fixture-drink", eventType: "purchase" },
  ])("rejects invalid event input %j without writing", async (body) => {
    await event(body).expect(400);
    expect(await db.select().from(schema.arEventsTable)).toEqual([]);
  });

  it("rejects missing bars, missing drinks, and drinks belonging to a different bar", async () => {
    await event({ drinkId: "fixture-drink", eventType: "view" }, "missing-bar").expect(404);
    for (const drinkId of ["missing-drink", "other-drink"]) {
      await event({ drinkId, eventType: "view" }).expect(404);
    }
    expect(await db.select().from(schema.arEventsTable)).toEqual([]);
    for (const path of ["menu-version", "menu", "table-cards"]) {
      await iosGet(`missing-bar/${path}`).expect(404);
    }
  });

  it("allows 120 shared requests per IP, rejects the next, isolates IPs, and resets after a minute", async () => {
    for (let i = 0; i < 120; i++) {
      await iosGet(`demo-bar/${endpoints[i % 3]}`).expect(200);
    }
    const limited = await event({ drinkId: "fixture-drink", eventType: "view" })
      .set("X-Forwarded-For", "192.0.2.1").expect(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(await db.select().from(schema.arEventsTable)).toEqual([]);
    await iosGet("demo-bar/menu-version", "192.0.2.2").expect(200);
    await request(app).get("/api/table-cards").set("Cookie", await signIn())
      .set("X-Forwarded-For", "192.0.2.1").expect(200);

    const now = Date.now();
    vi.mocked(Date.now).mockReturnValue(now + 59_001);
    const stillLimited = await iosGet("demo-bar/menu-version").expect(429);
    expect(stillLimited.headers["retry-after"]).toBe("1");
    vi.mocked(Date.now).mockReturnValue(now + 60_000);
    await iosGet("demo-bar/menu-version").expect(200);
  });

  it("counts invalid-key attempts toward the limit rather than allowing unlimited retries", async () => {
    for (let i = 0; i < 120; i++) {
      await request(app).get("/api/v1/bars/demo-bar/menu-version")
        .set("X-Forwarded-For", "192.0.2.10").expect(401);
    }
    await iosGet("demo-bar/menu-version", "192.0.2.10").expect(429);
  });

  it("allows CORS preflight for the iOS key header", async () => {
    const response = await request(app).options("/api/v1/bars/demo-bar/events")
      .set("Origin", "https://client.example.test")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-api-key").expect(204);
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("x-api-key");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });
});
