import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { barsTable, db, displaysTable, drinksTable, menuVersionTable, qrCodesTable, redemptionsTable, scansTable, usersTable } from "@workspace/db";
import { localParts, localTimeOn, safeTimeZone } from "./traffic";
import { serviceWindows } from "./service-window";

/**
 * Development-only demo partners: profile details, displays and placed codes so the
 * dashboard and the iOS app have something to show. Only the demo bar also gets a
 * night of scans and claims (re-stamped to "the last few hours" on every boot) so the
 * room and Tonight mode have something to animate; every other partner's numbers come
 * from real use.
 */
export const DEMO_TRUCK_ID = "demo-truck";

/** A taco truck with three items, so the pitch to trucks and stands has a real example. */
async function seedDemoTruck(passwordHash: string, timezone: string) {
  await db.insert(barsTable).values({
    id: DEMO_TRUCK_ID, name: "La Esquina Taco Truck", slug: "demo-truck", kind: "venue", venueType: "truck",
    neighborhood: "Little Havana", address: "SW 8th St & 15th Ave, Miami", timezone,
    bio: "Birria, al pastor and aguas frescas from a truck that parks where the lunch line is.",
  }).onConflictDoNothing();
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.email, "demo-truck@argraphics.app")).limit(1);
  if (!owner) {
    await db.insert(usersTable).values({ id: randomUUID(), barId: DEMO_TRUCK_ID, email: "demo-truck@argraphics.app", passwordHash, name: "Rosa Delgado" });
  }
  await db.insert(drinksTable).values([
    { id: "demo-truck-birria", barId: DEMO_TRUCK_ID, name: "Birria tacos", description: "Three slow-braised beef tacos, consomé on the side", priceCents: 1200, category: "signature", isPublished: true, realHeightCm: 6, sortOrder: 1 },
    { id: "demo-truck-fries", barId: DEMO_TRUCK_ID, name: "Loaded fries", description: "Fries, queso, al pastor, pickled onion, crema", priceCents: 900, category: "signature", isPublished: true, realHeightCm: 9, sortOrder: 2 },
    { id: "demo-truck-agua", barId: DEMO_TRUCK_ID, name: "Agua fresca", description: "Horchata, jamaica or tamarindo, 24 oz", priceCents: 400, category: "classic", isPublished: true, realHeightCm: 14, sortOrder: 3 },
  ]).onConflictDoNothing();
  await db.insert(menuVersionTable).values({ barId: DEMO_TRUCK_ID, version: 1 }).onConflictDoNothing();
  await db.insert(displaysTable).values([
    { id: "demo-truck-display-birria", barId: DEMO_TRUCK_ID, type: "menu_item", placement: "window", status: "live", title: "Birria tacos", description: "See the plate before you order.", drinkId: "demo-truck-birria" },
    { id: "demo-truck-display-fries", barId: DEMO_TRUCK_ID, type: "menu_item", placement: "window", status: "live", title: "Loaded fries", description: "Enough for two. Usually.", drinkId: "demo-truck-fries" },
    { id: "demo-truck-display-agua", barId: DEMO_TRUCK_ID, type: "menu_item", placement: "window", status: "live", title: "Agua fresca", description: "Cold. Big. Four dollars.", drinkId: "demo-truck-agua" },
    { id: "demo-truck-display-lunch", barId: DEMO_TRUCK_ID, type: "promo_offer", placement: "window", status: "live", title: "Lunch line special", description: "Show this at the window.", offerTitle: "Free agua fresca with any two tacos", offerDetails: "Weekdays before 2pm. One per person." },
  ]).onConflictDoNothing();
  await db.insert(qrCodesTable).values([
    { id: "demo-truck-qr-window", barId: DEMO_TRUCK_ID, displayId: "demo-truck-display-birria", code: "demotruck", label: "Service window", placement: "window" },
  ]).onConflictDoNothing();
}

