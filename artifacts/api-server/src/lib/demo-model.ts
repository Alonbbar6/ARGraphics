import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { db, drinksTable } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

/**
 * Gives the demo bar's drinks real 3D models, so a fresh database still shows something in
 * AR (`/s/demobar1`, `/s/demotbl1`, the 3D library). The models ship with the API in
 * assets/demo and are copied into object storage once per drink; nothing is generated.
 * Each model was built from a photo through the app's own pipeline.
 */

/** Demo drink id → asset base name in assets/demo (`<base>.glb`, `.usdz`, `.png`). */
const DEMO_MODELS: ReadonlyArray<{ drinkId: string; base: string }> = [
  { drinkId: "demo-cocktail-1", base: "blood-orange-spritz" },
  { drinkId: "demo-cocktail-3", base: "last-word" },
  { drinkId: "demo-cocktail-4", base: "garden-gimlet" },
];

/** The assets folder sits next to src/ in development and next to dist/ once built. */
function assetsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, "../../assets/demo"), path.resolve(here, "../assets/demo")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function storageTarget(searchPath: string, assetName: string) {
  const parts = searchPath.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName) throw new Error("App Storage public path is invalid.");
  const objectName = [parts.join("/"), assetName].filter(Boolean).join("/");
  return { bucketName, objectName };
}

async function store(bytes: Buffer, assetName: string, contentType: string): Promise<string> {
  const [searchPath] = new ObjectStorageService().getPublicObjectSearchPaths();
  if (!searchPath) throw new Error("No public App Storage path is configured.");
  const target = storageTarget(searchPath, assetName);
  const file = objectStorageClient.bucket(target.bucketName).file(target.objectName);
  // Same write path the Meshy download uses, so local and GCS storage both work.
  await pipeline(
    Readable.from(bytes),
    file.createWriteStream({ metadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } }),
  );
  return `/public-objects/${assetName}`;
}

async function seedOne(dir: string, demoBarId: string, drinkId: string, base: string): Promise<void> {
  const [drink] = await db
    .select({ id: drinksTable.id })
    .from(drinksTable)
    .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, demoBarId), isNull(drinksTable.modelGlbUrl)))
    .limit(1);
  if (!drink) return;

  const glbPath = path.join(dir, `${base}.glb`);
  const pngPath = path.join(dir, `${base}.png`);
  const usdzPath = path.join(dir, `${base}.usdz`);
  if (!existsSync(glbPath) || !existsSync(pngPath)) return;

  const folder = `argraphics/drinks/${drinkId}`;
  const [glb, png] = await Promise.all([readFile(glbPath), readFile(pngPath)]);
  const usdz = existsSync(usdzPath) ? await readFile(usdzPath) : null;

  const [modelGlbUrl, thumbnailUrl, modelUsdzUrl] = await Promise.all([
    store(glb, `${folder}/demo.glb`, "model/gltf-binary"),
    store(png, `${folder}/demo.png`, "image/png"),
    usdz ? store(usdz, `${folder}/demo.usdz`, "model/vnd.usdz+zip") : Promise.resolve(null),
  ]);

  await db
    .update(drinksTable)
    .set({
      modelGlbUrl,
      modelUsdzUrl,
      thumbnailUrl,
      generationStatus: "ready",
      generationProgress: 100,
      generationError: null,
      // Everything with a model goes on the demo menu, so the guest page has a full round.
      isPublished: true,
      updatedAt: new Date(),
    })
    .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, demoBarId)));
}

export async function seedDemoModel(demoBarId: string): Promise<void> {
  const dir = assetsDir();
  if (!dir) return;
  for (const { drinkId, base } of DEMO_MODELS) {
    await seedOne(dir, demoBarId, drinkId, base);
  }
}
