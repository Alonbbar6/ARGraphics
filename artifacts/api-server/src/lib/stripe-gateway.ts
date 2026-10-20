import Stripe from "stripe";

/**
 * The only file that talks to Stripe. Everything else goes through the StripeGateway
 * interface, which tests replace with a fake; no test ever reaches stripe.com.
 *
 * Configuration is read at call time, like MESHY_API_KEY: with any of the five variables
 * missing, `getStripeGateway()` is null and the billing routes answer 503.
 */

export type BillingConfig = {
  secretKey: string;
  webhookSecret: string;
  priceBusinessMonthly: string;
  priceBuildCredit: string;
  appUrl: string;
};

export function billingConfig(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const priceBusinessMonthly = process.env.STRIPE_PRICE_BUSINESS_MONTHLY;
  const priceBuildCredit = process.env.STRIPE_PRICE_BUILD_CREDIT;
  const appUrl = (process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!secretKey || !webhookSecret || !priceBusinessMonthly || !priceBuildCredit || !appUrl) return null;
  return { secretKey, webhookSecret, priceBusinessMonthly, priceBuildCredit, appUrl };
}

export type CheckoutSessionInput = {
  mode: "subscription" | "payment";
  customerId: string;
  priceId: string;
  quantity: number;
  barId: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds; Stripe allows 30 minutes to 24 hours. */
  expiresAt?: number;
};

/** The parts of a Stripe event the webhook handler reads; the real object is a superset. */
export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type SubscriptionSnapshot = {
  status: string;
  customerId: string | null;
  currentPeriodEnd: Date | null;
};

export interface StripeGateway {
  ensureCustomer(bar: { id: string; name: string; stripeCustomerId: string | null }, email: string): Promise<string>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ id: string; url: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verifies the signature against the raw body; throws when it does not match. */
  constructEvent(rawBody: Buffer, signature: string | undefined): StripeEventLike;
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
}

let cached: { key: string; gateway: StripeGateway } | null = null;

export function getStripeGateway(): StripeGateway | null {
  const config = billingConfig();
  if (!config) return null;
  if (cached?.key === config.secretKey) return cached.gateway;
  const stripe = new Stripe(config.secretKey);
  const gateway: StripeGateway = {
    async ensureCustomer(bar, email) {
      if (bar.stripeCustomerId) return bar.stripeCustomerId;
      const customer = await stripe.customers.create({ name: bar.name, email, metadata: { barId: bar.id } });
      return customer.id;
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: input.mode,
        customer: input.customerId,
        client_reference_id: input.barId,
        line_items: [{ price: input.priceId, quantity: input.quantity }],
        metadata: input.metadata,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
        ...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : {}),
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
      return { id: session.id, url: session.url };
    },
    async createPortalSession(customerId, returnUrl) {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return { url: session.url };
    },
    constructEvent(rawBody, signature) {
      if (!signature) throw new Error("Missing Stripe signature.");
      return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret) as unknown as StripeEventLike;
    },
    async retrieveSubscription(subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return snapshotSubscription(subscription as unknown as Record<string, unknown>);
    },
  };
  cached = { key: config.secretKey, gateway };
  return gateway;
}

/**
 * Reads what we keep from a subscription object. Newer Stripe API versions put the period
 * end on each subscription item; older ones kept it on the subscription. Accept both.
 */
export function snapshotSubscription(subscription: Record<string, unknown>): SubscriptionSnapshot {
  const customer = subscription.customer;
  const customerId = typeof customer === "string" ? customer
    : customer && typeof customer === "object" && typeof (customer as { id?: unknown }).id === "string" ? (customer as { id: string }).id : null;
  const items = subscription.items as { data?: Array<{ current_period_end?: number }> } | undefined;
  const periodEnd = items?.data?.[0]?.current_period_end ?? (subscription.current_period_end as number | undefined);
  return {
    status: typeof subscription.status === "string" ? subscription.status : "unknown",
    customerId,
    currentPeriodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
  };
}
