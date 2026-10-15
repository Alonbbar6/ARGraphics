import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { db, arEventsTable, barsTable, drinksTable, menuVersionTable, tableCardsTable, usersTable } from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage";
import {
  CreatePublicEventParams,
  CreatePublicEventResponse,
  CreateDrinkBody,
  CreatePublicEventBody,
  DeleteDrinkParams,
  GetPublicTableCardsParams,
  GetDrinkGenerationParams,
  GetDrinkGenerationResponse,
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
  RegisterBody,
  RequestDrinkPhotoUploadBody,
  RequestDrinkPhotoUploadResponse,
  StartDrinkGenerationBody,
  StartDrinkGenerationParams,
  StartDrinkGenerationResponse,
  UpdateDrinkBody,
  UpdateDrinkParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import passwordRecoveryRouter from "./password-recovery";
import photoCleanupRouter from "./photo-cleanup";
import { InvalidArtworkError, validateRasterImage } from "../lib/tableCardArtwork";

const router: IRouter = Router();
const demoBarId = "garnish-demo-bar";
const demoSlug = "demo-bar";
const sessionCookie = "garnish_session";
const MAX_PHOTO_SIZE = 15 * 1024 * 1024;
const objectStorage = new ObjectStorageService();
const activeMeshyPolls = new Set<string>();
router.use(passwordRecoveryRouter);

declare global {
  namespace Express {
    interface Request {
      owner?: typeof usersTable.$inferSelect;
    }
  }
}

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
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; expiresAt: number; sessionVersion?: number };
    if (!Number.isFinite(data.expiresAt) || data.expiresAt < Date.now()) return null;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, data.userId)).limit(1);
    return user && (data.sessionVersion ?? 0) === user.sessionVersion ? user : null;
  } catch {
    return null;
  }
}

async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const owner = await currentUser(req);
  if (!owner) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  req.owner = owner;
  next();
}

function setSessionCookie(res: Response, userId: string, sessionVersion = 0): void {
  const payload = Buffer.from(JSON.stringify({
    userId,
    sessionVersion,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  const signature = signSession(payload);
  res.setHeader(
    "Set-Cookie",
    `${sessionCookie}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}

function slugBase(barName: string): string {
  const slug = barName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "bar";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
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
  res.setHeader("Cache-Control", "no-store");
  res.removeHeader("ETag");
  const user = await currentUser(req);
  if (!user) {
    res.json(GetSessionResponse.parse({ authenticated: false, userName: null, barName: null, barSlug: null }));
    return;
  }
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  res.json(LoginResponse.parse({
    authenticated: true,
    userName: user.name,
    barName: bar?.name ?? null,
    barSlug: bar?.slug ?? null,
  }));
});

router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.use(["/drinks", "/insights"], requireOwner);
router.use(photoCleanupRouter);

router.post("/storage/drink-photos/request-url", requireOwner, async (req, res): Promise<void> => {
  const parsed = CreateDrinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your name, bar name, a valid email, and a password of at least 12 characters." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();
  const barName = parsed.data.barName.trim();
  if (!name || !barName || Buffer.byteLength(parsed.data.password, "utf8") > 72) {
    res.status(400).json({ error: "Check your details and use a password no longer than 72 bytes." });
    return;
  }

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, email)).limit(1);
  if (existingUser) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  let createdBar: typeof barsTable.$inferSelect | undefined;
  try {
    await db.transaction(async (tx) => {
      const base = slugBase(barName);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 6)}`;
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  res.json(LoginResponse.parse({
    authenticated: true,
    userName: user.name,
    barName: bar?.name ?? null,
    barSlug: bar?.slug ?? null,
  }));
});

router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.use(["/drinks", "/insights"], requireOwner);
router.use(photoCleanupRouter);

router.post("/storage/drink-photos/request-url", requireOwner, async (req, res): Promise<void> => {
  const parsed = CreateDrinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.email, parsed.data.email.trim().toLowerCase())).limit(1);
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password did not match." });
    return;
  }
  setSessionCookie(res, user.id, user.sessionVersion);
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  res.json(LoginResponse.parse({
    authenticated: true,
    userName: user.name,
    barName: bar?.name ?? null,
    barSlug: bar?.slug ?? null,
  }));
});

router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.use(["/drinks", "/insights"], requireOwner);
router.use(photoCleanupRouter);

