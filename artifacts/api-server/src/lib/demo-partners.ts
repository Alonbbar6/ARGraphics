import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { barsTable, db, displaysTable, qrCodesTable, usersTable } from "@workspace/db";
import { localTimeOn, safeTimeZone } from "./traffic";

/**
 * Development-only demo partners: profile details, displays and placed codes so the
 * dashboard and the iOS app have something to show. It seeds configuration only,
 * never scans or claims; those numbers come from real use.
 */
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
}