export async function seedDemoPartners(demoBarId: string) {
  const [demo] = await db.select().from(barsTable).where(eq(barsTable.id, demoBarId)).limit(1);
  if (!demo) return;
  if (!demo.neighborhood) {
    await db.update(barsTable).set({
      neighborhood: "Little Havana",
      address: "1500 SW 8th St, Miami, FL",
      latitude: 25.7655,
      longitude: -80.2194,
      bio: "Neighborhood bar with a long counter and longer Wednesdays.",
    }).where(eq(barsTable.id, demoBarId));
  }
  await db.insert(barsTable).values([
    {
      id: "demo-artist", name: "Ana Ruiz", slug: "ana-ruiz", kind: "artist", neighborhood: "Little Havana",
      bio: "Paints florals on the walls of places she eats. These ones only bloom after dark.",
    },
    {
      id: "demo-neighbor", name: "La Gaviota Taqueria", slug: "la-gaviota", neighborhood: "Little Havana",
      address: "1620 SW 8th St, Miami, FL", latitude: 25.7652, longitude: -80.2215,
      bio: "Tacos al pastor off the trompo, every night but Monday.",
    },
  ]).onConflictDoNothing();
  const [artistUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, "demo-artist@argraphics.app")).limit(1);
  if (!artistUser) {
    await db.insert(usersTable).values({
      id: "demo-artist-user", barId: "demo-artist", email: "demo-artist@argraphics.app",
      passwordHash: await bcrypt.hash("ARGraphics-demo-2026!", 12), name: "Ana Ruiz",
    }).onConflictDoNothing();
  }
  // An owner may already have made a display for a demo drink in the dashboard; never add a twin.
  const taken = new Set(
    (await db.select({ drinkId: displaysTable.drinkId }).from(displaysTable).where(eq(displaysTable.barId, demoBarId)))
      .map((row) => row.drinkId)
      .filter((id): id is string => Boolean(id)),
  );
  await db.insert(displaysTable).values([
    {
      id: "demo-display-spritz", barId: demoBarId, type: "menu_item", placement: "table", status: "live",
      title: "Blood Orange Spritz", description: "See it on your table before you order.", drinkId: "demo-cocktail-1",
    },
    {
      id: "demo-display-last-word", barId: demoBarId, type: "menu_item", placement: "table", status: "live",
      title: "Last Word", description: "Gin, green chartreuse, maraschino, lime. Turn it around before you order.", drinkId: "demo-cocktail-3",
    },
    {
      id: "demo-display-gimlet", barId: demoBarId, type: "menu_item", placement: "table", status: "live",
      title: "Garden Gimlet", description: "Cucumber, basil, lime, house gin. This season only.", drinkId: "demo-cocktail-4",
    },
    {
      id: "demo-display-wednesday", barId: demoBarId, type: "promo_offer", placement: "table", status: "live",
      title: "Wednesday regulars", description: "Show this to your server.",
      offerTitle: "Free agua fresca with any spritz", offerDetails: "One per table. Wednesdays only.",
    },
    {
      id: "demo-display-bloom", barId: demoBarId, type: "art_piece", placement: "wall", status: "live",
      title: "Night Bloom", description: "A mural that only exists on this wall.", artistBarId: "demo-artist",
    },
    {
      id: "demo-display-mural-night", barId: demoBarId, type: "event_teaser", placement: "poster", status: "draft",
      title: "Mural night with Ana Ruiz", description: "Live painting, two-for-one spritzes.",
      // A scheduled evening start (8:00 PM at the bar), not whatever time the seed happened to run.
      eventStartsAt: localTimeOn(6, 20, 0, safeTimeZone(demo.timezone)),
    },
    {
      id: "demo-neighbor-tacos", barId: "demo-neighbor", type: "promo_offer", placement: "window", status: "live",
      title: "Taco Tuesday", offerTitle: "2-for-1 al pastor", offerDetails: "Before 7pm.",
    },
  ].filter((display) => !("drinkId" in display && display.drinkId && taken.has(display.drinkId)))).onConflictDoNothing();
  await db.insert(qrCodesTable).values([
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `demo-qr-table-${index + 1}`, barId: demoBarId, displayId: "demo-display-wednesday",
      code: `demotbl${index + 1}`, label: `Table ${index + 1}`, placement: "table",
    })),
    { id: "demo-qr-wall", barId: demoBarId, displayId: "demo-display-bloom", code: "demowall", label: "Back wall", placement: "wall" },
    { id: "demo-qr-bar", barId: demoBarId, displayId: "demo-display-spritz", code: "demobar1", label: "Bar top", placement: "table" },
  ]).onConflictDoNothing();
  await seedDemoTruck(await bcrypt.hash("ARGraphics-demo-2026!", 12), safeTimeZone(demo.timezone));
  await seedDemoActivity(demoBarId, safeTimeZone(demo.timezone));
}

