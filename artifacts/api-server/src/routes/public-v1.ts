import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  CreatePublicClaimBody,
  CreatePublicClaimParams,
  CreatePublicClaimResponse,
  CreatePublicScanBody,
  CreatePublicScanResponse,
  GetPublicArtistParams,
  GetPublicArtistResponse,
  GetPublicNearbyParams,
  GetPublicNearbyResponse,
  GetPublicVenueParams,
  GetPublicVenueResponse,
} from "@workspace/api-zod";
import {
  artworksTable, barsTable, db, displaysTable, drinksTable, qrCodesTable, redemptionsTable, scansTable, tableCardsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { summarizeGlb } from "../lib/glb-quality";
import { scaledUsdz } from "../lib/usdz";
import {
  CLAIM_VALID_MS, distanceMeters, localParts, newConfirmationCode, priceLabel, safeTimeZone, visitorHash,
} from "../lib/traffic";
import { isUniqueViolation, partnerKind, publicAssetUrl, rateLimitIos, requireIosKey } from "./argraphics";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const NEARBY_METERS = 2_000;

type Bar = typeof barsTable.$inferSelect;
type DisplayRow = typeof displaysTable.$inferSelect;

router.use(["/v1/scans", "/v1/venues", "/v1/artists", "/v1/displays"], rateLimitIos);

/** Signed, short-lived URL for private media; a missing object just hides the image. */
async function signedMedia(req: Request, objectPath: string | null) {
  if (!objectPath) return null;
  try {
    return await storage.getObjectEntityDownloadURL(objectPath);
  } catch (error) {
    req.log.warn({ err: error }, "Display media is unavailable");
    return null;
  }
}

function venueSummary(bar: Bar) {
  return {
    slug: bar.slug,
    name: bar.name,
    kind: partnerKind(bar.kind) ?? "venue",
    neighborhood: bar.neighborhood,
    bio: bar.bio,
  };
}

function offerIsOpen(display: DisplayRow, now: Date) {
  return Boolean(display.offerTitle) && (!display.offerEndsAt || display.offerEndsAt > now);
}

async function publicDisplays(req: Request, rows: DisplayRow[]) {
  if (rows.length === 0) return [];
  const drinkIds = rows.map((row) => row.drinkId).filter((id): id is string => Boolean(id));
  const artistIds = rows.map((row) => row.artistBarId).filter((id): id is string => Boolean(id));
  const drinks = drinkIds.length ? await db.select().from(drinksTable).where(inArray(drinksTable.id, drinkIds)) : [];
  const artists = artistIds.length ? await db.select().from(barsTable).where(inArray(barsTable.id, artistIds)) : [];
  const artworkIds = rows.map((row) => row.artworkId).filter((id): id is string => Boolean(id));
  const artworks = artworkIds.length ? await db.select().from(artworksTable).where(inArray(artworksTable.id, artworkIds)) : [];
  const now = new Date(Date.now());
  return Promise.all(rows.map(async (row) => {
    const drink = drinks.find((item) => item.id === row.drinkId);
    const artist = artists.find((item) => item.id === row.artistBarId);
    const artwork = artworks.find((item) => item.id === row.artworkId);
    // A licensed artwork is the artist's own file, served through short-lived signed links.
    const artworkMedia = artwork ? await signedMedia(req, artwork.mediaPath) : null;
    const artworkGlb = artwork?.modelGlbPath ? await signedMedia(req, artwork.modelGlbPath) : null;
    const artworkUsdz = artwork?.modelUsdzPath ? await signedMedia(req, artwork.modelUsdzPath) : null;
    return {
      id: row.id,
      type: row.type as "menu_item" | "promo_offer" | "art_piece" | "event_teaser",
      placement: row.placement as "table" | "wall" | "window" | "poster",
      title: row.title,
      description: row.description,
      mediaUrl: artwork ? artworkMedia : await signedMedia(req, row.mediaPath),
      thumbnailUrl: artwork ? artworkMedia : drink ? publicAssetUrl(req, drink.thumbnailUrl) : null,
      modelUsdzUrl: artwork ? artworkUsdz : drink ? publicAssetUrl(req, drink.modelUsdzUrl) : null,
      modelGlbUrl: artwork ? artworkGlb : drink ? publicAssetUrl(req, drink.modelGlbUrl) : null,
      modelHeightCm: artwork ? artwork.realHeightCm : drink?.realHeightCm ?? null,
      // A library model on an art piece or event is decor, not something to order.
      price: drink && !artwork && row.type === "menu_item" && drink.priceCents > 0 ? priceLabel(drink.priceCents) : null,
      ingredients: drink && !artwork && row.type === "menu_item" && drink.description.trim() ? drink.description.trim() : null,
      // An ended offer is simply no longer shown.
      offer: offerIsOpen(row, now)
        ? { title: row.offerTitle as string, details: row.offerDetails ?? "", endsAt: row.offerEndsAt }
        : null,
      eventStartsAt: row.eventStartsAt,
      artist: artist
        ? { name: artist.name, slug: artist.slug, bio: artist.bio || null }
        : row.artistName ? { name: row.artistName, slug: null, bio: null } : null,
    };
  }));
}

async function liveDisplays(barId: string) {
  return db.select().from(displaysTable)
    .where(and(eq(displaysTable.barId, barId), eq(displaysTable.status, "live")))
    .orderBy(desc(displaysTable.updatedAt));
}

async function publicTableCards(req: Request, barId: string) {
  const cards = await db.select().from(tableCardsTable)
    .where(and(eq(tableCardsTable.barId, barId), eq(tableCardsTable.isActive, true)))
    .orderBy(asc(tableCardsTable.createdAt));
  const signed = await Promise.all(cards.map(async (card) => {
    // A card whose image is gone is left out; the rest of the venue still loads.
    const referenceImageUrl = await signedMedia(req, card.referenceImageUrl);
    if (!referenceImageUrl) return null;
    return {
      id: card.id,
      name: card.name,
      referenceImageUrl,
      physicalWidthCm: Number(card.physicalWidthMeters) * 100,
    };
  }));
  return signed.filter((card): card is NonNullable<typeof card> => card !== null);
}

function rejectInvalid(res: Response, message: string) {
  res.status(400).json({ error: message });
}

router.post("/v1/scans", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const body = CreatePublicScanBody.strict().safeParse(req.body);
  if (!body.success) return rejectInvalid(res, "Scan a valid ARGraphics code.");
  const [found] = await db.select({ code: qrCodesTable, bar: barsTable }).from(qrCodesTable)
    .innerJoin(barsTable, eq(barsTable.id, qrCodesTable.barId))
    .where(and(eq(qrCodesTable.code, body.data.code), isNull(qrCodesTable.retiredAt))).limit(1);
  if (!found) {
    res.status(404).json({ error: "This code isn't active anymore." });
    return;
  }
  const displays = await liveDisplays(found.bar.id);
  const pointed = displays.find((display) => display.id === found.code.displayId) ?? null;
  await db.insert(scansTable).values({
    id: randomUUID(),
    barId: found.bar.id,
    qrCodeId: found.code.id,
    displayId: pointed?.id ?? null,
    visitorHash: visitorHash(body.data.visitorId),
    createdAt: new Date(Date.now()),
  });
  const serialized = await publicDisplays(req, displays);
  res.json(CreatePublicScanResponse.parse({
    venue: venueSummary(found.bar),
    spot: { label: found.code.label, placement: found.code.placement },
    display: serialized.find((display) => display.id === pointed?.id) ?? null,
    displays: serialized,
    tableCards: await publicTableCards(req, found.bar.id),
  }));
});

