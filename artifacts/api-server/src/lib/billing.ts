import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { barsTable, businessSlotsTable, creditLedgerTable, db, displaysTable } from "@workspace/db";

/**
 * Plans, limits and build credits, with no Stripe in sight. Stripe only ever tells us
 * what happened (through the webhook); everything the app enforces lives here.
 *
 * - `free`: up to PLAN_LIVE_LIMIT_FREE displays live at once, $5 per 3D build (credits).
 * - `business`: unlimited live displays, builds included, promoted, and one exclusive
 *   (category, neighborhood) slot. Mirrors the Stripe subscription.
 * - `founding`: a free Business plan until `bars.founding_until`, set by hand for partners
 *   who joined during the pilot.
 */

export type Bar = typeof barsTable.$inferSelect;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PlanTier = "free" | "business" | "founding";

export const PLAN_LIVE_LIMIT_FREE = 3;
export const BUSINESS_MONTHLY_CENTS = 15_000;
export const BUILD_CREDIT_CENTS = 500;
export const MAX_CREDITS_PER_CHECKOUT = 10;
/** A reserved slot that was never paid for frees up after this long. */
const SLOT_RESERVATION_MS = 60 * 60 * 1000;

/** Postgres unique violation, whether raw or wrapped by the query layer. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class BillingError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}
export class PlanLimitError extends BillingError {
  constructor() {
    super(`Free accounts can have ${PLAN_LIVE_LIMIT_FREE} displays live at once. Pause one, or upgrade to Business for unlimited.`, 402, "plan_limit");
  }
}
export class NoCreditsError extends BillingError {
  constructor() {
    super("You're out of build credits. Buy more on the Plan page, $5 per model.", 402, "no_credits");
  }
}
export class SlotTakenError extends BillingError {
  constructor(category: string, neighborhood: string) {
    super(`Another ${category} business already has ${neighborhood}. Try a different category, or ask us about the waitlist.`, 409, "slot_taken");
  }
}

/** Lowercase, accents stripped, spaces collapsed: "Little  Havana " and "little havana" match. */
export function normalizeKey(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function effectivePlan(bar: Pick<Bar, "plan" | "foundingUntil">, now = Date.now()): PlanTier {
  if (bar.foundingUntil && bar.foundingUntil.getTime() > now) return "founding";
  return bar.plan === "business" ? "business" : "free";
}

export const hasUnlimitedDisplays = (bar: Pick<Bar, "plan" | "foundingUntil">) => effectivePlan(bar) !== "free";
export const buildsIncluded = hasUnlimitedDisplays;

export async function countLiveDisplays(tx: Tx | typeof db, barId: string, excludingDisplayId?: string): Promise<number> {
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(displaysTable).where(and(
    eq(displaysTable.barId, barId),
    eq(displaysTable.status, "live"),
    excludingDisplayId ? ne(displaysTable.id, excludingDisplayId) : undefined,
  ));
  return row?.count ?? 0;
}

/**
 * Throws PlanLimitError when one more live display would pass the free plan's limit.
 * Locks the bar row first, so two "go live" requests racing on one account are counted
 * one after the other instead of both squeezing under the limit.
 */
export async function assertCanGoLive(tx: Tx, bar: Bar, excludingDisplayId?: string): Promise<void> {
  if (hasUnlimitedDisplays(bar)) return;
  await tx.select({ id: barsTable.id }).from(barsTable).where(eq(barsTable.id, bar.id)).for("update");
  if ((await countLiveDisplays(tx, bar.id, excludingDisplayId)) >= PLAN_LIVE_LIMIT_FREE) throw new PlanLimitError();
}

/** Spends one credit for `reference` (a build attempt); throws NoCreditsError on an empty balance. */
export async function consumeBuildCredit(tx: Tx, barId: string, reference: string): Promise<number> {
  const [row] = await tx.update(barsTable)
    .set({ buildCredits: sql`${barsTable.buildCredits} - 1` })
    .where(and(eq(barsTable.id, barId), sql`${barsTable.buildCredits} > 0`))
    .returning({ buildCredits: barsTable.buildCredits });
  if (!row) throw new NoCreditsError();
  await tx.insert(creditLedgerTable).values({ id: randomUUID(), barId, delta: -1, reason: "build", reference });
  return row.buildCredits;
}

/**
 * Adds `quantity` credits once per (reason, reference). Returns false when that reference
 * was already applied, which is how a redelivered Stripe event or a second poll of the
 * same failed build changes nothing.
 */
export async function creditOnce(tx: Tx, barId: string, quantity: number, reason: string, reference: string): Promise<boolean> {
  const [entry] = await tx.insert(creditLedgerTable)
    .values({ id: randomUUID(), barId, delta: quantity, reason, reference })
    .onConflictDoNothing({ target: [creditLedgerTable.reason, creditLedgerTable.reference] })
    .returning({ id: creditLedgerTable.id });
  if (!entry) return false;
  await tx.update(barsTable).set({ buildCredits: sql`${barsTable.buildCredits} + ${quantity}` }).where(eq(barsTable.id, barId));
  return true;
}

export type RefundReason = "refund_start_failed" | "refund_rejected" | "refund_meshy_failed";

export async function refundBuildCredit(barId: string, reason: RefundReason, reference: string): Promise<boolean> {
  return db.transaction((tx) => creditOnce(tx, barId, 1, reason, reference));
}

export async function grantCredits(tx: Tx, barId: string, quantity: number, checkoutSessionId: string): Promise<boolean> {
  return creditOnce(tx, barId, quantity, "purchase", checkoutSessionId);
}

export type SlotRequest = { categoryLabel: string; categoryKey: string; neighborhoodLabel: string; neighborhoodKey: string };

const VENUE_TYPE_LABEL: Record<string, string> = { truck: "food truck", stand: "stand", restaurant: "restaurant" };

/** What a Business subscription would be exclusive for; throws a 400 when the account cannot have one. */
export function slotRequestFor(bar: Bar, category?: string): SlotRequest {
  if (bar.kind !== "venue") throw new BillingError("The Business plan is for venues, trucks and stands.", 400);
  const neighborhoodLabel = bar.neighborhood.trim();
  if (!neighborhoodLabel) throw new BillingError("Add your neighborhood in Settings first; that is what the exclusivity covers.", 400);
  const categoryLabel = (category?.trim() || VENUE_TYPE_LABEL[bar.venueType ?? ""] || "restaurant").slice(0, 40);
  return { categoryLabel, categoryKey: normalizeKey(categoryLabel), neighborhoodLabel, neighborhoodKey: normalizeKey(neighborhoodLabel) };
}

/**
 * Reserves the slot for this bar before Checkout opens. The unique index on
 * (category, neighborhood) decides who wins; a reservation nobody paid for expires.
 */
export async function reserveSlot(tx: Tx, bar: Bar, slot: SlotRequest, now = Date.now()): Promise<void> {
  await tx.delete(businessSlotsTable).where(and(
    isNull(businessSlotsTable.claimedAt), lt(businessSlotsTable.reservedAt, new Date(now - SLOT_RESERVATION_MS)),
  ));
  await tx.delete(businessSlotsTable).where(and(eq(businessSlotsTable.barId, bar.id), isNull(businessSlotsTable.claimedAt)));
  // Name a taken slot the way its holder spelled it, so the message reads like a real place.
  // (Looked up before the insert: a failed statement would abort the transaction.)
  const [holder] = await tx.select().from(businessSlotsTable).where(and(
    eq(businessSlotsTable.categoryKey, slot.categoryKey), eq(businessSlotsTable.neighborhoodKey, slot.neighborhoodKey),
  )).limit(1);
  if (holder) throw new SlotTakenError(holder.categoryLabel, holder.neighborhoodLabel);
  try {
    await tx.insert(businessSlotsTable).values({
      barId: bar.id, categoryKey: slot.categoryKey, neighborhoodKey: slot.neighborhoodKey,
      categoryLabel: slot.categoryLabel, neighborhoodLabel: slot.neighborhoodLabel, reservedAt: new Date(now),
    });
  } catch (error) {
    // Two partners asked for the same slot at the same instant; the index picked the other one.
    if (isUniqueViolation(error)) throw new SlotTakenError(slot.categoryLabel, slot.neighborhoodLabel);
    throw error;
  }
}

export async function claimSlot(tx: Tx, barId: string, now = Date.now()): Promise<void> {
  await tx.update(businessSlotsTable).set({ claimedAt: new Date(now) }).where(eq(businessSlotsTable.barId, barId));
}

export async function releaseSlot(tx: Tx, barId: string): Promise<void> {
  await tx.delete(businessSlotsTable).where(eq(businessSlotsTable.barId, barId));
}

export async function slotFor(barId: string) {
  const [slot] = await db.select().from(businessSlotsTable).where(eq(businessSlotsTable.barId, barId)).limit(1);
  return slot ?? null;
}
