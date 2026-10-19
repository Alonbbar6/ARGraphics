import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  CreateDisplayBody,
  CreateDisplayResponse,
  CreateQrCodesBody,
  CreateQrCodesResponse,
  DeleteDisplayParams,
  DeleteDisplayResponse,
  DeleteQrCodeParams,
  DeleteQrCodeResponse,
  GetAnalyticsQueryParams,
  GetAnalyticsResponse,
  GetDisplayParams,
  GetDisplayResponse,
  GetPartnerProfileResponse,
  ListArtistPlacementsResponse,
  ListDisplaysResponse,
  ListQrCodesResponse,
  ListRedemptionsResponse,
  SearchArtistsQueryParams,
  SearchArtistsResponse,
  UpdateDisplayBody,
  UpdateDisplayParams,
  UpdateDisplayResponse,
  UpdatePartnerProfileBody,
  UpdatePartnerProfileResponse,
  UpdateQrCodeBody,
  UpdateQrCodeParams,
  UpdateQrCodeResponse,
} from "@workspace/api-zod";
import { artworkLicensesTable, artworksTable, barsTable, db, displaysTable, drinksTable, qrCodesTable, redemptionsTable, scansTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { InvalidArtworkError, MAX_ARTWORK_BYTES, validateRasterImage } from "../lib/tableCardArtwork";
import {
  countBy, dailySeries, heatmap, isValidTimeZone, newQrCode, rangeBounds, safeTimeZone, totals, type TrafficRange,
} from "../lib/traffic";
import { currentUser, isUniqueViolation, partnerKind, publicAssetUrl } from "./argraphics";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Bar = typeof barsTable.$inferSelect;
type DisplayRow = typeof displaysTable.$inferSelect;
type DrinkRow = typeof drinksTable.$inferSelect;
type DisplayType = "menu_item" | "promo_offer" | "art_piece" | "event_teaser";
type ArtworkRow = typeof artworksTable.$inferSelect;
type Placement = "table" | "wall" | "window" | "poster";

class DisplayRuleError extends Error {}

async function partner(req: Request, res: Response): Promise<Bar | null> {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage your displays." });
    return null;
  }
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.id, user.barId)).limit(1);
  if (!bar) {
    res.status(401).json({ error: "Sign in to manage your displays." });
    return null;
  }
  return bar;
}

function venueType(value: string | null | undefined): "restaurant" | "truck" | "stand" {
  return value === "truck" || value === "stand" ? value : "restaurant";
}

function profile(bar: Bar) {
  return {
    id: bar.id,
    kind: partnerKind(bar.kind) ?? "venue",
    venueType: partnerKind(bar.kind) === "artist" ? null : venueType(bar.venueType),
    name: bar.name,
    slug: bar.slug,
    bio: bar.bio,
    neighborhood: bar.neighborhood,
    address: bar.address,
    latitude: bar.latitude,
    longitude: bar.longitude,
    timezone: safeTimeZone(bar.timezone),
  };
}

/** Owner-only image route; guests get signed URLs from the public API instead. */
export function privateMediaUrl(objectPath: string | null): string | null {
  return objectPath ? `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}` : null;
}

async function weeklyCounts(barId: string, column: "displayId" | "qrCodeId") {
  const since = new Date(Date.now() - WEEK_MS);
  const scans = await db.select({ key: scansTable[column], count: sql<number>`count(*)::int` }).from(scansTable)
    .where(and(eq(scansTable.barId, barId), gte(scansTable.createdAt, since)))
    .groupBy(scansTable[column]);
  const redemptions = await db.select({ key: redemptionsTable[column], count: sql<number>`count(*)::int` })
    .from(redemptionsTable)
    .where(and(eq(redemptionsTable.barId, barId), gte(redemptionsTable.claimedAt, since)))
    .groupBy(redemptionsTable[column]);
  const toMap = (rows: { key: string | null; count: number }[]) =>
    new Map(rows.filter((row) => row.key).map((row) => [row.key as string, Number(row.count)]));
  return { scans: toMap(scans), redemptions: toMap(redemptions) };
}

