import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { iosKey, signIn } from "./support/requests";
import { artworkPath, objects, storage, uploadArtwork } from "./support/storage";
import { expectResponseContract } from "./support/response-contracts";

const visitor = "visitor-aaaa-bbbb-cccc-0001";
const otherVisitor = "visitor-aaaa-bbbb-cccc-0002";
let ip = 10;

/** Each guest call gets its own address so the shared iOS rate limit never interferes. */
function guest(method: "get" | "post", path: string) {
  ip += 1;
  return request(app)[method](`/api/v1/${path}`)
    .set("x-api-key", iosKey).set("X-Forwarded-For", `198.51.100.${ip % 250}`);
}

function createDisplay(cookie: string, body: Record<string, unknown>) {
  return request(app).post("/api/displays").set("Cookie", cookie)
    .send({ type: "promo_offer", placement: "table", title: "Slow Wednesday", offer: { title: "Free agua fresca" }, ...body });
}

async function placeCodes(cookie: string, body: Record<string, unknown> = {}) {
  const response = await request(app).post("/api/qr-codes").set("Cookie", cookie)
    .send({ labels: ["Table 1", "Table 2"], placement: "table", ...body }).expect(201);
  expectResponseContract("createQrCodes", 201, response.body);
  return response.body as { id: string; code: string; path: string; label: string }[];
}

