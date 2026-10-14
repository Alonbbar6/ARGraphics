import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { cardBody, createCard, iosGet, iosKey, signIn } from "./support/requests";
import { artworkPath, storage } from "./support/storage";

const endpoints = ["menu-version", "menu", "table-cards", "events"] as const;
function iosRequest(endpoint: typeof endpoints[number], key?: string) {
  const path = `/api/v1/bars/demo-bar/${endpoint}`;
  const req = endpoint === "events" ? request(app).post(path).send({ drinkId: "fixture-drink", eventType: "view" }) : request(app).get(path);
  return key === undefined ? req : req.set("x-api-key", key);
}
function event(body: Record<string, unknown>, slug = "demo-bar") {
  return request(app).post(`/api/v1/bars/${slug}/events`).set("x-api-key", iosKey).send(body);
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
    await iosRequest(endpoint, iosKey).expect(endpoint === "events" ? 201 : 200);
  });

  it("exposes signed download URLs only for active cards in the requested bar", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    await db.insert(schema.tableCardsTable).values([
      { id: "inactive", barId: "garnish-demo-bar", name: "Inactive", referenceImageUrl: artworkPath, isActive: false },
      { id: "other-card", barId: "other-bar", name: "Other", referenceImageUrl: artworkPath },
    ]);
    const response = await iosGet("demo-bar/table-cards").expect(200);
    expect(response.body).toEqual([{
      id: saved.body.id, name: cardBody.name, physicalWidthCm: 12.5,
      referenceImageUrl: `https://storage.example.test/signed-download?object=${encodeURIComponent(artworkPath)}`,
    }]);
    expect(storage.getObjectEntityDownloadURL).toHaveBeenCalledOnce();
    expect(storage.getObjectEntityDownloadURL).toHaveBeenCalledWith(artworkPath);
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
    await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "garnish-demo-bar"));
    const cookie = await signIn();
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await createCard(cookie);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    expect(await db.select().from(schema.menuVersionTable)
      .where(eq(schema.menuVersionTable.barId, "garnish-demo-bar"))).toHaveLength(1);
  });

  it("advances the fallback version when deleting a card with no version row", async () => {
    const cookie = await signIn();
    const saved = await createCard(cookie);
    await db.delete(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "garnish-demo-bar"));
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
    await request(app).delete(`/api/table-cards/${saved.body.id}`).set("Cookie", cookie).expect(200);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
  });

  it.each(["view", "ar_open", "ar_close"])("records a valid %s event under the selected bar", async (eventType) => {
    await event({ drinkId: "fixture-drink", eventType }).expect(201, { message: "Event recorded." });
    const rows = await db.select().from(schema.arEventsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ barId: "garnish-demo-bar", drinkId: "fixture-drink", eventType });
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
