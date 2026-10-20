import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { expectResponseContract } from "./support/response-contracts";
import type { StripeEventLike, StripeGateway } from "../src/lib/stripe-gateway";
import { normalizeKey } from "../src/lib/billing";
import { DAY_MS, attemptsSoFar } from "../src/lib/throttle";

/**
 * A stand-in for Stripe. `constructEvent` returns the raw body parsed as JSON, so tests
 * post hand-made events; nothing here ever reaches stripe.com (global fetch is blocked).
 */
const fake = {
  configured: true,
  checkouts: [] as Array<Record<string, unknown>>,
  gateway: {
    ensureCustomer: vi.fn(async (bar: { id: string; stripeCustomerId: string | null }) => bar.stripeCustomerId ?? `cus_${bar.id}`),
    createCheckoutSession: vi.fn(async (input: Record<string, unknown>) => {
      fake.checkouts.push(input);
      return { id: `cs_${fake.checkouts.length}`, url: "https://checkout.stripe.test/session" };
    }),
    createPortalSession: vi.fn(async () => ({ url: "https://billing.stripe.test/portal" })),
    constructEvent: vi.fn((rawBody: Buffer, signature: string | undefined): StripeEventLike => {
      if (!Buffer.isBuffer(rawBody)) throw new Error("expected a Buffer");
      if (signature !== "good") throw new Error("bad signature");
      return JSON.parse(rawBody.toString("utf8")) as StripeEventLike;
    }),
    retrieveSubscription: vi.fn(async () => ({ status: "active", customerId: "cus_x", currentPeriodEnd: new Date("2026-11-20T00:00:00Z") })),
  } satisfies StripeGateway,
};

vi.mock("../src/lib/stripe-gateway", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/stripe-gateway")>("../src/lib/stripe-gateway");
  return {
    ...actual,
    billingConfig: () => (fake.configured ? {
      secretKey: "sk_test_fixture", webhookSecret: "whsec_fixture", priceBusinessMonthly: "price_business",
      priceBuildCredit: "price_credit", appUrl: "https://app.argraphics.test",
    } : null),
    getStripeGateway: () => (fake.configured ? fake.gateway : null),
  };
});

const BAR = "argraphics-demo-bar";

function createDisplay(cookie: string, body: Record<string, unknown>) {
  return request(app).post("/api/displays").set("Cookie", cookie)
    .send({ type: "promo_offer", placement: "table", title: "Slow Wednesday", offer: { title: "Free agua fresca" }, ...body });
}

function webhook(event: Record<string, unknown>, signature = "good") {
  return request(app).post("/api/billing/webhook").set("stripe-signature", signature)
    .set("content-type", "application/json").send(JSON.stringify(event));
}

async function bar(id = BAR) {
  const [row] = await db.select().from(schema.barsTable).where(eq(schema.barsTable.id, id)).limit(1);
  return row;
}

async function setBar(values: Partial<typeof schema.barsTable.$inferInsert>, id = BAR) {
  await db.update(schema.barsTable).set(values).where(eq(schema.barsTable.id, id));
}

beforeEach(() => {
  fake.configured = true;
  fake.checkouts = [];
});

describe("live display limit", () => {
  it("lets a free account have three live displays and blocks the fourth", async () => {
    const cookie = await signIn();
    for (const title of ["One", "Two", "Three"]) await createDisplay(cookie, { title, status: "live" }).expect(201);
    const blocked = await createDisplay(cookie, { title: "Four", status: "live" }).expect(402);
    expect(blocked.body).toMatchObject({ code: "plan_limit" });
    expect(blocked.body.error).toMatch(/3 displays live/);
    // A draft is always fine, and publishing it later hits the same wall.
    const draft = await createDisplay(cookie, { title: "Draft", status: "draft" }).expect(201);
    const publish = await request(app).patch(`/api/displays/${draft.body.id}`).set("Cookie", cookie).send({ status: "live" }).expect(402);
    expect(publish.body.code).toBe("plan_limit");
    // Pausing one makes room again.
    const [first] = await db.select().from(schema.displaysTable).where(eq(schema.displaysTable.title, "One")).limit(1);
    await request(app).patch(`/api/displays/${first.id}`).set("Cookie", cookie).send({ status: "paused" }).expect(200);
    await request(app).patch(`/api/displays/${draft.body.id}`).set("Cookie", cookie).send({ status: "live" }).expect(200);
    // Editing a live display without changing its status is not a new go-live.
    await request(app).patch(`/api/displays/${draft.body.id}`).set("Cookie", cookie).send({ title: "Renamed" }).expect(200);
  });

  it("does not limit Business or founding partners", async () => {
    const cookie = await signIn();
    await setBar({ foundingUntil: new Date("2027-01-01T00:00:00Z") });
    for (let index = 0; index < 5; index++) await createDisplay(cookie, { title: `F${index}`, status: "live" }).expect(201);
    await setBar({ foundingUntil: new Date("2020-01-01T00:00:00Z"), plan: "business" });
    await createDisplay(cookie, { title: "Six", status: "live" }).expect(201);
    await setBar({ plan: "free" });
    await createDisplay(cookie, { title: "Seven", status: "live" }).expect(402);
  });
});