async function barBySlug(slug: string) {
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.slug, slug)).limit(1);
  return bar;
}

router.get("/v1/venues/:slug", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicVenueParams.safeParse(req.params);
  const bar = params.success ? await barBySlug(params.data.slug) : undefined;
  if (!bar) {
    res.status(404).json({ error: "We couldn't find that spot." });
    return;
  }
  res.json(GetPublicVenueResponse.parse({
    venue: venueSummary(bar),
    displays: await publicDisplays(req, await liveDisplays(bar.id)),
    tableCards: await publicTableCards(req, bar.id),
  }));
});

router.get("/v1/venues/:slug/nearby", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicNearbyParams.safeParse(req.params);
  const bar = params.success ? await barBySlug(params.data.slug) : undefined;
  if (!bar) {
    res.status(404).json({ error: "We couldn't find that spot." });
    return;
  }
  if (bar.latitude === null || bar.longitude === null) {
    res.json(GetPublicNearbyResponse.parse([]));
    return;
  }
  const origin = { latitude: bar.latitude, longitude: bar.longitude };
  const others = await db.select().from(barsTable).where(and(
    ne(barsTable.id, bar.id), isNotNull(barsTable.latitude), isNotNull(barsTable.longitude),
  ));
  const close = others
    .map((other) => ({ other, distance: distanceMeters(origin, { latitude: other.latitude!, longitude: other.longitude! }) }))
    .filter(({ distance }) => distance <= NEARBY_METERS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  const live = close.length
    ? await db.select().from(displaysTable).where(and(
      inArray(displaysTable.barId, close.map(({ other }) => other.id)), eq(displaysTable.status, "live"),
    )).orderBy(desc(displaysTable.updatedAt))
    : [];
  res.json(GetPublicNearbyResponse.parse(close
    .map(({ other, distance }) => {
      const theirs = live.filter((display) => display.barId === other.id);
      return {
        slug: other.slug,
        name: other.name,
        kind: partnerKind(other.kind) ?? "venue",
        neighborhood: other.neighborhood,
        distanceMeters: distance,
        liveDisplays: theirs.length,
        featured: theirs[0]?.title ?? null,
        latitude: other.latitude!,
        longitude: other.longitude!,
      };
    })
    // Only send guests somewhere with something to see.
    .filter((spot) => spot.liveDisplays > 0)));
});

