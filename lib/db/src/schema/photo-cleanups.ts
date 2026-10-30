import { pgTable, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable, drinksTable } from "./argraphics";

export type PhotoLoop = Array<[number, number]>;
export type PhotoParts = { liquid?: PhotoLoop; garnish?: PhotoLoop[] };
export type SubjectBox = { x: number; y: number; w: number; h: number };

export const photoCleanupsTable = pgTable("photo_cleanups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  drinkId: text("drink_id").notNull().references(() => drinksTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("processing"),
  sourcePhotoPath: text("source_photo_path").notNull(),
  cleanedPhotoPath: text("cleaned_photo_path"),
  sourceSize: integer("source_size").notNull(),
  cleanedSize: integer("cleaned_size"),
  // Parts the owner traced on the photo (liquid, garnish loops) and where the cutout's subject
  // sits in the source photo, both as 0-1 fractions. Used to tell glass from drink after a build.
  parts: jsonb("parts").$type<PhotoParts>(),
  subjectBox: jsonb("subject_box").$type<SubjectBox>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("photo_cleanups_owner_drink").on(table.ownerId, table.drinkId)]);

export const insertPhotoCleanupSchema = createInsertSchema(photoCleanupsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPhotoCleanup = z.infer<typeof insertPhotoCleanupSchema>;
export type PhotoCleanup = typeof photoCleanupsTable.$inferSelect;