router.post("/storage/drink-photos/request-url", requireOwner, async (req, res): Promise<void> => {
  const parsed = CreateDrinkBody.safeParse(req.body);
  if (!parsed.success || parsed.data.size > MAX_PHOTO_SIZE) {
    res.status(400).json({ error: "Choose a JPEG, PNG, or WebP photo no larger than 15 MB." });
    return;
  }
  const input = parsed.data;
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = kind === "source" ? drink?.sourcePhotoUrl : drink?.cleanedPhotoUrl;
    await db.update(drinksTable).set({
      ...(input.kind === "original" ? { sourcePhotoUrl: objectPath } : { cleanedPhotoUrl: objectPath }),
      generationStatus: "uploaded",
      generationProgress: 0,
      generationError: null,
      updatedAt: new Date(),
    }).where(and(eq(drinksTable.id, input.drinkId), eq(drinksTable.barId, barId)));
    res.json(RequestDrinkPhotoUploadResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error({ err: error }, "Could not create App Storage upload URL");
    res.status(503).json({ error: "Photo storage is unavailable right now. Try again shortly." });
  }
});

function publicAssetUrl(req: Request, storedPath: string | null): string | null {
  if (!storedPath) return null;
  const filePath = storedPath.startsWith("/public-objects/")
    ? storedPath.slice("/public-objects/".length)
    : storedPath.replace(/^\/+/, "");
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `${protocol}://${host}/api/storage/public-objects/${encodedPath}`;
}

function drinkPhotoUrl(req: Request, drinkId: string, kind: "source" | "cleaned", path: string | null) {
  if (!path) return null;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  return `${protocol}://${host}/api/drinks/${encodeURIComponent(drinkId)}/photos/${kind}`;
}

function asDrink(req: Request, drink: typeof drinksTable.$inferSelect) {
  return {
    id: drink.id,
    name: drink.name,
    description: drink.description,
    priceCents: drink.priceCents,
    category: drink.category,
    isAvailable: drink.isAvailable,
    isPublished: drink.isPublished,
    sortOrder: drink.sortOrder,
    thumbnailUrl: publicAssetUrl(req, drink.thumbnailUrl),
    generationStatus: drink.generationStatus,
    generationProgress: drink.generationProgress,
    modelGlbUrl: publicAssetUrl(req, drink.modelGlbUrl),
    modelUsdzUrl: publicAssetUrl(req, drink.modelUsdzUrl),
    generationError: drink.generationError,
    updatedAt: drink.updatedAt.toISOString(),
  };
}

function generationState(req: Request, drink: typeof drinksTable.$inferSelect) {
  return GetDrinkGenerationResponse.parse({
    status: drink.generationStatus,
    progress: drink.generationProgress,
    error: drink.generationError,
    sourcePhotoUrl: drinkPhotoUrl(req, drink.id, "source", drink.sourcePhotoUrl),
    cleanedPhotoUrl: drinkPhotoUrl(req, drink.id, "cleaned", drink.cleanedPhotoUrl),
    modelGlbUrl: publicAssetUrl(req, drink.modelGlbUrl),
    thumbnailUrl: publicAssetUrl(req, drink.thumbnailUrl),
  });
}

type DrinkTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function bumpMenuVersion(tx: DrinkTransaction, barId: string) {
  await tx.insert(menuVersionTable).values({ barId, version: 2 })
    .onConflictDoUpdate({
      target: menuVersionTable.barId,
      set: { version: sql`${menuVersionTable.version} + 1` },
    });
}

router.get("/drinks", async (req, res): Promise<void> => {
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const drinks = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.barId, bar.id), eq(drinksTable.isPublished, true), eq(drinksTable.isAvailable, true)))
    .orderBy(asc(drinksTable.sortOrder));
  res.json(ListDrinksResponse.parse(drinks.map((drink) => asDrink(req, drink))));
});

function storageTarget(searchPath: string, assetName: string) {
  const parts = searchPath.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName) throw new Error("App Storage public path is invalid.");
  const folder = parts.join("/");
  const objectName = [folder, assetName].filter(Boolean).join("/");
  return { bucketName, objectName };
}

