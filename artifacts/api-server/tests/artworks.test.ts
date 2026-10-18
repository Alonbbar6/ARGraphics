import request from "supertest";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { iosKey, signIn } from "./support/requests";
import { artworkBytes, artworkPath, objects, uploadArtwork } from "./support/storage";
import { expectResponseContract } from "./support/response-contracts";

const glbPath = "/objects/uploads/22222222-2222-4222-8222-222222222222";
const previewPath = "/objects/uploads/33333333-3333-4333-8333-333333333333";

/** A minimal, valid glTF 2.0 binary: header plus one padded JSON chunk. */
function glbBytes(json = '{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"scene":0}') {
  const padded = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, padded]);
}

async function registerArtist(email = "ana@example.test") {
  const registered = await request(app).post("/api/auth/register").send({
    name: "Ana Ruiz", barName: "Ana Ruiz", email, password: "artist-password-1", kind: "artist",
  }).expect(201);
  return (registered.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

function stage(path: string, bytes: Buffer, contentType: string) {
  objects.set(path, { bytes, contentType, size: bytes.length });
}

function listWork(cookie: string, body: Record<string, unknown> = {}) {
  uploadArtwork();
  return request(app).post("/api/artworks").set("Cookie", cookie).send({
    title: "Night Bloom", description: "Florals that only bloom after dark.", medium: "image",
    imageObjectPath: artworkPath, priceCents: 15000, licenseNote: "Credit on the wall.", originalWork: true, ...body,
  });
}

let ip = 40;
function guest(method: "get" | "post", path: string) {
  ip += 1;
  return request(app)[method](`/api/v1/${path}`).set("x-api-key", iosKey).set("X-Forwarded-For", `203.0.113.${ip % 250}`);
}

describe("artist works", () => {
  it("lists an artist's own 2D work only with their attestation, never for venues", async () => {
    const artist = await registerArtist();
    const refused = await listWork(artist, { originalWork: false }).expect(400);
    expect(refused.body.error).toMatch(/own work/i);

    const created = await listWork(artist).expect(201);
    expectResponseContract("createArtwork", 201, created.body);
    expect(created.body).toMatchObject({ title: "Night Bloom", medium: "image", priceCents: 15000, status: "listed", licensedVenues: 0 });
    expect(created.body.imageUrl).toBe(`/api/artworks/${created.body.id}/media/image`);
    // The raw upload is never the stored path: the server keeps its own accepted copy.
    const [row] = await db.select().from(schema.artworksTable);
    expect(row.mediaPath).toMatch(/^\/objects\/accepted-artwork\//);

    const venue = await signIn();
    const venueRefused = await listWork(venue).expect(403);
    expect(venueRefused.body.error).toMatch(/artist accounts/i);
  });

  it("accepts the artist's own GLB model after checking the container, and rejects fakes", async () => {
    const artist = await registerArtist();
    stage(previewPath, artworkBytes, "image/png");
    stage(glbPath, Buffer.from("not a model at all, just bytes!!"), "model/gltf-binary");
    const bad = await request(app).post("/api/artworks").set("Cookie", artist).send({
      title: "Lantern", medium: "model", imageObjectPath: previewPath, modelGlbObjectPath: glbPath, realHeightCm: 40, originalWork: true,
    }).expect(400);
    expect(bad.body.error).toMatch(/glb/i);
    expect(await db.select().from(schema.artworksTable)).toHaveLength(0);

    stage(previewPath, artworkBytes, "image/png");
    stage(glbPath, glbBytes(), "model/gltf-binary");
    const good = await request(app).post("/api/artworks").set("Cookie", artist).send({
      title: "Lantern", medium: "model", imageObjectPath: previewPath, modelGlbObjectPath: glbPath, realHeightCm: 40, originalWork: true,
    }).expect(201);
    expect(good.body).toMatchObject({ medium: "model", realHeightCm: 40 });
    expect(good.body.modelGlbUrl).toBe(`/api/artworks/${good.body.id}/media/glb`);
    const file = await request(app).get(good.body.modelGlbUrl).set("Cookie", artist).expect(200);
    expect(file.headers["content-type"]).toContain("model/gltf-binary");
  });

  it("requires a .glb for 3D work", async () => {
    const artist = await registerArtist();
    const response = await listWork(artist, { medium: "model" }).expect(400);
    expect(response.body.error).toMatch(/\.glb/);
  });
});

describe("licensing a piece to a venue", () => {
  async function listedWork() {
    const artist = await registerArtist();
    const created = await listWork(artist).expect(201);
    return { artist, artworkId: created.body.id as string };
  }

  it("runs request, accept, draft display, publish and guest credit end to end", async () => {
    const { artist, artworkId } = await listedWork();
    const venue = await signIn();

    const gallery = await request(app).get("/api/gallery").set("Cookie", venue).expect(200);
    expectResponseContract("listGallery", 200, gallery.body);
    expect(gallery.body).toHaveLength(1);
    expect(gallery.body[0]).toMatchObject({ id: artworkId, artist: { name: "Ana Ruiz" }, license: null });

    // A venue cannot show a piece it has not licensed.
    const unlicensed = await request(app).post("/api/displays").set("Cookie", venue)
      .send({ type: "art_piece", placement: "wall", title: "Night Bloom", artworkId }).expect(400);
    expect(unlicensed.body.error).toMatch(/licence/i);

    const requested = await request(app).post(`/api/artworks/${artworkId}/license-requests`).set("Cookie", venue)
      .send({ message: "Back wall by the bathrooms, Thursdays to Sundays." }).expect(201);
    expectResponseContract("requestArtworkLicense", 201, requested.body);
    expect(requested.body).toMatchObject({ status: "requested", priceCents: 15000, venue: { name: "Fixture Bar" } });
    await request(app).post(`/api/artworks/${artworkId}/license-requests`).set("Cookie", venue).send({}).expect(409);

    // Only the artist answers.
    await request(app).patch(`/api/licenses/${requested.body.id}`).set("Cookie", venue).send({ action: "accept" }).expect(403);
    const accepted = await request(app).patch(`/api/licenses/${requested.body.id}`).set("Cookie", artist)
      .send({ action: "accept", reply: "Love that wall." }).expect(200);
    expectResponseContract("updateLicense", 200, accepted.body);
    expect(accepted.body).toMatchObject({ status: "accepted", reply: "Love that wall.", displayStatus: "draft" });
    expect(accepted.body.displayId).toBeTruthy();

    // The draft sits in the venue's displays, tied to the artwork and credited to the artist.
    const display = await request(app).get(`/api/displays/${accepted.body.displayId}`).set("Cookie", venue).expect(200);
    expect(display.body).toMatchObject({
      type: "art_piece", status: "draft", artworkId, artist: { name: "Ana Ruiz", slug: "ana-ruiz" },
      artwork: { id: artworkId, title: "Night Bloom", medium: "image" },
      mediaUrl: `/api/artworks/${artworkId}/media/image`,
    });
    // The venue can see the file now, and could not before the request.
    await request(app).get(display.body.mediaUrl).set("Cookie", venue).expect(200);

    // The venue cannot swap the artist's image for its own.
    uploadArtwork();
    const published = await request(app).patch(`/api/displays/${accepted.body.displayId}`).set("Cookie", venue)
      .send({ status: "live", placement: "wall", mediaObjectPath: artworkPath }).expect(200);
    expect(published.body.mediaUrl).toBe(`/api/artworks/${artworkId}/media/image`);

    // Guests see the artist's piece and name.
    const [code] = (await request(app).post("/api/qr-codes").set("Cookie", venue)
      .send({ labels: ["Back wall"], placement: "wall", displayId: accepted.body.displayId }).expect(201)).body;
    const scan = await guest("post", "scans").send({ code: code.code, visitorId: "visitor-aaaa-bbbb-cccc-0101" }).expect(200);
    expect(scan.body.display).toMatchObject({ title: "Night Bloom", artist: { name: "Ana Ruiz", slug: "ana-ruiz" }, price: null });
    expect(scan.body.display.mediaUrl).toContain("signed-download");

    // Earnings: the artist records the fee, and can end the licence; the display pauses.
    const paid = await request(app).patch(`/api/licenses/${requested.body.id}`).set("Cookie", artist).send({ action: "mark_paid" }).expect(200);
    expect(paid.body.paidAt).toBeTruthy();
    const works = await request(app).get("/api/artworks").set("Cookie", artist).expect(200);
    expect(works.body[0]).toMatchObject({ licensedVenues: 1, pendingRequests: 0 });
    await request(app).delete(`/api/artworks/${artworkId}`).set("Cookie", artist).expect(409);

    const ended = await request(app).patch(`/api/licenses/${requested.body.id}`).set("Cookie", artist).send({ action: "end" }).expect(200);
    expect(ended.body.status).toBe("ended");
    const [row] = await db.select().from(schema.displaysTable).where(eq(schema.displaysTable.id, accepted.body.displayId));
    expect(row.status).toBe("paused");
    await request(app).delete(`/api/artworks/${artworkId}`).set("Cookie", artist).expect(200);
  });

  it("declines, lets the venue ask again, and keeps hidden work out of the gallery", async () => {
    const { artist, artworkId } = await listedWork();
    const venue = await signIn();
    const first = await request(app).post(`/api/artworks/${artworkId}/license-requests`).set("Cookie", venue).send({}).expect(201);
    await request(app).patch(`/api/licenses/${first.body.id}`).set("Cookie", artist).send({ action: "decline" }).expect(200);
    const again = await request(app).post(`/api/artworks/${artworkId}/license-requests`).set("Cookie", venue).send({ message: "Second try" }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body).toMatchObject({ status: "requested", message: "Second try" });

    await request(app).patch(`/api/artworks/${artworkId}`).set("Cookie", artist).send({ status: "hidden" }).expect(200);
    const gallery = await request(app).get("/api/gallery").set("Cookie", venue).expect(200);
    expect(gallery.body).toHaveLength(0);
    // A hidden piece's file stays visible to the venue that asked, and to nobody else.
    await request(app).get(`/api/artworks/${artworkId}/media/image`).set("Cookie", venue).expect(200);
    const other = await signIn("other@example.test");
    await request(app).get(`/api/artworks/${artworkId}/media/image`).set("Cookie", other).expect(404);
  });

  it("keeps artists from requesting licences and venues from editing works", async () => {
    const { artist, artworkId } = await listedWork();
    const other = await registerArtist("bo@example.test");
    await request(app).post(`/api/artworks/${artworkId}/license-requests`).set("Cookie", other).send({}).expect(403);
    await request(app).patch(`/api/artworks/${artworkId}`).set("Cookie", other).send({ priceCents: 1 }).expect(404);
    await request(app).patch(`/api/artworks/${artworkId}`).set("Cookie", artist).send({ priceCents: 20000 }).expect(200);
  });
});