router.get("/v1/artists/:slug", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicArtistParams.safeParse(req.params);
  const artist = params.success ? await barBySlug(params.data.slug) : undefined;
  if (!artist || artist.kind !== "artist") {
    res.status(404).json({ error: "We couldn't find that artist." });
    return;
  }
  const rows = await db.select({ display: displaysTable, venue: barsTable }).from(displaysTable)
    .innerJoin(barsTable, eq(barsTable.id, displaysTable.barId))
    .where(and(
      eq(displaysTable.status, "live"),
      or(
        eq(displaysTable.artistBarId, artist.id),
        and(eq(displaysTable.barId, artist.id), eq(displaysTable.type, "art_piece")),
      ),
    ))
    .orderBy(desc(displaysTable.updatedAt));
  res.json(GetPublicArtistResponse.parse({
    slug: artist.slug,
    name: artist.name,
    bio: artist.bio,
    neighborhood: artist.neighborhood,
    pieces: await Promise.all(rows.map(async ({ display, venue }) => ({
      displayId: display.id,
      title: display.title,
      description: display.description,
      mediaUrl: await signedMedia(req, display.artworkId
        ? (await db.select({ mediaPath: artworksTable.mediaPath }).from(artworksTable).where(eq(artworksTable.id, display.artworkId)).limit(1))[0]?.mediaPath ?? null
        : display.mediaPath),
      venueName: venue.name,
      venueSlug: venue.slug,
      neighborhood: venue.neighborhood,
    }))),
  }));
});

/* ------------------------------------------------- USDZ at real size (iPhone AR) */

/** Reads a stored object by the path form the database keeps (public or private). */
async function storedBytes(objectPath: string): Promise<Buffer | null> {
  try {
    if (objectPath.startsWith("/public-objects/")) {
      const file = await storage.searchPublicObject(objectPath.slice("/public-objects/".length));
      if (!file) return null;
      const [bytes] = await file.download();
      return bytes;
    }
    const file = await storage.getObjectEntityFile(objectPath);
    const [bytes] = await file.download();
    return bytes;
  } catch {
    return null;
  }
}

/** Built files, keyed by model path and height. A handful of items per venue; bounded. */
const usdzCache = new Map<string, Buffer>();
const USDZ_CACHE_MAX = 24;

/**
 * The item's USDZ sized to its real height, for AR Quick Look. Chrome on iOS cannot open
 * the USDZ model-viewer builds in the page, so the guest page points iPhones here instead.
 * Public, like the model files themselves; no key, because Chrome fetches it outside the page.
 */
