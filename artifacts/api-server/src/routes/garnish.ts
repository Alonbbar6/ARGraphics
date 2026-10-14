import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, arEventsTable, barsTable, drinksTable, menuVersionTable, tableCardsTable, usersTable } from "@workspace/db";
import {
  CreatePublicEventParams,
  CreatePublicEventResponse,
  CreateDrinkBody,
  CreatePublicEventBody,
  DeleteDrinkParams,
  GetPublicTableCardsParams,
  GetInsightsResponse,
  GetPublicMenuParams,
  GetPublicMenuResponse,
  GetPublicMenuVersionParams,
  GetPublicMenuVersionResponse,
  GetPublicTableCardsResponse,
  GetSessionResponse,
  ListDrinksResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  UpdateDrinkBody,
  UpdateDrinkParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const demoBarId = "garnish-demo-bar";
const demoSlug = "demo-bar";
const sessionCookie = "garnish_session";

function signSession(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for sign-in.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getCookie(req: Request, key: string): string | undefined {
  return req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))?.slice(key.length + 1);
}

export async function currentUser(req: Request) {
  const token = getCookie(req, sessionCookie);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(signSession(payload));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; expiresAt: number };
    if (data.expiresAt < Date.now()) return null;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, data.userId)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
}

async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await currentUser(req))) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  next();
}

function requireIosKey(req: Request, res: Response): boolean {
  const secret = process.env.IOS_API_KEY;
  if (!secret) {
    res.status(503).json({ error: "The iOS menu connection is not configured yet." });
    return false;
  }
  const supplied = Buffer.from(req.get("x-api-key") ?? "");
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Invalid API key." });
    return false;
  }
  return true;
}

const iosRateWindows = new Map<string, { count: number; resetAt: number }>();
function rateLimitIos(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = iosRateWindows.get(key);
  if (!current || current.resetAt <= now) {
    iosRateWindows.set(key, { count: 1, resetAt: now + 60_000 });
  } else if (current.count >= 120) {
    res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many iOS API requests. Try again shortly." });
    return;
  } else {
    current.count += 1;
  }
  if (iosRateWindows.size > 2_000) {
    for (const [address, window] of iosRateWindows) {
      if (window.resetAt <= now) iosRateWindows.delete(address);
    }
  }
  next();
}

router.use("/v1/bars", rateLimitIos);

