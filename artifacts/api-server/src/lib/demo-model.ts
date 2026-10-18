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
 * Gives the demo bar's signature drink a real 3D model, so a fresh database still has one
 * display that shows something in AR (`/s/demobar1`, `/s/demotbl1`). The model ships with
 * the API in assets/demo and is copied into object storage once; nothing is generated.
 */

const DEMO_DRINK_ID = "demo-cocktail-1";
const ASSET_BASE = "blood-orange-spritz";

/** The assets folder sits next to src/ in development and next to dist/ once built. */
function assetsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, "../../assets/demo"), path.resolve(here, "../assets/demo")]) {
    if (existsSync(path.join(candidate, `${ASSET_BASE}.glb`))) return candidate;
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

export async function seedDemoModel(demoBarId: string): Promise<void> {
  const [drink] = await db
    .select({ id: drinksTable.id })
    .from(drinksTable)
    .where(and(eq(drinksTable.id, DEMO_DRINK_ID), eq(drinksTable.barId, demoBarId), isNull(drinksTable.modelGlbUrl)))
    .limit(1);
  if (!drink) return;

  const dir = assetsDir();
  if (!dir) return;

  const folder = `argraphics/drinks/${DEMO_DRINK_ID}`;
  const [glb, png] = await Promise.all([
    readFile(path.join(dir, `${ASSET_BASE}.glb`)),
    readFile(path.join(dir, `${ASSET_BASE}.png`)),
  ]);
  const usdzPath = path.join(dir, `${ASSET_BASE}.usdz`);
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
      updatedAt: new Date(),
    })
    .where(and(eq(drinksTable.id, DEMO_DRINK_ID), eq(drinksTable.barId, demoBarId)));
}
