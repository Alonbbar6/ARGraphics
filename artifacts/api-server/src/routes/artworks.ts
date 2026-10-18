import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  CreateArtworkBody, CreateArtworkResponse, DeleteArtworkResponse, ListArtworksResponse,
  ListGalleryQueryParams, ListGalleryResponse, ListLicensesResponse, RequestArtworkLicenseBody,
  RequestArtworkLicenseResponse, RequestModelUploadUrlBody, RequestModelUploadUrlResponse,
  UpdateArtworkBody, UpdateArtworkResponse, UpdateLicenseBody, UpdateLicenseResponse,
} from "@workspace/api-zod";
import { artworkLicensesTable, artworksTable, barsTable, db, displaysTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { InvalidArtworkError, MAX_ARTWORK_BYTES, validateRasterImage } from "../lib/tableCardArtwork";
import { MAX_MODEL_BYTES, MODEL_TYPES, validateGlb, validateUsdz } from "../lib/artworkFiles";
import { currentUser, isUniqueViolation } from "./argraphics";

/*
 * Artists' own work, and the licences venues take to show it.
 *
 * Nothing on this path touches the photo-to-3D pipeline: artworks are uploaded files, the
 * artist attests they made them, and the platform never generates or alters them. A licence
 * is the record of a venue's request, the artist's answer, the agreed fee and whether it has
 * been paid. Accepting one creates a draft display in the venue's room, tied to the artwork.
 */

const router: IRouter = Router();
const storage = new ObjectStorageService();

type Bar = typeof barsTable.$inferSelect;
type ArtworkRow = typeof artworksTable.$inferSelect;
type LicenseRow = typeof artworkLicensesTable.$inferSelect;
type Medium = "image" | "model";
type LicenseStatus = "requested" | "accepted" | "declined" | "ended";

async function partner(req: Request, res: Response): Promise<Bar | null> {
  const user = await currentUser(req);
  const [bar] = user ? await db.select().from(barsTable).where(eq(barsTable.id, user.barId)).limit(1) : [];
  if (!bar) {
    res.status(401).json({ error: "Sign in first." });
    return null;
  }
  return bar;
}

const mediaUrl = (artwork: Pick<ArtworkRow, "id">, kind: "image" | "glb" | "usdz") => `/api/artworks/${artwork.id}/media/${kind}`;

function summary(bar: Bar) {
  return { slug: bar.slug, name: bar.name, neighborhood: bar.neighborhood, bio: bar.bio };
}

async function serializeArtworks(rows: ArtworkRow[]) {
  if (rows.length === 0) return [];
  const counts = await db.select({
    artworkId: artworkLicensesTable.artworkId,
    status: artworkLicensesTable.status,
    count: sql<number>`count(*)::int`,
  }).from(artworkLicensesTable)
    .where(inArray(artworkLicensesTable.artworkId, rows.map((row) => row.id)))
    .groupBy(artworkLicensesTable.artworkId, artworkLicensesTable.status);
  const tally = (id: string, status: LicenseStatus) =>
    Number(counts.find((row) => row.artworkId === id && row.status === status)?.count ?? 0);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    medium: row.medium as Medium,
    imageUrl: mediaUrl(row, "image"),
    modelGlbUrl: row.modelGlbPath ? mediaUrl(row, "glb") : null,
    modelUsdzUrl: row.modelUsdzPath ? mediaUrl(row, "usdz") : null,
    realHeightCm: row.realHeightCm,
    priceCents: row.priceCents,
    licenseNote: row.licenseNote,
    status: row.status as "listed" | "hidden",
    originalWorkAttestedAt: row.originalWorkAttestedAt,
    licensedVenues: tally(row.id, "accepted"),
    pendingRequests: tally(row.id, "requested"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function serializeLicenses(rows: LicenseRow[]) {
  if (rows.length === 0) return [];
  const artworkIds = [...new Set(rows.map((row) => row.artworkId))];
  const barIds = [...new Set(rows.flatMap((row) => [row.artistBarId, row.venueBarId]))];
  const displayIds = rows.map((row) => row.displayId).filter((id): id is string => Boolean(id));
  const [artworks, bars, displays] = await Promise.all([
    db.select().from(artworksTable).where(inArray(artworksTable.id, artworkIds)),
    db.select().from(barsTable).where(inArray(barsTable.id, barIds)),
    displayIds.length
      ? db.select({ id: displaysTable.id, status: displaysTable.status }).from(displaysTable).where(inArray(displaysTable.id, displayIds))
      : Promise.resolve([] as { id: string; status: string }[]),
  ]);
  return rows.flatMap((row) => {
    const artwork = artworks.find((item) => item.id === row.artworkId);
    const artist = bars.find((bar) => bar.id === row.artistBarId);
    const venue = bars.find((bar) => bar.id === row.venueBarId);
    if (!artwork || !artist || !venue) return [];
    const display = displays.find((item) => item.id === row.displayId);
    return [{
      id: row.id,
      status: row.status as LicenseStatus,
      artworkId: artwork.id,
      artworkTitle: artwork.title,
      artworkImageUrl: mediaUrl(artwork, "image"),
      medium: artwork.medium as Medium,
      artist: summary(artist),
      venue: summary(venue),
      priceCents: row.priceCents,
      message: row.message,
      reply: row.reply,
      displayId: display?.id ?? null,
      displayStatus: (display?.status as "draft" | "live" | "paused" | undefined) ?? null,
      requestedAt: row.requestedAt,
      respondedAt: row.respondedAt,
      paidAt: row.paidAt,
    }];
  });
}

async function removeObject(objectPath: string | null | undefined) {
  if (!objectPath) return;
  try { await storage.deleteObjectEntity(objectPath); } catch { /* an orphan costs storage, never correctness */ }
}

/** Copies a staged upload into an accepted object and validates that copy. */
async function accept(objectPath: string, validate: (file: Parameters<typeof validateGlb>[0]) => Promise<void>) {
  const snapshot = await storage.createObjectEntitySnapshot(objectPath);
  try {
    await validate(snapshot.file);
  } catch (error) {
    await removeObject(snapshot.objectPath);
    throw error;
  }
  return snapshot.objectPath;
}

function sendArtworkError(req: Request, res: Response, error: unknown, action: string) {
  if (error instanceof InvalidArtworkError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ObjectNotFoundError) {
    res.status(400).json({ error: "Upload the files before saving the work." });
    return;
  }
  req.log.error({ err: error }, `Could not ${action} artwork`);
  res.status(500).json({ error: `Could not ${action} the work.` });
}

/* ---------------------------------------------------------------- uploads */

router.post("/storage/model-uploads/request-url", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = RequestModelUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !(MODEL_TYPES as readonly string[]).includes(parsed.data.contentType) || parsed.data.size > MAX_MODEL_BYTES) {
    res.status(400).json({ error: "Upload a .glb or .usdz model up to 30 MB." });
    return;
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json(RequestModelUploadUrlResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create model upload URL");
    res.status(500).json({ error: "Could not start the model upload." });
  }
});

/* --------------------------------------------------------------- artworks */

router.get("/artworks", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select().from(artworksTable)
    .where(eq(artworksTable.artistBarId, bar.id)).orderBy(desc(artworksTable.createdAt));
  res.json(ListArtworksResponse.parse(await serializeArtworks(rows)));
});

router.post("/artworks", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  if (bar.kind !== "artist") {
    res.status(403).json({ error: "Only artist accounts list works. Venues license them from the gallery." });
    return;
  }
  const parsed = CreateArtworkBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Give the work a title, a preview image and confirm it is your own." });
    return;
  }
  const input = parsed.data;
  if (input.originalWork !== true) {
    res.status(400).json({ error: "Confirm this is your own work. ARGraphics does not list AI-generated pieces." });
    return;
  }
  if (input.medium === "model" && !input.modelGlbObjectPath) {
    res.status(400).json({ error: "Upload your 3D model as a .glb file." });
    return;
  }
  const accepted: string[] = [];
  let committed = false;
  try {
    const mediaPath = await accept(input.imageObjectPath, (file) => validateRasterImage(file, {
      subject: "preview image", maxBytes: MAX_ARTWORK_BYTES, limitLabel: "10 MB", stillImageLabel: "artwork",
    }));
    accepted.push(mediaPath);
    const modelGlbPath = input.medium === "model" && input.modelGlbObjectPath ? await accept(input.modelGlbObjectPath, validateGlb) : null;
    if (modelGlbPath) accepted.push(modelGlbPath);
    const modelUsdzPath = input.medium === "model" && input.modelUsdzObjectPath ? await accept(input.modelUsdzObjectPath, validateUsdz) : null;
    if (modelUsdzPath) accepted.push(modelUsdzPath);
    const [created] = await db.insert(artworksTable).values({
      id: randomUUID(),
      artistBarId: bar.id,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      medium: input.medium,
      mediaPath,
      modelGlbPath,
      modelUsdzPath,
      realHeightCm: input.medium === "model" ? input.realHeightCm ?? null : null,
      priceCents: input.priceCents ?? 0,
      licenseNote: input.licenseNote?.trim() ?? "",
      status: input.status ?? "listed",
      originalWorkAttestedAt: new Date(Date.now()),
    }).returning();
    committed = true;
    const [artwork] = await serializeArtworks([created]);
    res.status(201).json(CreateArtworkResponse.parse(artwork));
  } catch (error) {
    sendArtworkError(req, res, error, "save");
  } finally {
    if (!committed) await Promise.all(accepted.map(removeObject));
  }
});