describe("partner accounts", () => {
  it("registers artists, reports the partner kind and edits the profile", async () => {
    const registered = await request(app).post("/api/auth/register").send({
      name: "Ana Ruiz", barName: "Ana Ruiz Studio", email: "ana@example.test",
      password: "artist-password-1", kind: "artist",
    }).expect(201);
    expect(registered.body.partnerKind).toBe("artist");
    const cookie = (registered.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const session = await request(app).get("/api/auth/session").set("Cookie", cookie).expect(200);
    expectResponseContract("getSession", 200, session.body);
    expect(session.body.partnerKind).toBe("artist");
    const signedOut = await request(app).get("/api/auth/session").expect(200);
    expect(signedOut.body.partnerKind).toBeNull();

    const updated = await request(app).patch("/api/partner/profile").set("Cookie", cookie).send({
      bio: "  Florals on the walls of places I eat.  ", neighborhood: "Little Havana",
      latitude: 25.7655, longitude: -80.2194, timezone: "America/New_York",
    }).expect(200);
    expectResponseContract("updatePartnerProfile", 200, updated.body);
    expect(updated.body).toMatchObject({ kind: "artist", bio: "Florals on the walls of places I eat.", latitude: 25.7655 });

    for (const body of [{}, { timezone: "Mars/Olympus" }, { latitude: 10 }, { latitude: null, longitude: 4 }, { slug: "x" }, { name: " " }]) {
      await request(app).patch("/api/partner/profile").set("Cookie", cookie).send(body).expect(400);
    }
    const venue = await request(app).get("/api/partner/profile").set("Cookie", await signIn()).expect(200);
    expectResponseContract("getPartnerProfile", 200, venue.body);
    expect(venue.body).toMatchObject({ kind: "venue", slug: "demo-bar", timezone: "America/New_York" });
    await request(app).get("/api/partner/profile").expect(401);
  });
});

describe("displays", () => {
  it("enforces each display type's ingredient and keeps other partners' drinks out", async () => {
    const cookie = await signIn();
    await createDisplay(cookie, { type: "menu_item", title: "Birria tower", offer: null }).expect(400);
    await createDisplay(cookie, { type: "menu_item", drinkId: "other-drink", offer: null }).expect(400);
    await createDisplay(cookie, { offer: null }).expect(400);
    await createDisplay(cookie, { type: "event_teaser", offer: null }).expect(400);
    await createDisplay(cookie, { type: "art_piece", artistSlug: "nobody-here", offer: null }).expect(400);
    await createDisplay(cookie, { surprise: true }).expect(400);

    const menuItem = await createDisplay(cookie, {
      type: "menu_item", drinkId: "fixture-drink", title: "Birria tower", offer: null, status: "live",
    }).expect(201);
    expectResponseContract("createDisplay", 201, menuItem.body);
    expect(menuItem.body).toMatchObject({ type: "menu_item", status: "live", drink: { id: "fixture-drink" }, offer: null });

    const event = await createDisplay(cookie, {
      type: "event_teaser", offer: null, title: "Mural night", eventStartsAt: "2026-10-20T23:00:00.000Z", artistName: " Ana Ruiz ",
    }).expect(201);
    expect(event.body).toMatchObject({ status: "draft", eventStartsAt: "2026-10-20T23:00:00.000Z", artist: { name: "Ana Ruiz", slug: null } });
  });

  it("updates, pauses and deletes only the owner's displays, and accepts uploaded media", async () => {
    const cookie = await signIn();
    const other = await signIn("other@example.test");
    uploadArtwork();
    const created = await createDisplay(cookie, { mediaObjectPath: artworkPath }).expect(201);
    expect(created.body.mediaUrl).toMatch(/^\/api\/storage\/objects\//);
    expect(storage.createObjectEntitySnapshot).toHaveBeenCalledWith(artworkPath);

    await request(app).patch(`/api/displays/${created.body.id}`).set("Cookie", other).send({ title: "Mine" }).expect(404);
    await request(app).patch(`/api/displays/${created.body.id}`).set("Cookie", cookie).send({}).expect(400);
    await request(app).patch(`/api/displays/${created.body.id}`).set("Cookie", cookie).send({ offer: null }).expect(400);
    await request(app).patch(`/api/displays/${created.body.id}`).set("Cookie", cookie).send({ type: "art_piece" }).expect(400);

    const updated = await request(app).patch(`/api/displays/${created.body.id}`).set("Cookie", cookie)
      .send({ status: "paused", title: "  Quiet Tuesday  ", offer: { title: "2-for-1 tacos", details: "Before 7pm" }, mediaObjectPath: null })
      .expect(200);
    expectResponseContract("updateDisplay", 200, updated.body);
    expect(updated.body).toMatchObject({ status: "paused", title: "Quiet Tuesday", mediaUrl: null, offer: { title: "2-for-1 tacos", details: "Before 7pm" } });
    expect(storage.deleteObjectEntity).toHaveBeenCalled();

    const list = await request(app).get("/api/displays").set("Cookie", cookie).expect(200);
    expectResponseContract("listDisplays", 200, list.body);
    expect(list.body).toHaveLength(1);
    expect((await request(app).get("/api/displays").set("Cookie", other).expect(200)).body).toEqual([]);

    await request(app).delete(`/api/displays/${created.body.id}`).set("Cookie", other).expect(404);
    await request(app).delete(`/api/displays/${created.body.id}`).set("Cookie", cookie).expect(200);
    await request(app).get(`/api/displays/${created.body.id}`).set("Cookie", cookie).expect(404);
  });

  it("removes an accepted image when the display can't be saved", async () => {
    const cookie = await signIn();
    objects.set(artworkPath, { bytes: Buffer.from("not an image"), contentType: "text/plain", size: 12 });
    await createDisplay(cookie, { mediaObjectPath: artworkPath }).expect(400);
    expect(await db.select().from(schema.displaysTable)).toHaveLength(0);
    expect([...objects.keys()].filter((key) => key !== artworkPath)).toEqual([]);
  });
});

describe("QR codes and the guest flow", () => {
  it("places unique codes, resolves scans to live content and counts each scan", async () => {
    const cookie = await signIn();
    const offer = await createDisplay(cookie, { status: "live" }).expect(201);
    const draft = await createDisplay(cookie, { title: "Not ready" }).expect(201);
    const [table1, table2] = await placeCodes(cookie, { displayId: offer.body.id });
    expect(table1.code).toMatch(/^[a-z0-9]{8}$/);
    expect(table1.code).not.toBe(table2.code);
    expect(table1.path).toBe(`/s/${table1.code}`);
    await request(app).post("/api/qr-codes").set("Cookie", cookie)
      .send({ labels: ["X"], placement: "table", displayId: "missing" }).expect(400);
    await request(app).post("/api/qr-codes").set("Cookie", cookie)
      .send({ labels: Array.from({ length: 61 }, (_, i) => `T${i}`), placement: "table" }).expect(400);

    await request(app).post("/api/v1/scans").send({ code: table1.code, visitorId: visitor }).expect(401);
    await guest("post", "scans").send({ code: "BAD", visitorId: visitor }).expect(400);
    await guest("post", "scans").send({ code: "zzzzzzzz", visitorId: visitor }).expect(404);

    const scan = await guest("post", "scans").send({ code: table1.code, visitorId: visitor }).expect(200);
    expectResponseContract("createPublicScan", 200, scan.body);
    expect(scan.body).toMatchObject({
      venue: { slug: "demo-bar", name: "Fixture Bar", kind: "venue" },
      spot: { label: "Table 1", placement: "table" },
      display: { id: offer.body.id, offer: { title: "Free agua fresca" } },
    });
    expect(scan.body.displays.map((display: { id: string }) => display.id)).toEqual([offer.body.id]);

    // A code pointing at a draft shows the venue's live displays instead.
    await request(app).patch(`/api/qr-codes/${table2.id}`).set("Cookie", cookie).send({ displayId: draft.body.id }).expect(200);
    const unpointed = await guest("post", "scans").send({ code: table2.code, visitorId: otherVisitor }).expect(200);
    expect(unpointed.body.display).toBeNull();

    const rows = await db.select().from(schema.scansTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.visitorHash.length === 64 && !row.visitorHash.includes(visitor))).toBe(true);

    const codes = await request(app).get("/api/qr-codes").set("Cookie", cookie).expect(200);
    expectResponseContract("listQrCodes", 200, codes.body);
    expect(codes.body.find((code: { id: string }) => code.id === table1.id).scansThisWeek).toBe(1);

    await request(app).delete(`/api/qr-codes/${table1.id}`).set("Cookie", cookie).expect(200);
    await guest("post", "scans").send({ code: table1.code, visitorId: visitor }).expect(404);
    expect((await request(app).get("/api/qr-codes").set("Cookie", cookie)).body).toHaveLength(1);
    await request(app).patch(`/api/qr-codes/${table1.id}`).set("Cookie", cookie).send({ label: "Back" }).expect(404);
  });

  it("sends any display's 3D library model to guests at its real height, without a menu price", async () => {
    const cookie = await signIn();
    const created = await request(app).post("/api/drinks").set("Cookie", cookie)
      .send({ name: "Neon flamingo", description: "", priceCents: 900, category: "figure", realHeightCm: 30 }).expect(201);
    expect(created.body.realHeightCm).toBe(30);
    await request(app).post("/api/drinks").set("Cookie", cookie)
      .send({ name: "Too tall", description: "", priceCents: 0, category: "figure", realHeightCm: 900 }).expect(400);
    // Stand in for a finished Meshy build.
    const { eq } = await import("drizzle-orm");
    await db.update(schema.drinksTable).set({ modelUsdzUrl: "/objects/models/flamingo.usdz", modelGlbUrl: "/objects/models/flamingo.glb" })
      .where(eq(schema.drinksTable.id, created.body.id));

    const offer = await createDisplay(cookie, { status: "live", drinkId: created.body.id }).expect(201);
    const [code] = await placeCodes(cookie, { displayId: offer.body.id });
    const scan = await guest("post", "scans").send({ code: code.code, visitorId: visitor }).expect(200);
    expectResponseContract("createPublicScan", 200, scan.body);
    expect(scan.body.display).toMatchObject({
      type: "promo_offer",
      modelUsdzUrl: expect.stringMatching(/\/api\/storage\/public-objects\/objects\/models\/flamingo\.usdz$/),
      modelHeightCm: 30,
      price: null,
    });
  });

  it("claims an offer once per guest per day and refuses ended or missing offers", async () => {
    const cookie = await signIn();
    const offer = await createDisplay(cookie, { status: "live", offer: { title: "Free agua fresca", details: "With any birria tower" } }).expect(201);
    const [table] = await placeCodes(cookie, { displayId: offer.body.id });

    const first = await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: visitor, code: table.code }).expect(201);
    expectResponseContract("createPublicClaim", 201, first.body);
    expect(first.body).toMatchObject({ offerTitle: "Free agua fresca", venueName: "Fixture Bar", spotLabel: "Table 1" });
    expect(first.body.confirmationCode).toMatch(/^[A-Z]{2}-\d{4}$/);
    const validFor = Date.parse(first.body.expiresAt) - Date.parse(first.body.claimedAt);
    expect(validFor).toBe(15 * 60 * 1000);

    const again = await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: visitor }).expect(200);
    expect(again.body.confirmationCode).toBe(first.body.confirmationCode);
    await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: otherVisitor }).expect(201);

    const log = await request(app).get("/api/redemptions").set("Cookie", cookie).expect(200);
    expectResponseContract("listRedemptions", 200, log.body);
    expect(log.body).toHaveLength(2);
    expect((await request(app).get("/api/redemptions").set("Cookie", await signIn("other@example.test"))).body).toEqual([]);

    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await request(app).patch(`/api/displays/${offer.body.id}`).set("Cookie", cookie)
      .send({ offer: { title: "Last call", endsAt: soon } }).expect(200);
    const capped = await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: "visitor-aaaa-bbbb-cccc-0003" }).expect(201);
    expect(capped.body.expiresAt).toBe(soon);

    await request(app).patch(`/api/displays/${offer.body.id}`).set("Cookie", cookie)
      .send({ offer: { title: "Over", endsAt: "2020-01-01T00:00:00.000Z" } }).expect(200);
    await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: "visitor-aaaa-bbbb-cccc-0004" }).expect(410);
    const scan = await guest("post", "scans").send({ code: table.code, visitorId: visitor }).expect(200);
    expect(scan.body.display.offer).toBeNull();

    await request(app).patch(`/api/displays/${offer.body.id}`).set("Cookie", cookie).send({ status: "paused" }).expect(200);
    await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: "visitor-aaaa-bbbb-cccc-0005" }).expect(404);
    await guest("post", "displays/missing/claims").send({ visitorId: visitor }).expect(404);
    await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: "short" }).expect(400);
  });
});