async function serializeDisplays(req: Request, barId: string, rows: DisplayRow[]) {
  if (rows.length === 0) return [];
  const drinkIds = rows.map((row) => row.drinkId).filter((id): id is string => Boolean(id));
  const artistIds = rows.map((row) => row.artistBarId).filter((id): id is string => Boolean(id));
  const drinks = drinkIds.length
    ? await db.select().from(drinksTable).where(inArray(drinksTable.id, drinkIds)) : [];
  const artists = artistIds.length
    ? await db.select().from(barsTable).where(inArray(barsTable.id, artistIds)) : [];
  const artworkIds = rows.map((row) => row.artworkId).filter((id): id is string => Boolean(id));
  const artworks = artworkIds.length
    ? await db.select().from(artworksTable).where(inArray(artworksTable.id, artworkIds)) : [];
  const counts = await weeklyCounts(barId, "displayId");
  return rows.map((row) => {
    const drink = drinks.find((item) => item.id === row.drinkId);
    const artist = artists.find((item) => item.id === row.artistBarId);
    const artwork = artworks.find((item) => item.id === row.artworkId);
    return {
      id: row.id,
      type: row.type as DisplayType,
      placement: row.placement as Placement,
      status: row.status as "draft" | "live" | "paused",
      title: row.title,
      description: row.description,
      drinkId: row.drinkId,
      drink: drink ? displayDrink(req, drink) : null,
      // A licensed artwork supplies the picture; the venue never uploads one for it.
      mediaUrl: artwork ? `/api/artworks/${artwork.id}/media/image` : privateMediaUrl(row.mediaPath),
      offer: row.offerTitle
        ? { title: row.offerTitle, details: row.offerDetails ?? "", endsAt: row.offerEndsAt }
        : null,
      eventStartsAt: row.eventStartsAt,
      artist: artist
        ? { name: artist.name, slug: artist.slug }
        : row.artistName ? { name: row.artistName, slug: null } : null,
      artworkId: artwork?.id ?? null,
      artwork: artwork ? displayArtwork(artwork) : null,
      scansThisWeek: counts.scans.get(row.id) ?? 0,
      redemptionsThisWeek: counts.redemptions.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

function displayArtwork(artwork: ArtworkRow) {
  return {
    id: artwork.id,
    title: artwork.title,
    medium: artwork.medium as "image" | "model",
    modelGlbUrl: artwork.modelGlbPath ? `/api/artworks/${artwork.id}/media/glb` : null,
  };
}

/**
 * A venue may show an artwork it holds an accepted licence for; an artist may show their own.
 * Returns the artwork so the display can be credited to its maker.
 */
async function licensedArtwork(barId: string, artworkId: string | null | undefined) {
  if (!artworkId) return null;
  const [artwork] = await db.select().from(artworksTable).where(eq(artworksTable.id, artworkId)).limit(1);
  if (!artwork) throw new DisplayRuleError("We couldn't find that piece.");
  if (artwork.artistBarId === barId) return artwork;
  const [license] = await db.select({ id: artworkLicensesTable.id }).from(artworkLicensesTable).where(and(
    eq(artworkLicensesTable.artworkId, artwork.id), eq(artworkLicensesTable.venueBarId, barId),
    eq(artworkLicensesTable.status, "accepted"),
  )).limit(1);
  if (!license) throw new DisplayRuleError("Ask the artist for a licence before showing this piece.");
  return artwork;
}

function displayDrink(req: Request, drink: DrinkRow) {
  return {
    id: drink.id,
    name: drink.name,
    priceCents: drink.priceCents,
    thumbnailUrl: publicAssetUrl(req, drink.thumbnailUrl),
    modelUsdzUrl: publicAssetUrl(req, drink.modelUsdzUrl),
    modelGlbUrl: publicAssetUrl(req, drink.modelGlbUrl),
    generationStatus: drink.generationStatus,
  };
}

/** Each display type needs its one defining ingredient. */
function checkDisplayRules(display: {
  type: string; drinkId: string | null; offerTitle: string | null; eventStartsAt: Date | null;
}) {
  if (display.type === "menu_item" && !display.drinkId) {
    throw new DisplayRuleError("Pick the item this 3D menu item shows.");
  }
  if (display.type === "promo_offer" && !display.offerTitle) {
    throw new DisplayRuleError("Add the offer guests can claim.");
  }
  if (display.type === "event_teaser" && !display.eventStartsAt) {
    throw new DisplayRuleError("Add when the event starts.");
  }
}

async function ownedDrink(barId: string, drinkId: string | null | undefined) {
  if (!drinkId) return null;
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId))).limit(1);
  if (!drink) throw new DisplayRuleError("That item isn't on your menu.");
  return drink.id;
}

async function artistBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  const [artist] = await db.select().from(barsTable)
    .where(and(eq(barsTable.slug, slug), eq(barsTable.kind, "artist"))).limit(1);
  if (!artist) throw new DisplayRuleError("We couldn't find that artist on ARGraphics.");
  return artist;
}

