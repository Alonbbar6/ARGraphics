import { pgTable, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { barsTable } from "./argraphics";

/**
 * Exclusivity: a Business subscription holds one (category, neighborhood) slot, and only
 * one partner can hold a given slot. The row is reserved when Checkout is created, so two
 * taco trucks in the same neighborhood cannot both pay; it is released when the
 * subscription ends or the checkout expires unpaid. Keys are normalized (lowercase,
 * accents stripped, spaces collapsed); labels keep the partner's spelling for display.
 */
export const businessSlotsTable = pgTable("business_slots", {
  barId: text("bar_id").primaryKey().references(() => barsTable.id, { onDelete: "cascade" }),
  categoryKey: text("category_key").notNull(),
  neighborhoodKey: text("neighborhood_key").notNull(),
  categoryLabel: text("category_label").notNull(),
  neighborhoodLabel: text("neighborhood_label").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("business_slots_claim").on(table.categoryKey, table.neighborhoodKey)]);

/** Every Stripe event we have handled, so a redelivered event changes nothing. */
export const billingEventsTable = pgTable("billing_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every change to a partner's build credits. `bars.build_credits` is the cached balance;
 * (reason, reference) is unique so a purchase or a refund can only ever be applied once.
 */
export const creditLedgerTable = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  barId: text("bar_id").notNull().references(() => barsTable.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  // purchase | build | refund_start_failed | refund_rejected | refund_meshy_failed | admin
  reason: text("reason").notNull(),
  reference: text("reference").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("credit_ledger_once").on(table.reason, table.reference),
  index("credit_ledger_bar_idx").on(table.barId),
]);
