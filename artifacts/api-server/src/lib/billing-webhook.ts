import { eq, or } from "drizzle-orm";
import { barsTable, billingEventsTable, db } from "@workspace/db";
import { claimSlot, grantCredits, releaseSlot, type Tx } from "./billing";
import { snapshotSubscription, type StripeEventLike, type StripeGateway } from "./stripe-gateway";
import { logger } from "./logger";

/**
 * Turns Stripe events into plan state. `bars.plan` is only ever written here (and by the
 * founding-partner SQL). Each event id is recorded first, in the same transaction as its
 * effects, so Stripe's retries and duplicate deliveries are harmless.
 */

/** Statuses that keep Business features on. past_due stays on while Stripe retries the card. */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const idOf = (value: unknown): string | null =>
  typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : null;

/** Returns false when the event was seen before, in which case nothing else happens. */
export async function recordAndApply(event: StripeEventLike, gateway: StripeGateway): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [fresh] = await tx.insert(billingEventsTable).values({ id: event.id, type: event.type })
      .onConflictDoNothing().returning({ id: billingEventsTable.id });
    if (!fresh) return false;
    await applyEvent(tx, event, gateway);
    return true;
  });
}

export async function applyEvent(tx: Tx, event: StripeEventLike, gateway: StripeGateway): Promise<void> {
  const object = event.data.object;
  const metadata = (object.metadata ?? {}) as Record<string, string | undefined>;
  switch (event.type) {
    case "checkout.session.completed": {
      const barId = metadata.barId ?? text(object.client_reference_id);
      const sessionId = text(object.id);
      if (!barId || !sessionId) return;
      const customerId = idOf(object.customer);
      if (customerId) await tx.update(barsTable).set({ stripeCustomerId: customerId }).where(eq(barsTable.id, barId));
      if (metadata.product === "credits") {
        if (object.payment_status !== "paid") return;
        const quantity = Math.max(1, Math.min(10, Number(metadata.quantity) || 1));
        await grantCredits(tx, barId, quantity, sessionId);
        return;
      }
      if (metadata.product === "business") {
        const subscriptionId = idOf(object.subscription);
        if (!subscriptionId) return;
        let currentPeriodEnd: Date | null = null;
        try {
          currentPeriodEnd = (await gateway.retrieveSubscription(subscriptionId)).currentPeriodEnd;
        } catch (error) {
          logger.warn({ err: error }, "Could not read the new subscription; period end will arrive with the next event");
        }
        await tx.update(barsTable).set({
          plan: "business", stripeSubscriptionId: subscriptionId, subscriptionStatus: "active", currentPeriodEnd,
        }).where(eq(barsTable.id, barId));
        await claimSlot(tx, barId);
      }
      return;
    }
    case "checkout.session.expired": {
      const barId = metadata.barId ?? text(object.client_reference_id);
      if (!barId || metadata.product !== "business") return;
      const [bar] = await tx.select({ stripeSubscriptionId: barsTable.stripeSubscriptionId }).from(barsTable).where(eq(barsTable.id, barId)).limit(1);
      if (bar && !bar.stripeSubscriptionId) await releaseSlot(tx, barId);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const snapshot = snapshotSubscription(object);
      const subscriptionId = text(object.id);
      if (!subscriptionId) return;
      const bar = await barForSubscription(tx, subscriptionId, snapshot.customerId, metadata.barId);
      if (!bar) return;
      const entitled = ENTITLED.has(snapshot.status);
      await tx.update(barsTable).set({
        plan: entitled ? "business" : "free",
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: snapshot.status,
        currentPeriodEnd: snapshot.currentPeriodEnd,
      }).where(eq(barsTable.id, bar.id));
      if (entitled) await claimSlot(tx, bar.id);
      else await releaseSlot(tx, bar.id);
      return;
    }
    case "customer.subscription.deleted": {
      const subscriptionId = text(object.id);
      const bar = subscriptionId ? await barForSubscription(tx, subscriptionId, idOf(object.customer), metadata.barId) : null;
      if (!bar) return;
      await tx.update(barsTable).set({
        plan: "free", stripeSubscriptionId: null, subscriptionStatus: "canceled", currentPeriodEnd: null,
      }).where(eq(barsTable.id, bar.id));
      await releaseSlot(tx, bar.id);
      return;
    }
    case "invoice.payment_failed": {
      const customerId = idOf(object.customer);
      if (!customerId) return;
      await tx.update(barsTable).set({ subscriptionStatus: "past_due" }).where(eq(barsTable.stripeCustomerId, customerId));
      logger.warn({ customerId }, "Stripe payment failed; Business features stay on while Stripe retries");
      return;
    }
    default:
      return;
  }
}

async function barForSubscription(tx: Tx, subscriptionId: string, customerId: string | null, barId: string | undefined) {
  const [bar] = await tx.select({ id: barsTable.id }).from(barsTable).where(or(
    eq(barsTable.stripeSubscriptionId, subscriptionId),
    customerId ? eq(barsTable.stripeCustomerId, customerId) : undefined,
    barId ? eq(barsTable.id, barId) : undefined,
  )).limit(1);
  return bar ?? null;
}