/** Copies the staged upload to an accepted, validated object owned by the display. */
async function acceptMedia(objectPath: string) {
  const snapshot = await storage.createObjectEntitySnapshot(objectPath);
  try {
    await validateRasterImage(snapshot.file, {
      subject: "Display media",
      maxBytes: MAX_ARTWORK_BYTES,
      limitLabel: "10 MB",
      stillImageLabel: "Display media",
    });
  } catch (error) {
    await removeMedia(snapshot.objectPath);
    throw error;
  }
  return snapshot.objectPath;
}

async function removeMedia(objectPath: string | null | undefined) {
  if (!objectPath) return;
  try {
    await storage.deleteObjectEntity(objectPath);
  } catch {
    // An orphaned object costs storage, never correctness.
  }
}

function sendDisplayError(req: Request, res: Response, error: unknown, action: string) {
  if (error instanceof DisplayRuleError || error instanceof InvalidArtworkError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ObjectNotFoundError) {
    res.status(400).json({ error: "Upload the image before saving the display." });
    return;
  }
  req.log.error({ err: error }, `Could not ${action} display`);
  res.status(500).json({ error: `Could not ${action} the display.` });
}

router.get("/partner/profile", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  res.json(GetPartnerProfileResponse.parse(profile(bar)));
});

router.patch("/partner/profile", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = UpdatePartnerProfileBody.strict().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Enter valid profile details." });
    return;
  }
  const data = parsed.data;
  if (data.timezone !== undefined && !isValidTimeZone(data.timezone)) {
    res.status(400).json({ error: "Pick a valid timezone." });
    return;
  }
  if ((data.latitude === null) !== (data.longitude === null)
      || (data.latitude !== undefined) !== (data.longitude !== undefined)) {
    res.status(400).json({ error: "Set latitude and longitude together." });
    return;
  }
  const [updated] = await db.update(barsTable).set({
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.bio !== undefined ? { bio: data.bio.trim() } : {}),
    ...(data.neighborhood !== undefined ? { neighborhood: data.neighborhood.trim() } : {}),
    ...(data.address !== undefined ? { address: data.address.trim() } : {}),
    ...(data.latitude !== undefined ? { latitude: data.latitude, longitude: data.longitude } : {}),
    ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
    ...(data.venueType !== undefined ? { venueType: data.venueType } : {}),
  }).where(eq(barsTable.id, bar.id)).returning();
  res.json(UpdatePartnerProfileResponse.parse(profile(updated)));
});

router.get("/displays", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select().from(displaysTable)
    .where(eq(displaysTable.barId, bar.id)).orderBy(desc(displaysTable.updatedAt));
  res.json(ListDisplaysResponse.parse(await serializeDisplays(req, bar.id, rows)));
});

router.post("/displays", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = CreateDisplayBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a display type, placement and title." });
    return;
  }
  const input = parsed.data;
  let mediaPath: string | null = null;
  let committed = false;
  try {
    // Any display may show a 3D library model; menu items must (see checkDisplayRules).
    const drinkId = await ownedDrink(bar.id, input.drinkId);
    const artwork = await licensedArtwork(bar.id, input.artworkId);
    const artist = artwork ? null : await artistBySlug(input.artistSlug);
    const values = {
      id: randomUUID(),
      barId: bar.id,
      type: input.type,
      placement: input.placement,
      status: input.status ?? "draft",
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      drinkId,
      offerTitle: input.offer?.title.trim() ?? null,
      offerDetails: input.offer ? input.offer.details?.trim() ?? "" : null,
      offerEndsAt: input.offer?.endsAt ?? null,
      eventStartsAt: input.eventStartsAt ?? null,
      artistBarId: artwork?.artistBarId ?? artist?.id ?? null,
      artistName: artwork || artist ? null : input.artistName?.trim() || null,
      artworkId: artwork?.id ?? null,
    };
    checkDisplayRules(values);
    if (input.mediaObjectPath && !artwork) mediaPath = await acceptMedia(input.mediaObjectPath);
    const [created] = await db.insert(displaysTable).values({ ...values, mediaPath }).returning();
    committed = true;
    const [display] = await serializeDisplays(req, bar.id, [created]);
    res.status(201).json(CreateDisplayResponse.parse(display));
  } catch (error) {
    sendDisplayError(req, res, error, "save");
  } finally {
    if (!committed) await removeMedia(mediaPath);
  }
});