/** Minutes ago for each demo scan: a slow start, a rush, then a tail. Deterministic. */
const DEMO_SCAN_OFFSETS = [
  2, 4, 7, 9, 12, 15, 17, 21, 24, 26, 31, 35, 38, 42, 47, 51, 55, 58, 63, 68,
  74, 79, 85, 92, 98, 105, 113, 121, 130, 140, 151, 163, 176, 190, 205, 221, 238, 256, 275, 295,
];
const DEMO_CLAIM_OFFSETS = [6, 29, 77, 158];

/**
 * A night's worth of activity for the demo bar. Rows have fixed ids so restarts never
 * pile up, and their timestamps are moved to the last few hours each time so the room
 * always looks like it is mid-service.
 */
async function seedDemoActivity(barId: string, timeZone: string) {
  const codes = await db.select().from(qrCodesTable).where(eq(qrCodesTable.barId, barId));
  if (codes.length === 0) return;
  const displays = await db.select().from(displaysTable).where(eq(displaysTable.barId, barId));
  // Mid-service the activity trails "now"; in the morning it trails last night's close,
  // so the board always has a real window to show.
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.id, barId)).limit(1);
  const windows = serviceWindows(new Date(Date.now()), bar?.serviceOpen ?? null, bar?.serviceClose ?? null, timeZone);
  const now = windows.open ? Date.now() : (windows.lastNight?.to.getTime() ?? Date.now()) - 5 * 60_000;
  const scans = DEMO_SCAN_OFFSETS.map((minutes, index) => {
    const code = codes[index % codes.length];
    const display = displays.find((row) => row.id === code.displayId && row.status === "live") ?? null;
    return {
      id: `demo-scan-${String(index + 1).padStart(2, "0")}`,
      barId, qrCodeId: code.id, displayId: display?.id ?? null,
      // Nine "people" so repeat visitors show up.
      visitorHash: `demo-visitor-${index % 9}`,
      createdAt: new Date(now - minutes * 60_000),
    };
  });
  await db.insert(scansTable).values(scans).onConflictDoNothing();
  for (const scan of scans) {
    await db.update(scansTable).set({ createdAt: scan.createdAt }).where(eq(scansTable.id, scan.id));
  }
  const offer = displays.find((row) => row.offerTitle && row.status === "live");
  if (!offer) return;
  const code = codes.find((row) => row.displayId === offer.id) ?? codes[0];
  const claims = DEMO_CLAIM_OFFSETS.map((minutes, index) => {
    const claimedAt = new Date(now - minutes * 60_000);
    return {
      id: `demo-claim-${index + 1}`,
      barId, displayId: offer.id, qrCodeId: code.id,
      visitorHash: `demo-visitor-${index}`,
      claimDay: localParts(claimedAt, timeZone).day,
      confirmationCode: `DEMO${index + 1}`,
      displayTitle: offer.title,
      offerTitle: offer.offerTitle as string,
      spotLabel: code.label,
      claimedAt,
      expiresAt: new Date(claimedAt.getTime() + 30 * 60_000),
    };
  });
  await db.insert(redemptionsTable).values(claims).onConflictDoNothing();
  for (const claim of claims) {
    await db.update(redemptionsTable).set({ claimedAt: claim.claimedAt, claimDay: claim.claimDay, expiresAt: claim.expiresAt })
      .where(eq(redemptionsTable.id, claim.id));
  }
}