describe("plan state", () => {
  it("reports plan, limits, credits and configuration", async () => {
    const cookie = await signIn();
    await createDisplay(cookie, { title: "Live", status: "live" }).expect(201);
    await setBar({ buildCredits: 4 });
    const response = await request(app).get("/api/billing/plan").set("Cookie", cookie).expect(200);
    expectResponseContract("getBillingPlan", 200, response.body);
    expect(response.body).toMatchObject({
      plan: "free", effective: "free", liveDisplays: 1, liveDisplayLimit: 3, buildCredits: 4, buildsIncluded: false,
      slot: null, checkoutAvailable: true, portalAvailable: false, prices: { businessMonthlyCents: 15000, buildCreditCents: 500 },
    });
    await setBar({ foundingUntil: new Date("2027-06-30T00:00:00Z") });
    const founding = await request(app).get("/api/billing/plan").set("Cookie", cookie).expect(200);
    expect(founding.body).toMatchObject({ effective: "founding", liveDisplayLimit: null, buildsIncluded: true, foundingUntil: "2027-06-30T00:00:00.000Z" });
  });

  it("shows the plan on the session and profile, and registers creators", async () => {
    const cookie = await signIn();
    await setBar({ plan: "business" });
    const session = await request(app).get("/api/auth/session").set("Cookie", cookie).expect(200);
    expectResponseContract("getSession", 200, session.body);
    expect(session.body).toMatchObject({ partnerKind: "venue", plan: "business" });
    const profile = await request(app).get("/api/partner/profile").set("Cookie", cookie).expect(200);
    expectResponseContract("getPartnerProfile", 200, profile.body);
    expect(profile.body.plan).toBe("business");

    const creator = await request(app).post("/api/auth/register")
      .send({ name: "Sam Maker", barName: "Sam's models", email: "sam@example.test", password: "a-long-enough-password", kind: "creator" })
      .expect(201);
    expect(creator.body).toMatchObject({ partnerKind: "creator", plan: "free" });
    const creatorCookie = (creator.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const creatorProfile = await request(app).get("/api/partner/profile").set("Cookie", creatorCookie).expect(200);
    expect(creatorProfile.body).toMatchObject({ kind: "creator", venueType: null, plan: "free" });
  });

  it("answers 503 when billing is not configured", async () => {
    fake.configured = false;
    const cookie = await signIn();
    const plan = await request(app).get("/api/billing/plan").set("Cookie", cookie).expect(200);
    expect(plan.body.checkoutAvailable).toBe(false);
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "credits" }).expect(503);
    await request(app).post("/api/billing/portal").set("Cookie", cookie).expect(503);
    await webhook({ id: "evt_1", type: "ping", data: { object: {} } }).expect(503);
  });
});