async function ownedDisplay(barId: string, id: string) {
  const [row] = await db.select().from(displaysTable)
    .where(and(eq(displaysTable.id, id), eq(displaysTable.barId, barId))).limit(1);
  return row;
}

router.get("/displays/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const params = GetDisplayParams.safeParse(req.params);
  const row = params.success ? await ownedDisplay(bar.id, params.data.id) : undefined;
  if (!row) {
    res.status(404).json({ error: "Display not found." });
    return;
  }
  const [display] = await serializeDisplays(req, bar.id, [row]);
  res.json(GetDisplayResponse.parse(display));
});

router.patch("/displays/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const params = UpdateDisplayParams.safeParse(req.params);
  const parsed = UpdateDisplayBody.strict().safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Enter valid display details." });
    return;
  }
  const existing = await ownedDisplay(bar.id, params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Display not found." });
    return;
  }
  const input = parsed.data;
  let newMedia: string | null = null;
  let committed = false;
  try {
    const changes: Partial<DisplayRow> = { updatedAt: new Date(Date.now()) };
    if (input.placement !== undefined) changes.placement = input.placement;
    if (input.status !== undefined) changes.status = input.status;
    if (input.title !== undefined) changes.title = input.title.trim();
    if (input.description !== undefined) changes.description = input.description.trim();
    if (input.drinkId !== undefined) changes.drinkId = await ownedDrink(bar.id, input.drinkId);
    if (input.offer !== undefined) {
      changes.offerTitle = input.offer?.title.trim() ?? null;
      changes.offerDetails = input.offer ? input.offer.details?.trim() ?? "" : null;
      changes.offerEndsAt = input.offer?.endsAt ?? null;
    }
    if (input.eventStartsAt !== undefined) changes.eventStartsAt = input.eventStartsAt;
    if (input.artworkId !== undefined) {
      const artwork = await licensedArtwork(bar.id, input.artworkId);
      changes.artworkId = artwork?.id ?? null;
      if (artwork) {
        changes.artistBarId = artwork.artistBarId;
        changes.artistName = null;
      }
    }
    const artworkId = changes.artworkId === undefined ? existing.artworkId : changes.artworkId;
    if (!artworkId && (input.artistSlug !== undefined || input.artistName !== undefined)) {
      const artist = await artistBySlug(input.artistSlug);
      changes.artistBarId = artist?.id ?? null;
      changes.artistName = artist ? null : input.artistName?.trim() || null;
    }
    checkDisplayRules({ ...existing, ...changes });
    if (input.mediaObjectPath && !artworkId) {
      newMedia = await acceptMedia(input.mediaObjectPath);
      changes.mediaPath = newMedia;
    } else if (input.mediaObjectPath === null) {
      changes.mediaPath = null;
    }
    const [updated] = await db.update(displaysTable).set(changes)
      .where(and(eq(displaysTable.id, existing.id), eq(displaysTable.barId, bar.id))).returning();
    committed = true;
    if (changes.mediaPath !== undefined && existing.mediaPath !== changes.mediaPath) {
      await removeMedia(existing.mediaPath);
    }
    const [display] = await serializeDisplays(req, bar.id, [updated]);
    res.json(UpdateDisplayResponse.parse(display));
  } catch (error) {
    sendDisplayError(req, res, error, "update");
  } finally {
    if (!committed) await removeMedia(newMedia);
  }
});

router.delete("/displays/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const params = DeleteDisplayParams.safeParse(req.params);
  const [deleted] = params.success
    ? await db.delete(displaysTable)
      .where(and(eq(displaysTable.id, params.data.id), eq(displaysTable.barId, bar.id))).returning()
    : [];
  if (!deleted) {
    res.status(404).json({ error: "Display not found." });
    return;
  }
  await removeMedia(deleted.mediaPath);
  res.json(DeleteDisplayResponse.parse({ message: "Display deleted." }));
});

async function serializeQrCodes(barId: string, rows: (typeof qrCodesTable.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const displayIds = rows.map((row) => row.displayId).filter((id): id is string => Boolean(id));
  const displays = displayIds.length
    ? await db.select({ id: displaysTable.id, title: displaysTable.title }).from(displaysTable)
      .where(inArray(displaysTable.id, displayIds)) : [];
  const counts = await weeklyCounts(barId, "qrCodeId");
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    placement: row.placement as Placement,
    displayId: row.displayId,
    displayTitle: displays.find((display) => display.id === row.displayId)?.title ?? null,
    code: row.code,
    path: `/s/${row.code}`,
    scansThisWeek: counts.scans.get(row.id) ?? 0,
    redemptionsThisWeek: counts.redemptions.get(row.id) ?? 0,
    createdAt: row.createdAt,
  }));
}

