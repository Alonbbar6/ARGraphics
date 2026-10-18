import OpenAI, { toFile } from "openai";
import sharp, { type Metadata, type Sharp } from "sharp";
import { assessPhotoQuality } from "./photo-quality";

export class PhotoCleanupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Photos below this on their short side are screenshots, thumbnails or heavy crops. They
 * give the 3D generator nothing to work with, so they are refused with advice instead of
 * producing a bad model that costs credits.
 */
export const MIN_PHOTO_SHORT_SIDE = 400;

/** Padding around the subject in the cutout, as a fraction of its longer side. */
const FRAME_PADDING = 0.06;

/**
 * Which cutout engine to use. "local" runs a deterministic matting model on this server:
 * it only removes pixels, so the glass, ice and garnish stay exactly as photographed.
 * "openai" asks an image model for a transparent edit; it tends to redraw the drink.
 */
export type CutoutEngine = "local" | "openai";

export function cutoutEngine(): CutoutEngine {
  return process.env.PHOTO_CUTOUT === "openai" ? "openai" : "local";
}

/** Decode before sending any bytes to a paid provider; never trust MIME alone. */
export async function prepareCleanupPhoto(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
    throw new PhotoCleanupError("Choose a photo no larger than 15 MB.");
  }
  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(bytes, { limitInputPixels: 32_000_000, failOn: "warning" });
    metadata = await image.metadata();
  } catch {
    throw new PhotoCleanupError("This photo could not be decoded. Choose a different image.");
  }
  if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) {
    throw new PhotoCleanupError("Choose a still JPEG, PNG, or WebP photo.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (Math.min(width, height) < MIN_PHOTO_SHORT_SIDE) {
    throw new PhotoCleanupError(
      `This photo is only ${width}×${height} pixels, too small for a good 3D model. ` +
        `Use a photo straight from the phone camera (at least ${MIN_PHOTO_SHORT_SIDE}px on its short side), not a screenshot or a thumbnail.`,
    );
  }
  try {
    return await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
  } catch {
    throw new PhotoCleanupError("This photo could not be decoded. Choose a different image.");
  }
}

/* ------------------------------------------------------------------ engines */

async function localCutout(input: Buffer, signal?: AbortSignal): Promise<Buffer> {
  // Loaded on first use: the model and its runtime are large, and tests that mock the
  // provider never need them.
  const { removeBackground } = await import("@imgly/background-removal-node");
  signal?.throwIfAborted();
  const result = await removeBackground(new Blob([new Uint8Array(input)], { type: "image/png" }), {
    model: "medium",
    output: { format: "image/png", quality: 1 },
  });
  signal?.throwIfAborted();
  return Buffer.from(await result.arrayBuffer());
}

async function openaiCutout(input: Buffer, signal?: AbortSignal): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new PhotoCleanupError("Photo cleanup isn't switched on for this server yet. Ask your ARGraphics contact to enable it.", 503);
  }
  // Use the owner's key directly. Never use browser credentials or log provider payloads.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180_000, maxRetries: 0 });
  const image = await toFile(input, "drink.png", { type: "image/png" });
  signal?.throwIfAborted();
  const result = await openai.images.edit({
    model: "gpt-image-1",
    image,
    prompt: "Remove only the background of this drink photograph. Return a transparent PNG cutout of the complete original drink, including the glass, stem, base, ice, liquid, garnish and straw. Preserve the exact shape, proportions, colors and photographic details. Do not redesign, add objects, crop the drink, add a backdrop, or add a ground shadow. Preserve translucent glass edges.",
    background: "transparent",
    output_format: "png",
    size: "1024x1024",
    quality: "medium",
    n: 1,
  }, { signal });
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new PhotoCleanupError("OpenAI returned no cleaned photo. Try again.", 502);
  return Buffer.from(encoded, "base64");
}

/* --------------------------------------------------------------- checking */

/**
 * Turns the engine's output into a clean cutout and checks it is usable.
 *
 * Matting models return a soft mask: background pixels keep a faint 10–25% alpha and the
 * subject sits a little under fully opaque. Snap that (below 30% → clear, above 70% →
 * solid, a smooth ramp between) so nothing downstream sees a veil. Then insist on real
 * transparency with empty corners: a halo around the drink becomes a blob in 3D.
 */