describe("checkout and exclusivity", () => {
  it("sells credits in a payment-mode checkout", async () => {
    const cookie = await signIn();
    const response = await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "credits", quantity: 3 }).expect(200);
    expectResponseContract("createCheckout", 200, response.body);
    expect(response.body.url).toBe("https://checkout.stripe.test/session");
    expect(fake.checkouts[0]).toMatchObject({ mode: "payment", priceId: "price_credit", quantity: 3, metadata: { product: "credits", quantity: "3" } });
    expect((await bar()).stripeCustomerId).toBe(`cus_${BAR}`);
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "credits", quantity: 11 }).expect(400);
  });

  it("reserves one (category, neighborhood) slot per Business subscription", async () => {
    await setBar({ neighborhood: "Little Havana", venueType: "truck" });
    await setBar({ neighborhood: "little  havana ", venueType: "truck" }, "other-bar");
    const cookie = await signIn();
    const other = await signIn("other@example.test");

    const first = await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business", category: "Tacos" }).expect(200);
    expect(first.body.url).toBeDefined();
    expect(fake.checkouts[0]).toMatchObject({ mode: "subscription", priceId: "price_business", metadata: { product: "business", categoryKey: "tacos", neighborhoodKey: "little havana" } });

    const taken = await request(app).post("/api/billing/checkout").set("Cookie", other).send({ product: "business", category: "tacos" }).expect(409);
    expect(taken.body.error).toMatch(/Another Tacos business already has Little Havana/);
    // A different category in the same neighborhood is free to claim.
    await request(app).post("/api/billing/checkout").set("Cookie", other).send({ product: "business", category: "coffee" }).expect(200);
    // The default category is the venue type.
    await db.delete(schema.businessSlotsTable);
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(200);
    expect(fake.checkouts.at(-1)).toMatchObject({ metadata: { categoryKey: "food truck" } });
  });

  it("refuses the Business plan without a neighborhood, for artists, and when already subscribed", async () => {
    const cookie = await signIn();
    const missing = await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(400);
    expect(missing.body.error).toMatch(/neighborhood/);
    await setBar({ neighborhood: "Wynwood", kind: "artist" });
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(400);
    await setBar({ kind: "venue", plan: "business" });
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(409);
  });

  it("releases the slot when Stripe cannot open the checkout", async () => {
    await setBar({ neighborhood: "Wynwood" });
    const cookie = await signIn();
    fake.gateway.createCheckoutSession.mockRejectedValueOnce(new Error("stripe down"));
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(502);
    expect(await db.select().from(schema.businessSlotsTable)).toEqual([]);
  });

  it("opens the portal only once there is a customer", async () => {
    const cookie = await signIn();
    await request(app).post("/api/billing/portal").set("Cookie", cookie).expect(404);
    await setBar({ stripeCustomerId: "cus_existing" });
    const response = await request(app).post("/api/billing/portal").set("Cookie", cookie).expect(200);
    expect(response.body.url).toBe("https://billing.stripe.test/portal");
    expect(fake.gateway.createPortalSession).toHaveBeenCalledWith("cus_existing", "https://app.argraphics.test/plan");
  });
});