async function ownedDisplayId(barId: string, displayId: string | null | undefined) {
  if (!displayId) return null;
  return (await ownedDisplay(barId, displayId))?.id ?? undefined;
}

router.get("/qr-codes", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select().from(qrCodesTable)
    .where(and(eq(qrCodesTable.barId, bar.id), isNull(qrCodesTable.retiredAt)))
    .orderBy(qrCodesTable.createdAt, qrCodesTable.label);
  res.json(ListQrCodesResponse.parse(await serializeQrCodes(bar.id, rows)));
});

router.post("/qr-codes", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = CreateQrCodesBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Name each spot (up to 60 at once) and pick where it goes." });
    return;
  }
  const displayId = await ownedDisplayId(bar.id, parsed.data.displayId);
  if (displayId === undefined) {
    res.status(400).json({ error: "That display isn't yours." });
    return;
  }
  const created: (typeof qrCodesTable.$inferSelect)[] = [];
  const baseTime = Date.now();
  for (const [index, label] of parsed.data.labels.entries()) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const [row] = await db.insert(qrCodesTable).values({
          id: randomUUID(),
          barId: bar.id,
          displayId,
          code: newQrCode(),
          label: label.trim(),
          placement: parsed.data.placement,
          // Keep the batch in the order it was entered.
          createdAt: new Date(baseTime + index),
        }).returning();
        created.push(row);
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 4) throw error;
      }
    }
  }
  res.status(201).json(CreateQrCodesResponse.parse(await serializeQrCodes(bar.id, created)));
});

router.patch("/qr-codes/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const params = UpdateQrCodeParams.safeParse(req.params);
  const parsed = UpdateQrCodeBody.strict().safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Enter valid QR code details." });
    return;
  }
  const displayId = parsed.data.displayId === undefined
    ? undefined : await ownedDisplayId(bar.id, parsed.data.displayId);
  if (parsed.data.displayId && displayId === undefined) {
    res.status(400).json({ error: "That display isn't yours." });
    return;
  }
  const [updated] = await db.update(qrCodesTable).set({
    ...(parsed.data.label !== undefined ? { label: parsed.data.label.trim() } : {}),
    ...(parsed.data.placement !== undefined ? { placement: parsed.data.placement } : {}),
    ...(parsed.data.displayId !== undefined ? { displayId } : {}),
  }).where(and(
    eq(qrCodesTable.id, params.data.id), eq(qrCodesTable.barId, bar.id), isNull(qrCodesTable.retiredAt),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "QR code not found." });
    return;
  }
  const [code] = await serializeQrCodes(bar.id, [updated]);
  res.json(UpdateQrCodeResponse.parse(code));
});

router.delete("/qr-codes/:id", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const params = DeleteQrCodeParams.safeParse(req.params);
  // Retire rather than delete, so past scans and walk-ins keep their spot.
  const [retired] = params.success
    ? await db.update(qrCodesTable).set({ retiredAt: new Date(Date.now()) }).where(and(
      eq(qrCodesTable.id, params.data.id), eq(qrCodesTable.barId, bar.id), isNull(qrCodesTable.retiredAt),
    )).returning()
    : [];
  if (!retired) {
    res.status(404).json({ error: "QR code not found." });
    return;
  }
  res.json(DeleteQrCodeResponse.parse({ message: "QR code retired. Its past scans stay in your numbers." }));
});