router.get("/auth/session", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) {
    res.json(GetSessionResponse.parse({ authenticated: false, userName: null, barName: null, barSlug: null }));
    return;
  }
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.id, user.barId)).limit(1);
  res.json(GetSessionResponse.parse({
    authenticated: true,
    userName: user.name,
    barName: bar?.name ?? null,
    barSlug: bar?.slug ?? null,
  }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password did not match." });
    return;
  }
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  const signature = signSession(payload);
  res.setHeader("Set-Cookie", `${sessionCookie}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.id, user.barId)).limit(1);
  res.json(LoginResponse.parse({
    authenticated: true,
    userName: user.name,
    barName: bar?.name ?? null,
    barSlug: bar?.slug ?? null,
  }));
});

router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.use(["/drinks", "/insights"], requireOwner);

function asDrink(drink: typeof drinksTable.$inferSelect) {
  return {
    id: drink.id,
    name: drink.name,
    description: drink.description,
    priceCents: drink.priceCents,
    category: drink.category,
    isAvailable: drink.isAvailable,
    isPublished: drink.isPublished,
    sortOrder: drink.sortOrder,
    thumbnailUrl: drink.thumbnailUrl,
    generationStatus: drink.generationStatus,
    updatedAt: drink.updatedAt.toISOString(),
  };
}

async function bumpMenuVersion() {
  await db.insert(menuVersionTable).values({ barId: demoBarId, version: 2 })
    .onConflictDoUpdate({
      target: menuVersionTable.barId,
      set: { version: sql`${menuVersionTable.version} + 1` },
    });
}

router.get("/drinks", async (_req, res): Promise<void> => {
  const drinks = await db.select().from(drinksTable)
    .where(eq(drinksTable.barId, demoBarId)).orderBy(asc(drinksTable.sortOrder));
  res.json(ListDrinksResponse.parse(drinks.map(asDrink)));
});

router.post("/drinks", async (req, res): Promise<void> => {
  const parsed = CreateDrinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [drink] = await db.insert(drinksTable).values({
    id: randomUUID(),
    barId: demoBarId,
    ...parsed.data,
    sortOrder: Date.now(),
  }).returning();
  res.status(201).json(asDrink(drink));
});

router.patch("/drinks/:id", async (req, res): Promise<void> => {
  const params = UpdateDrinkParams.safeParse(req.params);
  const body = UpdateDrinkBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Check the drink details and try again." });
    return;
  }
  const [drink] = await db.update(drinksTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(drinksTable.id, params.data.id), eq(drinksTable.barId, demoBarId)))
    .returning();
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  if (body.data.priceCents !== undefined || body.data.isPublished !== undefined || body.data.isAvailable !== undefined) {
    await bumpMenuVersion();
  }
  res.json(asDrink(drink));
});

router.delete("/drinks/:id", async (req, res): Promise<void> => {
  const params = DeleteDrinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [drink] = await db.delete(drinksTable)
    .where(and(eq(drinksTable.id, params.data.id), eq(drinksTable.barId, demoBarId)))
    .returning();
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  await bumpMenuVersion();
  res.json({ message: "Drink deleted." });
});

router.get("/insights", async (_req, res): Promise<void> => {
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.id, demoBarId)).limit(1);
  const drinks = await db.select().from(drinksTable).where(eq(drinksTable.barId, demoBarId));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await db.select().from(arEventsTable)
    .where(and(eq(arEventsTable.barId, demoBarId), gte(arEventsTable.createdAt, weekAgo)));
  const viewsByDrink = drinks.map((drink) => ({
    drinkName: drink.name,
    views: events.filter((event) => event.drinkId === drink.id && event.eventType === "view").length,
  })).sort((a, b) => b.views - a.views).slice(0, 6);
  res.json(GetInsightsResponse.parse({
    viewsThisWeek: events.filter((event) => event.eventType === "view").length,
    mostViewedDrink: viewsByDrink[0]?.drinkName ?? null,
    publishedSignatures: drinks.filter((drink) => drink.category === "signature" && drink.isPublished).length,
    lastMenuUpdate: bar?.createdAt.toISOString() ?? null,
    viewsByDrink,
  }));
});

router.get("/v1/bars/:slug/menu-version", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicMenuVersionParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  if (!bar) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const [version] = await db.select().from(menuVersionTable).where(eq(menuVersionTable.barId, bar.id));
  res.json(GetPublicMenuVersionResponse.parse({ version: version?.version ?? 1 }));
});

router.get("/v1/bars/:slug/menu", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicMenuParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const [bar] = await db.select().from(barsTable).where(eq(barsTable.slug, params.data.slug));
  if (!bar) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const drinks = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.barId, bar.id), eq(drinksTable.isPublished, true), eq(drinksTable.isAvailable, true)))
    .orderBy(asc(drinksTable.sortOrder));
  res.json(GetPublicMenuResponse.parse({
    barName: bar.name,
    logoUrl: bar?.logoUrl ?? null,
    drinks: drinks.map((drink) => ({
      id: drink.id,
      name: drink.name,
      description: drink.description,
      price: `$${(drink.priceCents / 100).toFixed(2)}`,
      priceCents: drink.priceCents,
      category: drink.category,
      thumbnailUrl: drink.thumbnailUrl,
      modelUsdzUrl: drink.modelUsdzUrl,
      modelGlbUrl: drink.modelGlbUrl,
      updatedAt: drink.updatedAt.toISOString(),
    })),
  }));
});

router.get("/v1/bars/:slug/table-cards", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = GetPublicTableCardsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid bar slug." });
    return;
  }
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  if (!bar) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const cards = await db.select().from(tableCardsTable)
    .where(and(eq(tableCardsTable.barId, bar.id), eq(tableCardsTable.isActive, true)))
    .orderBy(asc(tableCardsTable.createdAt));
  const storage = new ObjectStorageService();
  const response = await Promise.all(cards.map(async (card) => ({
    id: card.id,
    name: card.name,
    referenceImageUrl: await storage.getObjectEntityDownloadURL(card.referenceImageUrl),
    physicalWidthCm: Number(card.physicalWidthMeters) * 100,
  })));
  res.json(GetPublicTableCardsResponse.parse(response));
});

router.post("/v1/bars/:slug/events", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = CreatePublicEventParams.safeParse(req.params);
  const body = CreatePublicEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid bar, drink, and event type." });
    return;
  }
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  if (!bar) {
    res.status(404).json({ error: "Bar not found." });
    return;
  }
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  await db.insert(arEventsTable).values({
    id: randomUUID(),
    barId: bar.id,
    drinkId: drink.id,
    eventType: body.data.eventType,
  });
  res.status(201).json(CreatePublicEventResponse.parse({ message: "Event recorded." }));
});

async function seedDemoBar() {
  await db.insert(barsTable).values({
    id: demoBarId,
    name: "Demo Bar",
    slug: demoSlug,
  }).onConflictDoNothing();
  const [demoUser] = await db.select().from(usersTable)
    .where(eq(usersTable.email, "demo@garnish.app")).limit(1);
  if (!demoUser) {
    await db.insert(usersTable).values({
      id: randomUUID(),
      barId: demoBarId,
      email: "demo@garnish.app",
      passwordHash: await bcrypt.hash("Garnish-demo-2026!", 12),
      name: "Alex Morgan",
    });
  }
  const existing = await db.select().from(drinksTable).where(eq(drinksTable.barId, demoBarId)).limit(1);
  if (existing.length) return;
  await db.insert(drinksTable).values([
    { id: "demo-cocktail-1", barId: demoBarId, name: "Blood Orange Spritz", description: "Blood orange, prosecco, rosemary", priceCents: 1600, category: "signature", isPublished: true, sortOrder: 1 },
    { id: "demo-cocktail-2", barId: demoBarId, name: "Velvet Negroni", description: "Gin, bitter orange, sweet vermouth", priceCents: 1800, category: "signature", isPublished: true, sortOrder: 2 },
    { id: "demo-cocktail-3", barId: demoBarId, name: "Last Word", description: "Gin, green chartreuse, maraschino, lime", priceCents: 1700, category: "classic", isPublished: false, sortOrder: 3 },
    { id: "demo-cocktail-4", barId: demoBarId, name: "Garden Gimlet", description: "Cucumber, basil, lime, house gin", priceCents: 1500, category: "seasonal", isPublished: false, sortOrder: 4 },
  ]).onConflictDoNothing();
  await db.insert(menuVersionTable).values({ barId: demoBarId, version: 1 }).onConflictDoNothing();
}

void seedDemoBar().catch((error: unknown) => {
  process.stderr.write(`Garnish demo seed failed: ${String(error)}\n`);
});

export default router;