describe("webhook", () => {
  const creditsPaid = (id: string, quantity: number, sessionId = "cs_credits") => ({
    id, type: "checkout.session.completed",
    data: { object: { id: sessionId, mode: "payment", payment_status: "paid", customer: "cus_demo", client_reference_id: BAR, metadata: { barId: BAR, product: "credits", quantity: String(quantity) } } },
  });

  it("grants purchased credits once, even when Stripe delivers the event twice", async () => {
    await setBar({ buildCredits: 0 });
    await webhook(creditsPaid("evt_credits", 3)).expect(200);
    expect((await bar()).buildCredits).toBe(3);
    await webhook(creditsPaid("evt_credits", 3)).expect(200);
    // Same checkout session under a new event id (a replay from the dashboard) still counts once.
    await webhook(creditsPaid("evt_credits_replay", 3)).expect(200);
    expect((await bar()).buildCredits).toBe(3);
    expect(await db.select().from(schema.billingEventsTable)).toHaveLength(2);
    const ledger = await db.select().from(schema.creditLedgerTable);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ barId: BAR, delta: 3, reason: "purchase" });
    expect((await bar()).stripeCustomerId).toBe("cus_demo");
  });

  it("turns a completed Business checkout into the plan and the slot, and ends it on cancellation", async () => {
    await setBar({ neighborhood: "Little Havana", venueType: "truck" });
    const cookie = await signIn();
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(200);
    await webhook({
      id: "evt_biz", type: "checkout.session.completed",
      data: { object: { id: "cs_biz", mode: "subscription", customer: "cus_demo", subscription: "sub_1", metadata: { barId: BAR, product: "business" } } },
    }).expect(200);
    let row = await bar();
    expect(row).toMatchObject({ plan: "business", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" });
    expect(row.currentPeriodEnd?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    const plan = await request(app).get("/api/billing/plan").set("Cookie", cookie).expect(200);
    expect(plan.body).toMatchObject({ effective: "business", liveDisplayLimit: null, slot: { category: "food truck", neighborhood: "Little Havana" }, portalAvailable: true });

    await webhook({ id: "evt_fail", type: "invoice.payment_failed", data: { object: { customer: "cus_demo" } } }).expect(200);
    row = await bar();
    expect(row).toMatchObject({ plan: "business", subscriptionStatus: "past_due" });

    await webhook({ id: "evt_upd", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_demo", status: "unpaid", items: { data: [{ current_period_end: 1800000000 }] } } } }).expect(200);
    row = await bar();
    expect(row).toMatchObject({ plan: "free", subscriptionStatus: "unpaid" });
    expect(await db.select().from(schema.businessSlotsTable)).toEqual([]);

    await webhook({ id: "evt_back", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_demo", status: "active" } } }).expect(200);
    expect((await bar()).plan).toBe("business");
    await webhook({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_demo", status: "canceled" } } }).expect(200);
    row = await bar();
    expect(row).toMatchObject({ plan: "free", stripeSubscriptionId: null, subscriptionStatus: "canceled" });
  });

  it("frees a reserved slot when the checkout expires unpaid", async () => {
    await setBar({ neighborhood: "Wynwood" });
    const cookie = await signIn();
    await request(app).post("/api/billing/checkout").set("Cookie", cookie).send({ product: "business" }).expect(200);
    expect(await db.select().from(schema.businessSlotsTable)).toHaveLength(1);
    await webhook({ id: "evt_exp", type: "checkout.session.expired", data: { object: { id: "cs_1", metadata: { barId: BAR, product: "business" } } } }).expect(200);
    expect(await db.select().from(schema.businessSlotsTable)).toEqual([]);
  });

  it("rejects a bad signature and a parsed body", async () => {
    await setBar({ buildCredits: 0 });
    await webhook(creditsPaid("evt_bad", 1), "forged").expect(400);
    expect((await bar()).buildCredits).toBe(0);
    expect(fake.gateway.constructEvent).toHaveBeenCalled();
    const [rawBody] = fake.gateway.constructEvent.mock.calls.at(-1)!;
    expect(Buffer.isBuffer(rawBody)).toBe(true);
  });
});

describe("build credits", () => {
  const generationBody = { sourcePhotoPath: "/objects/uploads/11111111-1111-4111-8111-111111111111", cleanedPhotoPath: "/objects/uploads/22222222-2222-4222-8222-222222222222" };

  beforeEach(async () => {
    vi.stubEnv("MESHY_API_KEY", "meshy-fixture-key");
    await db.update(schema.drinksTable).set({ sourcePhotoUrl: generationBody.sourcePhotoPath, cleanedPhotoUrl: generationBody.cleanedPhotoPath })
      .where(eq(schema.drinksTable.id, "fixture-drink"));
  });

  it("asks a free account for credits before spending a daily attempt", async () => {
    const cookie = await signIn();
    await setBar({ buildCredits: 0 });
    const response = await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send(generationBody).expect(402);
    expect(response.body).toMatchObject({ code: "no_credits" });
    expect(await attemptsSoFar("generation", BAR, { windowMs: DAY_MS, now: new Date(Date.now()) })).toBe(0);
  });

  it("gives the credit back when the build cannot start, once", async () => {
    const cookie = await signIn();
    await setBar({ buildCredits: 2 });
    // The photos are not in storage, so validation fails after the credit was taken.
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send(generationBody).expect(400);
    expect((await bar()).buildCredits).toBe(2);
    const ledger = await db.select().from(schema.creditLedgerTable).orderBy(schema.creditLedgerTable.delta);
    expect(ledger.map((entry) => [entry.delta, entry.reason])).toEqual([[-1, "build"], [1, "refund_start_failed"]]);
  });

  it("never charges Business or founding partners", async () => {
    const cookie = await signIn();
    await setBar({ plan: "business", buildCredits: 0 });
    // Fails on photo validation (400), not on credits (402).
    await request(app).post("/api/drinks/fixture-drink/generation").set("Cookie", cookie).send(generationBody).expect(400);
    expect(await db.select().from(schema.creditLedgerTable)).toEqual([]);
  });
});

describe("normalizeKey", () => {
  it("matches spellings that mean the same place", () => {
    expect(normalizeKey("Little  Havana ")).toBe("little havana");
    expect(normalizeKey("Ñuñoa")).toBe("nunoa");
    expect(normalizeKey("TACOS")).toBe("tacos");
  });
});