router.get("/analytics", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const query = GetAnalyticsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Pick week, month or season." });
    return;
  }
  const range: TrafficRange = query.data.range ?? "week";
  const timeZone = safeTimeZone(bar.timezone);
  const { from, to, previousFrom } = rangeBounds(range, new Date(Date.now()));
  const scanRows = await db.select({
    createdAt: scansTable.createdAt, visitorHash: scansTable.visitorHash,
    displayId: scansTable.displayId, qrCodeId: scansTable.qrCodeId,
  }).from(scansTable).where(and(eq(scansTable.barId, bar.id), gte(scansTable.createdAt, previousFrom)));
  const redemptionRows = await db.select({
    claimedAt: redemptionsTable.claimedAt, displayId: redemptionsTable.displayId, qrCodeId: redemptionsTable.qrCodeId,
  }).from(redemptionsTable).where(and(eq(redemptionsTable.barId, bar.id), gte(redemptionsTable.claimedAt, previousFrom)));

  const scans = scanRows.filter((row) => row.createdAt >= from);
  const previousScans = scanRows.filter((row) => row.createdAt < from);
  const redemptions = redemptionRows.filter((row) => row.claimedAt >= from);
  const previousRedemptions = redemptionRows.filter((row) => row.claimedAt < from);

  const displays = await db.select().from(displaysTable).where(eq(displaysTable.barId, bar.id));
  const codes = await db.select().from(qrCodesTable).where(eq(qrCodesTable.barId, bar.id));
  const scansByDisplay = countBy(scans, (row) => row.displayId);
  const claimsByDisplay = countBy(redemptions, (row) => row.displayId);
  const scansByCode = countBy(scans, (row) => row.qrCodeId);
  const claimsByCode = countBy(redemptions, (row) => row.qrCodeId);

  res.json(GetAnalyticsResponse.parse({
    range,
    from,
    to,
    timezone: timeZone,
    totals: totals(scans, redemptions, timeZone),
    previous: totals(previousScans, previousRedemptions, timeZone),
    series: dailySeries(scans, redemptions, from, to, timeZone),
    heatmap: heatmap(scans, timeZone),
    byDisplay: displays
      .map((display) => ({
        displayId: display.id,
        title: display.title,
        type: display.type as DisplayType,
        placement: display.placement as Placement,
        scans: scansByDisplay.get(display.id) ?? 0,
        redemptions: claimsByDisplay.get(display.id) ?? 0,
      }))
      .sort((a, b) => b.redemptions - a.redemptions || b.scans - a.scans),
    byQrCode: codes
      .filter((code) => !code.retiredAt || scansByCode.has(code.id))
      .map((code) => ({
        qrCodeId: code.id,
        label: code.label,
        scans: scansByCode.get(code.id) ?? 0,
        redemptions: claimsByCode.get(code.id) ?? 0,
      }))
      .sort((a, b) => b.redemptions - a.redemptions || b.scans - a.scans),
  }));
});

router.get("/redemptions", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select().from(redemptionsTable)
    .where(eq(redemptionsTable.barId, bar.id)).orderBy(desc(redemptionsTable.claimedAt)).limit(50);
  res.json(ListRedemptionsResponse.parse(rows.map((row) => ({
    id: row.id,
    confirmationCode: row.confirmationCode,
    displayId: row.displayId,
    displayTitle: row.displayTitle,
    offerTitle: row.offerTitle,
    spotLabel: row.spotLabel,
    claimedAt: row.claimedAt,
    expiresAt: row.expiresAt,
  }))));
});

router.get("/artist/placements", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const rows = await db.select({ display: displaysTable, venue: barsTable }).from(displaysTable)
    .innerJoin(barsTable, eq(barsTable.id, displaysTable.barId))
    .where(eq(displaysTable.artistBarId, bar.id))
    .orderBy(desc(displaysTable.updatedAt));
  const since = new Date(Date.now() - WEEK_MS);
  const counts = rows.length
    ? await db.select({ key: scansTable.displayId, count: sql<number>`count(*)::int` }).from(scansTable)
      .where(and(inArray(scansTable.displayId, rows.map((row) => row.display.id)), gte(scansTable.createdAt, since)))
      .groupBy(scansTable.displayId)
    : [];
  res.json(ListArtistPlacementsResponse.parse(rows.map(({ display, venue }) => ({
    displayId: display.id,
    title: display.title,
    venueName: venue.name,
    venueSlug: venue.slug,
    neighborhood: venue.neighborhood,
    placement: display.placement as Placement,
    status: display.status as "draft" | "live" | "paused",
    scansThisWeek: Number(counts.find((row) => row.key === display.id)?.count ?? 0),
  }))));
});

router.get("/artists", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const query = SearchArtistsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Search with fewer than 80 characters." });
    return;
  }
  const term = (query.data.q ?? "").trim().replace(/[\\%_]/g, (match) => `\\${match}`);
  const rows = await db.select().from(barsTable)
    .where(and(eq(barsTable.kind, "artist"), term ? ilike(barsTable.name, `%${term}%`) : undefined))
    .orderBy(barsTable.name).limit(20);
  res.json(SearchArtistsResponse.parse(rows.map((row) => ({
    slug: row.slug, name: row.name, neighborhood: row.neighborhood,
  }))));
});

export default router;