async function snapAndVerify(output: Buffer): Promise<Buffer> {
  if (output.length > 15 * 1024 * 1024) {
    throw new PhotoCleanupError("The cleaned photo is too large. Try a smaller source photo.", 502);
  }
  let data: Buffer;
  let width = 0;
  let height = 0;
  try {
    const decoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    data = decoded.data;
    width = decoded.info.width;
    height = decoded.info.height;
  } catch {
    throw new PhotoCleanupError("The cleanup did not produce a usable transparent cutout. Try a clearer photo.", 502);
  }
  if (!width || !height) {
    throw new PhotoCleanupError("The cleanup did not produce a usable transparent cutout. Try a clearer photo.", 502);
  }

  const lo = 0.3 * 255;
  const hi = 0.7 * 255;
  let min = 255;
  let max = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    const snapped = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
    data[i] = snapped;
    if (snapped < min) min = snapped;
    if (snapped > max) max = snapped;
  }
  if (min === 255 || max === 0) {
    throw new PhotoCleanupError("The cleanup did not produce a usable transparent cutout. Try a clearer photo.", 502);
  }

  // Where the drink sits in the frame: cut off at an edge, or too small to carry detail.
  let foreground = 0;
  const edgeHits = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 127) continue;
      foreground++;
      if (y === 0) edgeHits.top++;
      if (y === height - 1) edgeHits.bottom++;
      if (x === 0) edgeHits.left++;
      if (x === width - 1) edgeHits.right++;
    }
  }
  const crowdedEdges = [edgeHits.top > width * 0.02, edgeHits.bottom > width * 0.02, edgeHits.left > height * 0.02, edgeHits.right > height * 0.02].filter(Boolean).length;
  if (crowdedEdges >= 3) {
    // Opaque on nearly every side: the background was kept, not the drink cropped.
    throw new PhotoCleanupError("The cutout still has a background around the edges. Try a photo with the item clearly in front of a plain surface.", 502);
  }
  if (crowdedEdges > 0) {
    throw new PhotoCleanupError("Part of the item is cut off at the edge of the photo. Step back so the whole item, base included, is in the frame.");
  }
  if (foreground < width * height * 0.04) {
    throw new PhotoCleanupError("The item is too small in this photo. Get closer so it fills most of the frame.");
  }

  const corner = Math.max(1, Math.floor(Math.min(width, height) * 0.06));
  const meanAlpha = (left: number, top: number) => {
    let sum = 0;
    for (let y = top; y < top + corner; y++) {
      for (let x = left; x < left + corner; x++) sum += data[(y * width + x) * 4 + 3];
    }
    return sum / (corner * corner);
  };
  const corners = [meanAlpha(0, 0), meanAlpha(width - corner, 0), meanAlpha(0, height - corner), meanAlpha(width - corner, height - corner)];
  if (corners.some((mean) => mean > 24)) {
    throw new PhotoCleanupError("The cutout still has a background around the edges. Try a photo with the item clearly in front of a plain surface.", 502);
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Crops to the subject and adds a little breathing room, so the drink fills the frame. */
async function frameSubject(output: Buffer): Promise<Buffer> {
  try {
    const trimmed = await sharp(output).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer();
    const { width = 0, height = 0 } = await sharp(trimmed).metadata();
    if (!width || !height) return output;
    const pad = Math.round(Math.max(width, height) * FRAME_PADDING);
    return await sharp(trimmed)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    // Nothing to trim (or an odd image); the verified cutout is still fine to use.
    return output;
  }
}

/* ------------------------------------------------------------------ public */

/** What any engine's output goes through before it is stored or sent back. */
export async function finishCutout(output: Buffer): Promise<Buffer> {
  return frameSubject(await snapAndVerify(output));
}

export async function cleanupDrinkPhoto(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const input = await prepareCleanupPhoto(bytes);
  signal?.throwIfAborted();
  const [issue] = await assessPhotoQuality(input);
  if (issue) throw new PhotoCleanupError(issue.message);
  signal?.throwIfAborted();

  let output: Buffer;
  if (cutoutEngine() === "openai") {
    output = await openaiCutout(input, signal);
  } else {
    try {
      output = await localCutout(input, signal);
    } catch (error) {
      if (signal?.aborted || error instanceof PhotoCleanupError) throw error;
      // The local model could not run (missing runtime, corrupt download). Fall back to
      // the provider when it is configured, otherwise say so plainly.
      if (process.env.OPENAI_API_KEY) {
        output = await openaiCutout(input, signal);
      } else {
        throw new PhotoCleanupError("Photo cleanup is unavailable on this server right now. Try again in a minute.", 503);
      }
    }
  }
  signal?.throwIfAborted();
  return finishCutout(output);
}
