import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable, drinksTable } from "./garnish";

export const photoCleanupsTable = pgTable("photo_cleanups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  drinkId: text("drink_id").notNull().references(() => drinksTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("processing"),
  sourcePhotoPath: text("source_photo_path").notNull(),
  cleanedPhotoPath: text("cleaned_photo_path"),
  sourceSize: integer("source_size").notNull(),
  cleanedSize: integer("cleaned_size"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("photo_cleanups_owner_drink").on(table.ownerId, table.drinkId)]);

export const insertPhotoCleanupSchema = createInsertSchema(photoCleanupsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPhotoCleanup = z.infer<typeof insertPhotoCleanupSchema>;
export type PhotoCleanup = typeof photoCleanupsTable.$inferSelect;