async function saveMeshyDownload(
  sourceUrl: string,
  drinkId: string,
  extension: string,
  contentType: string,
): Promise<string> {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Meshy asset download failed (${response.status}).`);
  }
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 200 * 1024 * 1024) throw new Error("The generated model is larger than App Storage allows.");

  const assetName = `garnish/drinks/${drinkId}/${randomUUID()}.${extension}`;
  for (const searchPath of objectStorage.getPublicObjectSearchPaths()) {
    const target = storageTarget(searchPath, assetName);
    const file = objectStorageClient.bucket(target.bucketName).file(target.objectName);
    try {
      await pipeline(
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        file.createWriteStream({
          metadata: {
            contentType,
            cacheControl: "public, max-age=31536000, immutable",
          },
        }),
      );
      return `/public-objects/${assetName}`;
    } catch (error) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
  }
  throw new Error("No public App Storage path is configured.");
}

type MeshyTask = {
  id?: string;
  status?: string;
  progress?: number;
  model_urls?: Record<string, string>;
  thumbnail_url?: string;
  task_error?: { message?: string };
};

async function pollMeshyTask(drinkId: string, barId: string, taskId: string): Promise<boolean> {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) throw new Error("MESHY_API_KEY is not configured.");
  const [drink] = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId))).limit(1);
  if (!drink || drink.meshyTaskId !== taskId) return true;

  const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as MeshyTask & { message?: string };
  if (!response.ok) throw new Error(result.message || `Meshy returned HTTP ${response.status}.`);

  if (result.status === "PENDING" || result.status === "IN_PROGRESS") {
    await db.update(drinksTable).set({
      generationStatus: "processing",
      generationProgress: Math.max(0, Math.min(99, Math.round(result.progress ?? drink.generationProgress))),
      updatedAt: new Date(),
    }).where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId), eq(drinksTable.meshyTaskId, taskId)));
    return false;
  }

  if (result.status === "FAILED" || result.status === "CANCELED") {
    await db.update(drinksTable).set({
      generationStatus: "failed",
      generationError: result.task_error?.message || "Meshy could not make a model from this photo. Try another image.",
      updatedAt: new Date(),
    }).where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId), eq(drinksTable.meshyTaskId, taskId)));
    return true;
  }

  if (result.status !== "SUCCEEDED") return false;
  const glbSource = result.model_urls?.glb;
  const thumbnailSource = result.thumbnail_url;
  if (!glbSource || !thumbnailSource) {
    throw new Error("Meshy finished without returning the model and preview image.");
  }
  const [glbPath, thumbnailPath, usdzPath] = await Promise.all([
    saveMeshyDownload(glbSource, drinkId, "glb", "model/gltf-binary"),
    saveMeshyDownload(thumbnailSource, drinkId, "png", "image/png"),
    result.model_urls?.usdz
      ? saveMeshyDownload(result.model_urls.usdz, drinkId, "usdz", "model/vnd.usdz+zip")
      : Promise.resolve(null),
  ]);
  await db.update(drinksTable).set({
    modelGlbUrl: glbPath,
    modelUsdzUrl: usdzPath,
    thumbnailUrl: thumbnailPath,
    generationStatus: "ready",
    generationProgress: 100,
    generationError: null,
    updatedAt: new Date(),
  }).where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId), eq(drinksTable.meshyTaskId, taskId)));
  return true;
}

function startBackgroundPolling(drinkId: string, barId: string, taskId: string) {
  const key = `${drinkId}:${taskId}`;
  if (activeMeshyPolls.has(key)) return;
  activeMeshyPolls.add(key);
  void (async () => {
    try {
      for (let attempt = 0; attempt < 360; attempt += 1) {
        await delay(5_000);
        if (await pollMeshyTask(drinkId, barId, taskId)) return;
      }
      await db.update(drinksTable).set({
        generationStatus: "failed",
        generationError: "This model is taking longer than expected. Try again or choose another photo.",
        updatedAt: new Date(),
      }).where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId), eq(drinksTable.meshyTaskId, taskId)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The 3D preview could not be saved.";
      await db.update(drinksTable).set({
        generationStatus: "failed",
        generationError: message,
        updatedAt: new Date(),
      }).where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId), eq(drinksTable.meshyTaskId, taskId)));
    } finally {
      activeMeshyPolls.delete(key);
    }
  })();
}

router.get("/drinks/:id/photos/:kind", async (req, res): Promise<void> => {
  const kind = req.params.kind;
  if (kind !== "source" && kind !== "cleaned") {
    res.status(404).json({ error: "Photo not found." });
    return;
  }
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  const objectPath = kind === "source" ? drink?.sourcePhotoUrl : drink?.cleanedPhotoUrl;
  if (!objectPath) {
    res.status(404).json({ error: "Photo not found." });
    return;
  }
  try {
        const file = await objectStorage.getObjectEntityFile(path);
  const response = await Promise.all(cards.map(async (card) => ({
    id: card.id,
    name: card.name,
    referenceImageUrl: await storage.getObjectEntityDownloadURL(card.referenceImageUrl),
    physicalWidthCm: Number(card.physicalWidthMeters) * 100,
  })));
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Could not serve drink photo");
    res.status(404).json({ error: "Photo is not available." });
  }
});

router.get("/storage/public-objects/*filePath", async (req, res): Promise<void> => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
        const file = await objectStorage.getObjectEntityFile(path);
    if (!file) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
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
  if (!params.success) {
    res.status(400).json({ error: "Drink not found." });
    return;
  }
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  if (drink.generationStatus === "processing" && drink.meshyTaskId) {
    startBackgroundPolling(drink.id, drink.barId, drink.meshyTaskId);
  }
  res.json(GetDrinkGenerationResponse.parse(generationState(req, drink)));
});

router.post("/drinks/:id/generation", async (req, res): Promise<void> => {
  const params = CreatePublicEventParams.safeParse(req.params);
  const body = CreatePublicEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose both the original and cleaned photos before generating a preview." });
    return;
  }
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  if (drink.generationStatus === "processing") {
    res.status(409).json({ error: "A 3D preview is already being generated for this drink." });
    return;
  }
  const { sourcePhotoPath, cleanedPhotoPath } = body.data;
  if (sourcePhotoPath !== drink.sourcePhotoUrl || cleanedPhotoPath !== drink.cleanedPhotoUrl ||
      !sourcePhotoPath.startsWith("/objects/uploads/") || !cleanedPhotoPath.startsWith("/objects/uploads/")) {
    res.status(400).json({ error: "The approved photos do not match the uploaded files. Upload them again." });
    return;
  }
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "3D generation is not configured. Check the Meshy connection." });
    return;
  }
  try {
    // Validate sequentially to bound peak decoded memory. Neither validation
    // failures nor read failures may start paid generation or mutate the drink.
    for (const [label, path] of [["original", sourcePhotoPath], ["cleaned", cleanedPhotoPath]] as const) {
      try {
        const file = await objectStorage.getObjectEntityFile(path);
        await validateRasterImage(file, {
          subject: `${label} photo`, maxBytes: MAX_PHOTO_SIZE,
          limitLabel: "15 MB", stillImageLabel: "drink photos",
        });
      } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the 3D preview.";
        res.status(400).json({ error: message });
        return;
      }
    }
    const imageUrl = await objectStorage.getObjectEntityReadURL(cleanedPhotoPath, 3600);
  const response = await Promise.all(cards.map(async (card) => ({
    id: card.id,
    name: card.name,
    referenceImageUrl: await storage.getObjectEntityDownloadURL(card.referenceImageUrl),
    physicalWidthCm: Number(card.physicalWidthMeters) * 100,
  })));
    const result = await response.json() as { result?: string; message?: string };
    if (!response.ok || !result.result) {
    const message = error instanceof Error ? error.message : "Could not start the 3D preview.";
      await db.update(drinksTable).set({
        generationStatus: "failed",
        generationError: message,
        updatedAt: new Date(),
      }).where(and(eq(drinksTable.id, drink.id), eq(drinksTable.barId, drink.barId)));
      res.status(502).json({ error: message });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(drinksTable)
        .where(and(eq(drinksTable.id, drink.id), eq(drinksTable.barId, drink.barId)))
        .limit(1).for("update");
      if (!current) return undefined;
      const [saved] = await tx.update(drinksTable).set({
        meshyTaskId: result.result,
        generationStatus: "processing",
        generationProgress: 0,
        generationError: null,
        isPublished: false,
        updatedAt: new Date(),
      }).where(and(eq(drinksTable.id, drink.id), eq(drinksTable.barId, drink.barId))).returning();
      if (current.isPublished) await bumpMenuVersion(tx, drink.barId);
      return saved;
    });
    if (!updated) {
      res.status(404).json({ error: "Drink not found." });
      return;
    }
    startBackgroundPolling(drink.id, drink.barId, result.result);
    res.json(StartDrinkGenerationResponse.parse(generationState(req, updated)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the 3D preview.";
    await db.update(drinksTable).set({
      generationStatus: "failed",
      generationError: message,
      updatedAt: new Date(),
    }).where(and(eq(drinksTable.id, drink.id), eq(drinksTable.barId, drink.barId)));
    req.log.error({ err: error }, "Could not start Meshy generation");
    res.status(502).json({ error: message });
  }
});

router.post("/drinks", async (req, res): Promise<void> => {
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const parsed = CreateDrinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lastDrink] = await db.select({ sortOrder: drinksTable.sortOrder }).from(drinksTable)
    .where(eq(drinksTable.barId, barId)).orderBy(desc(drinksTable.sortOrder));
  const [drink] = await db.select({ id: drinksTable.id }).from(drinksTable)
    .where(and(eq(drinksTable.id, body.data.drinkId), eq(drinksTable.barId, bar.id)));
  res.status(201).json(asDrink(req, drink));
});

router.patch("/drinks/:id", async (req, res): Promise<void> => {
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const params = CreatePublicEventParams.safeParse(req.params);
  const body = CreatePublicEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Check the drink details and try again." });
    return;
  }
  const [existing] = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.id, params.data.id), eq(drinksTable.barId, barId))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  if (body.data.isPublished === true && !existing.modelGlbUrl) {
    res.status(400).json({ error: "Generate a 3D preview before publishing this drink." });
    return;
  }
  const drink = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(drinksTable)
      .where(and(eq(drinksTable.id, params.data.id), eq(drinksTable.barId, barId)))
      .returning();
    if (deleted) await bumpMenuVersion(tx, barId);
    return deleted;
  });
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  res.json({ message: "Drink deleted." });
});

router.get("/insights", async (req, res): Promise<void> => {
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const params = CreatePublicEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const drink = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(drinksTable)
      .where(and(eq(drinksTable.id, params.data.id), eq(drinksTable.barId, barId)))
      .returning();
    if (deleted) await bumpMenuVersion(tx, barId);
    return deleted;
  });
  if (!drink) {
    res.status(404).json({ error: "Drink not found." });
    return;
  }
  res.json({ message: "Drink deleted." });
});

router.get("/insights", async (req, res): Promise<void> => {
  const barId = req.owner?.barId;
  if (!barId) {
    res.status(401).json({ error: "Sign in to manage your bar." });
    return;
  }
  const [bar] = await db.select({ id: barsTable.id }).from(barsTable)
    .where(eq(barsTable.slug, params.data.slug));
  const drinks = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.barId, bar.id), eq(drinksTable.isPublished, true), eq(drinksTable.isAvailable, true)))
    .orderBy(asc(drinksTable.sortOrder));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await db.select().from(arEventsTable)
    .where(and(eq(arEventsTable.barId, barId), gte(arEventsTable.createdAt, weekAgo)));
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
  const params = CreatePublicEventParams.safeParse(req.params);
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
  const [version] = await db.select().from(menuVersionTable).where(eq(menuVersionTable.barId, bar.id));
  res.json(GetPublicMenuVersionResponse.parse({ version: version?.version ?? 1 }));
});

router.get("/v1/bars/:slug/menu", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = CreatePublicEventParams.safeParse(req.params);
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
      thumbnailUrl: publicAssetUrl(req, drink.thumbnailUrl),
      modelUsdzUrl: publicAssetUrl(req, drink.modelUsdzUrl),
      modelGlbUrl: publicAssetUrl(req, drink.modelGlbUrl),
      updatedAt: drink.updatedAt.toISOString(),
    })),
  }));
});

router.get("/v1/bars/:slug/table-cards", async (req, res): Promise<void> => {
  if (!requireIosKey(req, res)) return;
  const params = CreatePublicEventParams.safeParse(req.params);
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

if (process.env.NODE_ENV === "development") {
  void seedDemoBar().catch((error: unknown) => {
    process.stderr.write(`Garnish demo seed failed: ${String(error)}\n`);
  });
}

export default router;