async function ownedArtwork(barId: string, id: string) {
  const [row] = await db.select().from(artworksTable)
    .where(and(eq(artworksTable.id, id), eq(artworksTable.artistBarId, barId))).limit(1);
  return row;
}

router.patch("/artworks/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = UpdateArtworkBody.strict().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Enter valid work details." });
    return;
  }
  const existing = await ownedArtwork(bar.id, String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Work not found." });
    return;
  }
  const data = parsed.data;
  const [updated] = await db.update(artworksTable).set({
    ...(data.title !== undefined ? { title: data.title.trim() } : {}),
    ...(data.description !== undefined ? { description: data.description.trim() } : {}),
    ...(data.realHeightCm !== undefined ? { realHeightCm: existing.medium === "model" ? data.realHeightCm : null } : {}),
    ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
    ...(data.licenseNote !== undefined ? { licenseNote: data.licenseNote.trim() } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    updatedAt: new Date(Date.now()),
  }).where(eq(artworksTable.id, existing.id)).returning();
  const [artwork] = await serializeArtworks([updated]);
  res.json(UpdateArtworkResponse.parse(artwork));
});

router.delete("/artworks/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const existing = await ownedArtwork(bar.id, String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Work not found." });
    return;
  }
  const [active] = await db.select({ id: artworkLicensesTable.id }).from(artworkLicensesTable)
    .where(and(eq(artworkLicensesTable.artworkId, existing.id), eq(artworkLicensesTable.status, "accepted"))).limit(1);
  if (active) {
    res.status(409).json({ error: "Venues are showing this piece. End those licences first, then remove it." });
    return;
  }
  await db.delete(artworksTable).where(eq(artworksTable.id, existing.id));
  await Promise.all([existing.mediaPath, existing.modelGlbPath, existing.modelUsdzPath].map(removeObject));
  res.json(DeleteArtworkResponse.parse({ message: "Work removed." }));
});

