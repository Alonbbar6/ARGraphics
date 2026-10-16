import { pgTable, text, integer, boolean, timestamp, numeric, uniqueIndex, index, doublePrecision } from "drizzle-orm/pg-core";

export const barsTable = pgTable("bars", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  // A partner is either a venue (bar, restaurant) or a local artist.
  kind: text("kind").notNull().default("venue"),
  bio: text("bio").notNull().default(""),
  neighborhood: text("neighborhood").notNull().default(""),
  address: text("address").notNull().default(""),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  timezone: text("timezone").notNull().default("America/New_York"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  sessionVersion: integer("session_version").notNull().default(0),
  passwordResetHash: text("password_reset_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryRateLimitsTable = pgTable("recovery_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const drinksTable = pgTable("drinks", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  category: text("category").notNull().default("signature"),
  isAvailable: boolean("is_available").notNull().default(true),
  isPublished: boolean("is_published").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  sourcePhotoUrl: text("source_photo_url"),
  cleanedPhotoUrl: text("cleaned_photo_url"),
  modelGlbUrl: text("model_glb_url"),
  modelUsdzUrl: text("model_usdz_url"),
  thumbnailUrl: text("thumbnail_url"),
  generationStatus: text("generation_status").notNull().default("none"),
  generationProgress: integer("generation_progress").notNull().default(0),
  meshyTaskId: text("meshy_task_id"),
  generationError: text("generation_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tableCardsTable = pgTable("table_cards", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  referenceImageUrl: text("reference_image_url").notNull(),
  physicalWidthMeters: numeric("physical_width_meters", { precision: 7, scale: 5 }).notNull().default("0.1"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const arEventsTable = pgTable("ar_events", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  drinkId: text("drink_id").notNull().references(() => drinksTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const menuVersionTable = pgTable("menu_version", {
  barId: text("bar_id").primaryKey().references(() => barsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
});

/** An AR experience a partner places in their space. */
export const displaysTable = pgTable("displays", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  placement: text("placement").notNull(),
  status: text("status").notNull().default("draft"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  drinkId: text("drink_id").references(() => drinksTable.id, { onDelete: "set null" }),
  mediaPath: text("media_path"),
  offerTitle: text("offer_title"),
  offerDetails: text("offer_details"),
  offerEndsAt: timestamp("offer_ends_at", { withTimezone: true }),
  eventStartsAt: timestamp("event_starts_at", { withTimezone: true }),
  artistName: text("artist_name"),
  artistBarId: text("artist_bar_id").references(() => barsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("displays_bar_idx").on(table.barId), index("displays_artist_idx").on(table.artistBarId)]);

/** A printed code at one spot. Retired codes keep their history but stop resolving. */
export const qrCodesTable = pgTable("qr_codes", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  displayId: text("display_id").references(() => displaysTable.id, { onDelete: "set null" }),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  placement: text("placement").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("qr_codes_bar_idx").on(table.barId)]);

/** One guest scan. visitorHash is a keyed hash of the app's anonymous install ID. */
export const scansTable = pgTable("scans", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  qrCodeId: text("qr_code_id").references(() => qrCodesTable.id, { onDelete: "set null" }),
  displayId: text("display_id").references(() => displaysTable.id, { onDelete: "set null" }),
  visitorHash: text("visitor_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("scans_bar_time_idx").on(table.barId, table.createdAt)]);

/** An offer claimed in the room: the walk-in a partner can count. */
export const redemptionsTable = pgTable("redemptions", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  displayId: text("display_id").references(() => displaysTable.id, { onDelete: "set null" }),
  qrCodeId: text("qr_code_id").references(() => qrCodesTable.id, { onDelete: "set null" }),
  visitorHash: text("visitor_hash").notNull(),
  // Partner-local calendar day; one claim per guest, offer and day.
  claimDay: text("claim_day").notNull(),
  confirmationCode: text("confirmation_code").notNull(),
  displayTitle: text("display_title").notNull(),
  offerTitle: text("offer_title").notNull(),
  spotLabel: text("spot_label"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("redemptions_bar_time_idx").on(table.barId, table.claimedAt),
  uniqueIndex("redemptions_once_per_day").on(table.displayId, table.visitorHash, table.claimDay),
]);
