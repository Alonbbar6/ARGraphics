import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./garnish";

// One bounded row per owner. Attempts survive lease release and server restarts.
export const photoCleanupLimitsTable = pgTable("photo_cleanup_limits", {
  ownerId: text("owner_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  count: integer("count").notNull().default(0),
  windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }).notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
});

export const insertPhotoCleanupLimitSchema = createInsertSchema(photoCleanupLimitsTable);
export type InsertPhotoCleanupLimit = typeof photoCleanupLimitsTable.$inferInsert;
export type PhotoCleanupLimit = typeof photoCleanupLimitsTable.$inferSelect;
