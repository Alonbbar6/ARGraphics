import { pgTable, text, integer, boolean, timestamp, numeric, uniqueIndex } from "drizzle-orm/pg-core";

export const barsTable = pgTable("bars", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
