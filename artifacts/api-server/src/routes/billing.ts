import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { CreateBillingPortalResponse, CreateCheckoutBody, CreateCheckoutResponse, GetBillingPlanResponse } from "@workspace/api-zod";
import { barsTable, db, usersTable } from "@workspace/db";
import {
  BUILD_CREDIT_CENTS, BUSINESS_MONTHLY_CENTS, BillingError, MAX_CREDITS_PER_CHECKOUT, PLAN_LIVE_LIMIT_FREE,
  buildsIncluded, countLiveDisplays, effectivePlan, hasUnlimitedDisplays, releaseSlot, reserveSlot, slotFor, slotRequestFor,
} from "../lib/billing";
import { recordAndApply } from "../lib/billing-webhook";
import { billingConfig, getStripeGateway } from "../lib/stripe-gateway";
import { partner } from "./partners";

const router: IRouter = Router();
const NOT_CONFIGURED = "Billing is not set up yet. Email hello@argraphics.app and we will sort your plan by hand.";
const CHECKOUT_MINUTES = 30;

router.get("/billing/plan", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const slot = await slotFor(bar.id);
  const configured = billingConfig() !== null;
  res.json(GetBillingPlanResponse.parse({
    plan: bar.plan === "business" ? "business" : "free",
    effective: effectivePlan(bar),
    foundingUntil: bar.foundingUntil?.toISOString() ?? null,
    liveDisplays: await countLiveDisplays(db, bar.id),
    liveDisplayLimit: hasUnlimitedDisplays(bar) ? null : PLAN_LIVE_LIMIT_FREE,
    buildCredits: bar.buildCredits,
    buildsIncluded: buildsIncluded(bar),
    subscriptionStatus: bar.subscriptionStatus,
    currentPeriodEnd: bar.currentPeriodEnd?.toISOString() ?? null,
    slot: slot?.claimedAt ? { category: slot.categoryLabel, neighborhood: slot.neighborhoodLabel } : null,
    checkoutAvailable: configured,
    portalAvailable: configured && Boolean(bar.stripeCustomerId),
    prices: { businessMonthlyCents: BUSINESS_MONTHLY_CENTS, buildCreditCents: BUILD_CREDIT_CENTS },
  }));
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose the Business plan or a number of build credits." });
    return;
  }
  const gateway = getStripeGateway();
  const config = billingConfig();
  if (!gateway || !config) {
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }
  const [owner] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.barId, bar.id)).limit(1);
  const successUrl = `${config.appUrl}/plan?checkout=success`;
  const cancelUrl = `${config.appUrl}/plan?checkout=cancelled`;
  const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60;

  try {
    if (parsed.data.product === "business") {
      if (bar.plan === "business") {
        res.status(409).json({ error: "You are already on the Business plan." });
        return;
      }
      const slot = slotRequestFor(bar, parsed.data.category);
      await db.transaction((tx) => reserveSlot(tx, bar, slot));
      try {
        const customerId = await gateway.ensureCustomer(bar, owner?.email ?? "");
        if (customerId !== bar.stripeCustomerId) await db.update(barsTable).set({ stripeCustomerId: customerId }).where(eq(barsTable.id, bar.id));
        const session = await gateway.createCheckoutSession({
          mode: "subscription", customerId, priceId: config.priceBusinessMonthly, quantity: 1, barId: bar.id,
          metadata: { barId: bar.id, product: "business", categoryKey: slot.categoryKey, neighborhoodKey: slot.neighborhoodKey },
          successUrl, cancelUrl, expiresAt,
        });
        res.json(CreateCheckoutResponse.parse({ url: session.url }));
      } catch (error) {
        // Nobody should hold a slot they could not even start paying for.
        await db.transaction((tx) => releaseSlot(tx, bar.id));
        throw error;
      }
      return;
    }
    const quantity = Math.max(1, Math.min(MAX_CREDITS_PER_CHECKOUT, parsed.data.quantity ?? 1));
    const customerId = await gateway.ensureCustomer(bar, owner?.email ?? "");
    if (customerId !== bar.stripeCustomerId) await db.update(barsTable).set({ stripeCustomerId: customerId }).where(eq(barsTable.id, bar.id));
    const session = await gateway.createCheckoutSession({
      mode: "payment", customerId, priceId: config.priceBuildCredit, quantity, barId: bar.id,
      metadata: { barId: bar.id, product: "credits", quantity: String(quantity) },
      successUrl, cancelUrl, expiresAt,
    });
    res.json(CreateCheckoutResponse.parse({ url: session.url }));
  } catch (error) {
    if (error instanceof BillingError) {
      res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    req.log.error({ err: error }, "Stripe Checkout could not be created");
    res.status(502).json({ error: "Stripe could not be reached. Try again in a moment." });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  const bar = await partner(req, res);
  if (!bar) return;
  const gateway = getStripeGateway();
  const config = billingConfig();
  if (!gateway || !config) {
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }
  if (!bar.stripeCustomerId) {
    res.status(404).json({ error: "There is no billing account for this partner yet." });
    return;
  }
  try {
    const session = await gateway.createPortalSession(bar.stripeCustomerId, `${config.appUrl}/plan`);
    res.json(CreateBillingPortalResponse.parse({ url: session.url }));
  } catch (error) {
    req.log.error({ err: error }, "Stripe portal session could not be created");
    res.status(502).json({ error: "Stripe could not be reached. Try again in a moment." });
  }
});

/**
 * Mounted in app.ts ahead of the JSON parser with express.raw, so `req.body` is the exact
 * bytes Stripe signed. Do not move it under the /api router.
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const gateway = getStripeGateway();
  if (!gateway) {
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "The webhook needs the raw request body." });
    return;
  }
  let event;
  try {
    event = gateway.constructEvent(req.body, req.get("stripe-signature"));
  } catch {
    res.status(400).json({ error: "Bad Stripe signature." });
    return;
  }
  try {
    const applied = await recordAndApply(event, gateway);
    res.json({ message: applied ? "ok" : "already handled" });
  } catch (error) {
    // A 500 makes Stripe retry, and the event row was rolled back with the failed transaction.
    req.log.error({ err: error, eventId: event.id, eventType: event.type }, "Stripe event could not be applied");
    res.status(500).json({ error: "The event could not be applied." });
  }
}

export default router;