router.get("/v1/displays/:id/model.usdz", async (req, res): Promise<void> => {
  const params = CreatePublicClaimParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Model not found." });
    return;
  }
  const [row] = await db.select().from(displaysTable)
    .where(and(eq(displaysTable.id, params.data.id), eq(displaysTable.status, "live"))).limit(1);
  if (!row) {
    res.status(404).json({ error: "Model not found." });
    return;
  }
  let usdzPath: string | null = null;
  let glbPath: string | null = null;
  let heightCm: number | null = null;
  if (row.artworkId) {
    const [artwork] = await db.select().from(artworksTable).where(eq(artworksTable.id, row.artworkId)).limit(1);
    usdzPath = artwork?.modelUsdzPath ?? null;
    glbPath = artwork?.modelGlbPath ?? null;
    heightCm = artwork?.realHeightCm ?? null;
  } else if (row.drinkId) {
    const [drink] = await db.select().from(drinksTable).where(eq(drinksTable.id, row.drinkId)).limit(1);
    usdzPath = drink?.modelUsdzUrl ?? null;
    glbPath = drink?.modelGlbUrl ?? null;
    heightCm = drink?.realHeightCm ?? null;
  }
  if (!usdzPath || !glbPath) {
    res.status(404).json({ error: "This item has no AR file." });
    return;
  }
  // 16 cm matches the web viewer's and the iOS app's default when a venue has not set a height.
  const targetMetres = (heightCm ?? 16) / 100;
  const key = `${usdzPath}|${targetMetres}`;
  let built = usdzCache.get(key);
  if (!built) {
    const [usdz, glb] = await Promise.all([storedBytes(usdzPath), storedBytes(glbPath)]);
    if (!usdz || !glb) {
      res.status(404).json({ error: "This item's AR file is unavailable." });
      return;
    }
    try {
      const authoredHeight = summarizeGlb(glb).extents.y;
      built = scaledUsdz(usdz, authoredHeight > 0 ? targetMetres / authoredHeight : 1);
    } catch (error) {
      req.log.warn({ err: error }, "Could not build a sized USDZ");
      res.status(500).json({ error: "This item's AR file could not be prepared." });
      return;
    }
    if (usdzCache.size >= USDZ_CACHE_MAX) usdzCache.delete(usdzCache.keys().next().value as string);
    usdzCache.set(key, built);
  }
  res.set({
    "Content-Type": "model/vnd.usdz+zip",
    "Content-Disposition": `inline; filename="${row.id}.usdz"`,
    "Cache-Control": "public, max-age=3600",
    "Content-Length": String(built.length),
  });
  res.end(built);
});

router.post("/v1/displays/:id/claims", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = CreatePublicClaimParams.safeParse(req.params);
  const body = CreatePublicClaimBody.strict().safeParse(req.body);
  if (!params.success || !body.success) return rejectInvalid(res, "This claim couldn't be read. Try again.");
  const [found] = await db.select({ display: displaysTable, bar: barsTable }).from(displaysTable)
    .innerJoin(barsTable, eq(barsTable.id, displaysTable.barId))
    .where(and(eq(displaysTable.id, params.data.id), eq(displaysTable.status, "live"))).limit(1);
  if (!found || !found.display.offerTitle) {
    res.status(404).json({ error: "This offer isn't available." });
    return;
  }
  const now = new Date(Date.now());
  if (!offerIsOpen(found.display, now)) {
    res.status(410).json({ error: "This offer has ended." });
    return;
  }
  const hash = visitorHash(body.data.visitorId);
  const claimDay = localParts(now, safeTimeZone(found.bar.timezone)).day;
  const existing = async () => (await db.select().from(redemptionsTable).where(and(
    eq(redemptionsTable.displayId, found.display.id),
    eq(redemptionsTable.visitorHash, hash),
    eq(redemptionsTable.claimDay, claimDay),
  )).limit(1))[0];
  const send = (status: number, row: typeof redemptionsTable.$inferSelect) => {
    res.status(status).json(CreatePublicClaimResponse.parse({
      confirmationCode: row.confirmationCode,
      offerTitle: row.offerTitle,
      venueName: found.bar.name,
      spotLabel: row.spotLabel,
      claimedAt: row.claimedAt,
      expiresAt: row.expiresAt,
    }));
  };

  const already = await existing();
  if (already) return send(200, already);

  const [spot] = body.data.code
    ? await db.select().from(qrCodesTable).where(and(
      eq(qrCodesTable.code, body.data.code), eq(qrCodesTable.barId, found.bar.id),
    )).limit(1)
    : [];
  const validUntil = new Date(now.getTime() + CLAIM_VALID_MS);
  const expiresAt = found.display.offerEndsAt && found.display.offerEndsAt < validUntil
    ? found.display.offerEndsAt : validUntil;
  try {
    const [created] = await db.insert(redemptionsTable).values({
      id: randomUUID(),
      barId: found.bar.id,
      displayId: found.display.id,
      qrCodeId: spot?.id ?? null,
      visitorHash: hash,
      claimDay,
      confirmationCode: newConfirmationCode(),
      displayTitle: found.display.title,
      offerTitle: found.display.offerTitle,
      spotLabel: spot?.label ?? null,
      claimedAt: now,
      expiresAt,
    }).returning();
    send(201, created);
  } catch (error) {
    // Two taps racing: the other request won, so return its claim.
    const winner = isUniqueViolation(error) ? await existing() : undefined;
    if (!winner) throw error;
    send(200, winner);
  }
});

export default router;