/* ------------------------------------------------------------------ media */

router.get("/artworks/:id/media/:kind", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const kind = String(req.params.kind);
  const [artwork] = await db.select().from(artworksTable).where(eq(artworksTable.id, String(req.params.id))).limit(1);
  if (!artwork || !["image", "glb", "usdz"].includes(kind)) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  // The artist always; any signed-in partner while it is listed; a venue that holds or asked for a licence.
  let allowed = artwork.artistBarId === bar.id || artwork.status === "listed";
  if (!allowed) {
    const [license] = await db.select({ id: artworkLicensesTable.id }).from(artworkLicensesTable)
      .where(and(eq(artworkLicensesTable.artworkId, artwork.id), eq(artworkLicensesTable.venueBarId, bar.id))).limit(1);
    allowed = Boolean(license);
  }
  const objectPath = kind === "image" ? artwork.mediaPath : kind === "glb" ? artwork.modelGlbPath : artwork.modelUsdzPath;
  if (!allowed || !objectPath) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    file.createReadStream().on("error", (error: unknown) => {
      req.log.error({ err: error }, "Could not stream artwork");
      if (!res.headersSent) res.status(500);
      res.end();
    }).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    req.log.error({ err: error }, "Could not load artwork");
    res.status(500).json({ error: "Could not load the file." });
  }
});

