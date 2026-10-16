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
  barsTable, db, displaysTable, drinksTable, qrCodesTable, redemptionsTable, scansTable, tableCardsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
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
  const now = new Date(Date.now());
  return Promise.all(rows.map(async (row) => {
    const drink = drinks.find((item) => item.id === row.drinkId);
    const artist = artists.find((item) => item.id === row.artistBarId);
    return {
      id: row.id,
      type: row.type as "menu_item" | "promo_offer" | "art_piece" | "event_teaser",
      placement: row.placement as "table" | "wall" | "window" | "poster",
      title: row.title,
      description: row.description,
      mediaUrl: await signedMedia(req, row.mediaPath),
      thumbnailUrl: drink ? publicAssetUrl(req, drink.thumbnailUrl) : null,
      modelUsdzUrl: drink ? publicAssetUrl(req, drink.modelUsdzUrl) : null,
      modelGlbUrl: drink ? publicAssetUrl(req, drink.modelGlbUrl) : null,
      modelHeightCm: drink?.realHeightCm ?? null,
      // A library model on an art piece or event is decor, not something to order.
      price: drink && row.type === "menu_item" ? priceLabel(drink.priceCents) : null,
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

async function publicTableCards(barId: string) {
  const cards = await db.select().from(tableCardsTable)
    .where(and(eq(tableCardsTable.barId, barId), eq(tableCardsTable.isActive, true)))
    .orderBy(asc(tableCardsTable.createdAt));
  return Promise.all(cards.map(async (card) => ({
    id: card.id,
    name: card.name,
    referenceImageUrl: await storage.getObjectEntityDownloadURL(card.referenceImageUrl),
    physicalWidthCm: Number(card.physicalWidthMeters) * 100,
  })));
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
    tableCards: await publicTableCards(found.bar.id),
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
    tableCards: await publicTableCards(bar.id),
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
      mediaUrl: await signedMedia(req, display.mediaPath),
      venueName: venue.name,
      venueSlug: venue.slug,
      neighborhood: venue.neighborhood,
    }))),
  }));
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