describe("analytics", () => {
  it("counts scans, unique and repeat visitors and walk-ins in the partner's timezone", async () => {
    const cookie = await signIn();
    const offer = await createDisplay(cookie, { status: "live" }).expect(201);
    const [table] = await placeCodes(cookie, { displayId: offer.body.id });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const scan = (visitorHash: string, at: number) => ({
      id: `scan-${visitorHash}-${at}`, barId: "argraphics-demo-bar", qrCodeId: table.id, displayId: offer.body.id,
      visitorHash, createdAt: new Date(at),
    });
    await db.insert(schema.scansTable).values([
      scan("a", now - 1 * day), scan("a", now - 3 * day), // repeat visitor
      scan("b", now - 2 * day),
      scan("c", now - 10 * day), // previous week
      { ...scan("x", now - 1 * day), barId: "other-bar", qrCodeId: null, displayId: null },
    ]);
    await guest("post", `displays/${offer.body.id}/claims`).send({ visitorId: visitor, code: table.code }).expect(201);

    const week = await request(app).get("/api/analytics?range=week").set("Cookie", cookie).expect(200);
    expectResponseContract("getAnalytics", 200, week.body);
    expect(week.body.totals).toEqual({ scans: 3, uniqueVisitors: 2, repeatVisitors: 1, redemptions: 1 });
    expect(week.body.previous).toEqual({ scans: 1, uniqueVisitors: 1, repeatVisitors: 0, redemptions: 0 });
    expect(week.body.series.length).toBeGreaterThanOrEqual(7);
    expect(week.body.series.reduce((sum: number, entry: { scans: number }) => sum + entry.scans, 0)).toBe(3);
    expect(week.body.heatmap).toHaveLength(7);
    expect(week.body.heatmap.flat().reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect(week.body.byDisplay[0]).toMatchObject({ displayId: offer.body.id, scans: 3, redemptions: 1 });
    expect(week.body.byQrCode[0]).toMatchObject({ qrCodeId: table.id, scans: 3, redemptions: 1 });

    const month = await request(app).get("/api/analytics?range=month").set("Cookie", cookie).expect(200);
    expect(month.body.totals.scans).toBe(4);
    await request(app).get("/api/analytics?range=year").set("Cookie", cookie).expect(400);
    await request(app).get("/api/analytics").expect(401);
  });
});

describe("artists, venues and nearby spots", () => {
  it("credits artist partners, lists their placements and shows them to guests", async () => {
    await db.insert(schema.barsTable).values({
      id: "artist-bar", name: "Ana Ruiz", slug: "ana-ruiz", kind: "artist", bio: "Florals after dark.",
      neighborhood: "Little Havana",
    });
    const cookie = await signIn();
    const found = await request(app).get("/api/artists?q=an%").set("Cookie", cookie).expect(200);
    expect(found.body).toEqual([]);
    const search = await request(app).get("/api/artists?q=ana").set("Cookie", cookie).expect(200);
    expectResponseContract("searchArtists", 200, search.body);
    expect(search.body).toEqual([{ slug: "ana-ruiz", name: "Ana Ruiz", neighborhood: "Little Havana" }]);

    const piece = await createDisplay(cookie, {
      type: "art_piece", placement: "wall", title: "Night Bloom", offer: null, artistSlug: "ana-ruiz", status: "live",
    }).expect(201);
    expect(piece.body.artist).toEqual({ name: "Ana Ruiz", slug: "ana-ruiz" });

    await db.insert(schema.usersTable).values({
      id: "artist-user", barId: "artist-bar", name: "Ana", email: "ana@example.test",
      passwordHash: (await db.select().from(schema.usersTable))[0].passwordHash,
    });
    const placements = await request(app).get("/api/artist/placements").set("Cookie", await signIn("ana@example.test")).expect(200);
    expectResponseContract("listArtistPlacements", 200, placements.body);
    expect(placements.body).toEqual([expect.objectContaining({ title: "Night Bloom", venueSlug: "demo-bar", status: "live" })]);

    const artist = await guest("get", "artists/ana-ruiz").expect(200);
    expectResponseContract("getPublicArtist", 200, artist.body);
    expect(artist.body.pieces).toEqual([expect.objectContaining({ title: "Night Bloom", venueName: "Fixture Bar" })]);
    await guest("get", "artists/demo-bar").expect(404);

    const venue = await guest("get", "venues/demo-bar").expect(200);
    expectResponseContract("getPublicVenue", 200, venue.body);
    expect(venue.body.displays[0].artist).toEqual({ name: "Ana Ruiz", slug: "ana-ruiz", bio: "Florals after dark." });
    await guest("get", "venues/nowhere").expect(404);
  });

  it("lists walkable partners with something live, nearest first", async () => {
    const cookie = await signIn();
    await request(app).patch("/api/partner/profile").set("Cookie", cookie).send({ latitude: 25.7655, longitude: -80.2194 }).expect(200);
    await db.insert(schema.barsTable).values([
      { id: "near", name: "La Gaviota", slug: "la-gaviota", latitude: 25.7660, longitude: -80.2200 },
      { id: "nearer-but-empty", name: "Quiet Spot", slug: "quiet-spot", latitude: 25.7656, longitude: -80.2195 },
      { id: "far", name: "Far Away", slug: "far-away", latitude: 25.90, longitude: -80.30 },
    ]);
    await db.insert(schema.displaysTable).values([
      { id: "near-live", barId: "near", type: "promo_offer", placement: "table", status: "live", title: "Taco Tuesday", offerTitle: "2-for-1" },
      { id: "far-live", barId: "far", type: "promo_offer", placement: "table", status: "live", title: "Far", offerTitle: "x" },
    ]);
    const nearby = await guest("get", "venues/demo-bar/nearby").expect(200);
    expectResponseContract("getPublicNearby", 200, nearby.body);
    expect(nearby.body).toEqual([expect.objectContaining({ slug: "la-gaviota", liveDisplays: 1, featured: "Taco Tuesday" })]);
    expect(nearby.body[0].distanceMeters).toBeGreaterThan(0);
    expect(nearby.body[0].distanceMeters).toBeLessThan(200);
    expect((await guest("get", "venues/other-bar/nearby").expect(200)).body).toEqual([]);
  });
});