/* ---------------------------------------------------------------- gallery */

router.get("/gallery", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const query = ListGalleryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Search with fewer than 80 characters." });
    return;
  }
  const term = (query.data.q ?? "").trim().replace(/[\\%_]/g, (match) => `\\${match}`);
  const rows = await db.select({ artwork: artworksTable, artist: barsTable }).from(artworksTable)
    .innerJoin(barsTable, eq(barsTable.id, artworksTable.artistBarId))
    .where(and(
      eq(artworksTable.status, "listed"),
      term ? or(ilike(artworksTable.title, `%${term}%`), ilike(barsTable.name, `%${term}%`)) : undefined,
    ))
    .orderBy(desc(artworksTable.createdAt)).limit(120);
  const licenses = rows.length
    ? await db.select().from(artworkLicensesTable).where(and(
      eq(artworkLicensesTable.venueBarId, bar.id),
      inArray(artworkLicensesTable.artworkId, rows.map((row) => row.artwork.id)),
    ))
    : [];
  res.json(ListGalleryResponse.parse(rows.map(({ artwork, artist }) => {
    const license = licenses.find((row) => row.artworkId === artwork.id);
    return {
      id: artwork.id,
      title: artwork.title,
      description: artwork.description,
      medium: artwork.medium as Medium,
      imageUrl: mediaUrl(artwork, "image"),
      modelGlbUrl: artwork.modelGlbPath ? mediaUrl(artwork, "glb") : null,
      realHeightCm: artwork.realHeightCm,
      priceCents: artwork.priceCents,
      licenseNote: artwork.licenseNote,
      artist: summary(artist),
      license: license ? { id: license.id, status: license.status as LicenseStatus, displayId: license.displayId } : null,
    };
  })));
});

/* --------------------------------------------------------------- licences */

router.post("/artworks/:id/license-requests", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  if (bar.kind === "artist") {
    res.status(403).json({ error: "Venues request licences. Your own work is already yours to show." });
    return;
  }
  const parsed = RequestArtworkLicenseBody.strict().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Keep your note under 600 characters." });
    return;
  }
  const [artwork] = await db.select().from(artworksTable)
    .where(and(eq(artworksTable.id, String(req.params.id)), eq(artworksTable.status, "listed"))).limit(1);
  if (!artwork) {
    res.status(404).json({ error: "That piece isn't available right now." });
    return;
  }
  const values = {
    status: "requested" as const,
    priceCents: artwork.priceCents,
    message: parsed.data.message?.trim() ?? "",
    reply: "",
    displayId: null,
    requestedAt: new Date(Date.now()),
    respondedAt: null,
    paidAt: null,
  };
  const [existing] = await db.select().from(artworkLicensesTable).where(and(
    eq(artworkLicensesTable.artworkId, artwork.id), eq(artworkLicensesTable.venueBarId, bar.id),
  )).limit(1);
  if (existing && (existing.status === "requested" || existing.status === "accepted")) {
    res.status(409).json({ error: existing.status === "accepted" ? "You already have this piece." : "Your request is with the artist." });
    return;
  }
  try {
    const [row] = existing
      ? await db.update(artworkLicensesTable).set(values).where(eq(artworkLicensesTable.id, existing.id)).returning()
      : await db.insert(artworkLicensesTable).values({
        id: randomUUID(), artworkId: artwork.id, artistBarId: artwork.artistBarId, venueBarId: bar.id, ...values,
      }).returning();
    const [license] = await serializeLicenses([row]);
    res.status(201).json(RequestArtworkLicenseResponse.parse(license));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Your request is with the artist." });
      return;
    }
    throw error;
  }
});

router.get("/licenses", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select().from(artworkLicensesTable)
    .where(or(eq(artworkLicensesTable.artistBarId, bar.id), eq(artworkLicensesTable.venueBarId, bar.id)))
    .orderBy(desc(artworkLicensesTable.requestedAt));
  res.json(ListLicensesResponse.parse(await serializeLicenses(rows)));
});

/** Accepting a licence puts a draft in the venue's room, ready to place and publish. */
async function draftDisplayFor(license: LicenseRow, artwork: ArtworkRow, artist: Bar) {
  const [display] = await db.insert(displaysTable).values({
    id: randomUUID(),
    barId: license.venueBarId,
    type: "art_piece",
    placement: artwork.medium === "model" ? "table" : "wall",
    status: "draft",
    title: artwork.title,
    description: artwork.description,
    artistBarId: artist.id,
    artworkId: artwork.id,
  }).returning();
  return display;
}

router.patch("/licenses/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = UpdateLicenseBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose accept, decline, mark_paid or end." });
    return;
  }
  const [license] = await db.select().from(artworkLicensesTable).where(eq(artworkLicensesTable.id, String(req.params.id))).limit(1);
  if (!license || (license.artistBarId !== bar.id && license.venueBarId !== bar.id)) {
    res.status(404).json({ error: "Licence not found." });
    return;
  }
  const { action } = parsed.data;
  const isArtist = license.artistBarId === bar.id;
  if ((action === "accept" || action === "decline" || action === "mark_paid") && !isArtist) {
    res.status(403).json({ error: "Only the artist can answer a request or record a payment." });
    return;
  }
  const now = new Date(Date.now());
  const reply = parsed.data.reply?.trim();
  let updated: LicenseRow | undefined;
  if (action === "accept" || action === "decline") {
    if (license.status !== "requested") {
      res.status(400).json({ error: "This request has already been answered." });
      return;
    }
    const [artwork] = await db.select().from(artworksTable).where(eq(artworksTable.id, license.artworkId)).limit(1);
    if (!artwork) {
      res.status(404).json({ error: "The work no longer exists." });
      return;
    }
    const display = action === "accept" ? await draftDisplayFor(license, artwork, bar) : null;
    [updated] = await db.update(artworkLicensesTable).set({
      status: action === "accept" ? "accepted" : "declined",
      reply: reply ?? "",
      respondedAt: now,
      displayId: display?.id ?? null,
    }).where(eq(artworkLicensesTable.id, license.id)).returning();
  } else if (action === "mark_paid") {
    if (license.status !== "accepted" && license.status !== "ended") {
      res.status(400).json({ error: "Only an accepted licence can be marked paid." });
      return;
    }
    [updated] = await db.update(artworkLicensesTable).set({ paidAt: license.paidAt ?? now })
      .where(eq(artworkLicensesTable.id, license.id)).returning();
  } else {
    if (license.status !== "accepted") {
      res.status(400).json({ error: "Only an accepted licence can be ended." });
      return;
    }
    // The venue keeps its scan history; the piece just stops showing.
    if (license.displayId) {
      await db.update(displaysTable).set({ status: "paused", updatedAt: now })
        .where(and(eq(displaysTable.id, license.displayId), eq(displaysTable.artworkId, license.artworkId)));
    }
    [updated] = await db.update(artworkLicensesTable).set({
      status: "ended", respondedAt: now, ...(reply !== undefined ? { reply } : {}),
    }).where(eq(artworkLicensesTable.id, license.id)).returning();
  }
  const [serialized] = await serializeLicenses(updated ? [updated] : []);
  res.json(UpdateLicenseResponse.parse(serialized));
});

export default router;
