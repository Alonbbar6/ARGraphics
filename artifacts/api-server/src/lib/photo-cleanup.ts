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
 * A closed outline the owner traced around the subject, as [x, y] fractions (0–1) of the
 * upright photo. It tells the engine where the drink is and nothing outside it survives.
 */
export type Outline = Array<[number, number]>;

/**
 * Parts the owner traced inside the item outline: the drink itself and any garnish (lemon,
 * herbs, straw). Same coordinates as the outline. They are not used for the cutout; they are
 * kept with it so the finished 3D model can be split into clear glass and solid parts.
 */
export type Parts = { liquid?: Outline; garnish?: Outline[] };

/** Where the cutout's subject sits in the upright source photo, as fractions (0–1). */
export type SubjectBox = { x: number; y: number; w: number; h: number };

export const MAX_OUTLINE_POINTS = 400;
const MAX_GARNISH_LOOPS = 6;

/**
 * Slack around a traced outline, as a fraction of its longer side. A finger traces a little
 * inside the glass edge; the engine finds the real edge within this band.
 */
const OUTLINE_SLACK = 0.04;

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

/**
 * Reads `x,y;x,y;…` from the request. Undefined when the owner skipped the outline; a
 * malformed one is refused before any paid call rather than silently ignored.
 */
export function parseOutline(raw: unknown): Outline | undefined {
  if (raw === undefined || raw === "") return undefined;
  const unreadable = new PhotoCleanupError("The outline could not be read. Draw it around the item again.");
  if (typeof raw !== "string" || raw.length > 8000) throw unreadable;
  const points = raw.split(";").map((pair) => pair.split(",").map(Number));
  const loop = readLoop(points);
  if (!loop) throw unreadable;
  if (loopArea(loop) < 0.005) {
    throw new PhotoCleanupError("That outline is too small. Trace all the way around the item, base included.");
  }
  return loop;
}

/** A closed loop of 3–400 points inside the unit square, or null when it is anything else. */
function readLoop(points: unknown): Outline | null {
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_OUTLINE_POINTS) return null;
  const ok = points.every((point) => Array.isArray(point) && point.length === 2
    && point.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1));
  return ok ? (points as Outline) : null;
}

function loopArea(points: Outline): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Reads the `parts` query: JSON `{ liquid?: [[x,y],…], garnish?: [[[x,y],…],…] }`. Undefined
 * when the owner traced none; malformed parts are refused before any paid call.
 */
export function parseParts(raw: unknown): Parts | undefined {
  if (raw === undefined || raw === "") return undefined;
  const unreadable = new PhotoCleanupError("The traced parts could not be read. Trace the drink and garnish again.");
  if (typeof raw !== "string" || raw.length > 40_000) throw unreadable;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unreadable;
  const { liquid, garnish } = parsed as { liquid?: unknown; garnish?: unknown };
  const parts: Parts = {};
  if (liquid !== undefined) {
    const loop = readLoop(liquid);
    if (!loop) throw unreadable;
    if (loopArea(loop) < 0.002) throw new PhotoCleanupError("The drink outline is too small. Trace the liquid right up to the glass edge.");
    parts.liquid = loop;
  }
  if (garnish !== undefined) {
    if (!Array.isArray(garnish) || garnish.length > MAX_GARNISH_LOOPS) throw unreadable;
    const loops = garnish.map(readLoop);
    if (loops.some((loop) => !loop || loopArea(loop) < 0.0005)) throw unreadable;
    parts.garnish = loops as Outline[];
  }
  return parts.liquid || parts.garnish?.length ? parts : undefined;
}

/**
 * Crops the photo to a square around the outline, with transparent padding where the square
 * runs past the photo, and draws the matching mask: opaque over the subject (outline plus
 * slack), transparent elsewhere. Square keeps the provider's 1024×1024 output aligned.
 */
async function focusOnOutline(input: Buffer, outline: Outline): Promise<{ image: Buffer; mask: Buffer; crop: Crop }> {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  const points = outline.map(([x, y]) => [x * width, y * height]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const longer = Math.max(maxX - minX, maxY - minY);
  if (longer < MIN_PHOTO_SHORT_SIDE * 0.6) {
    throw new PhotoCleanupError("The outlined item is too small in this photo. Get closer so it fills most of the frame.");
  }
  const slack = Math.round(longer * OUTLINE_SLACK);
  // Room past the slack for the corner and edge checks, which expect clear margins.
  const side = Math.round(longer * (1 + 2 * FRAME_PADDING) + 4 * slack);
  const left = Math.round((minX + maxX - side) / 2);
  const top = Math.round((minY + maxY - side) / 2);
  const [x0, y0] = [Math.max(0, left), Math.max(0, top)];
  const [x1, y1] = [Math.min(width, left + side), Math.min(height, top + side)];
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const image = await sharp(input).ensureAlpha()
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .extend({ left: x0 - left, top: y0 - top, right: left + side - x1, bottom: top + side - y1, background: transparent })
    .png().toBuffer();
  const polygon = points.map(([x, y]) => `${(x - left).toFixed(1)},${(y - top).toFixed(1)}`).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">`
    + `<polygon points="${polygon}" fill="#fff" stroke="#fff" stroke-width="${2 * slack}" stroke-linejoin="round"/></svg>`;
  const mask = await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer();
  return { image, mask, crop: { left, top, width: side, height: side } };
}

/** The part of the prepared photo the engine was given, in prepared-photo pixels. */
type Crop = { left: number; top: number; width: number; height: number };

/** Clears every pixel outside the owner's outline, whatever the engine returned. */
async function clipToOutline(output: Buffer, mask: Buffer): Promise<Buffer> {
  try {
    const { width = 0, height = 0 } = await sharp(output).metadata();
    const fitted = await sharp(mask).resize(width, height, { fit: "fill" }).png().toBuffer();
    return await sharp(output).ensureAlpha().composite([{ input: fitted, blend: "dest-in" }]).png().toBuffer();
  } catch {
    // Undecodable output; the checks that follow refuse it with a clear message.
    return output;
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

async function openaiCutout(input: Buffer, signal?: AbortSignal, outlineMask?: Buffer): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new PhotoCleanupError("Photo cleanup isn't switched on for this server yet. Ask your ARGraphics contact to enable it.", 503);
  }
  // Use the owner's key directly. Never use browser credentials or log provider payloads.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180_000, maxRetries: 0 });
  const image = await toFile(input, "drink.png", { type: "image/png" });
  // The mask's transparent area is what the model may edit: everything outside the outline.
  const mask = outlineMask ? await toFile(outlineMask, "outline.png", { type: "image/png" }) : undefined;
  signal?.throwIfAborted();
  const result = await openai.images.edit({
    model: "gpt-image-1",
    image,
    ...(mask ? { mask } : {}),
    prompt: "Remove only the background of this drink photograph. Return a transparent PNG cutout of the complete original drink, including the glass, stem, base, ice, liquid, garnish and straw. Preserve the exact shape, proportions, colors and photographic details. Do not redesign, add objects, crop the drink, add a backdrop, or add a ground shadow. Preserve translucent glass edges."
      + (mask ? " The drink is the unmasked area the owner outlined. Everything outside it is background, including other glasses, bottles, hands and people." : ""),
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

/** Where the subject ended up, as a fraction of the engine's output (0–1). */
type Framed = { png: Buffer; subject: { x: number; y: number; w: number; h: number } };

/** Crops to the subject and adds a little breathing room, so the drink fills the frame. */
async function frameSubject(output: Buffer): Promise<Framed> {
  const whole = { x: 0, y: 0, w: 1, h: 1 };
  try {
    const { width: outW = 0, height: outH = 0 } = await sharp(output).metadata();
    const { data: trimmed, info } = await sharp(output).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer({ resolveWithObject: true });
    const { width, height, trimOffsetLeft = 0, trimOffsetTop = 0 } = info;
    if (!width || !height || !outW || !outH) return { png: output, subject: whole };
    const pad = Math.round(Math.max(width, height) * FRAME_PADDING);
    const png = await sharp(trimmed)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    // sharp reports the trim offsets as negative shifts.
    return { png, subject: { x: -trimOffsetLeft / outW, y: -trimOffsetTop / outH, w: width / outW, h: height / outH } };
  } catch {
    // Nothing to trim (or an odd image); the verified cutout is still fine to use.
    return { png: output, subject: whole };
  }
}

/* ------------------------------------------------------------------ public */

/** What any engine's output goes through before it is stored or sent back. */
export async function finishCutout(output: Buffer): Promise<Buffer> {
  return (await frameSubject(await snapAndVerify(output))).png;
}

export async function cleanupDrinkPhoto(bytes: Buffer, signal?: AbortSignal, outline?: Outline): Promise<Buffer> {
  return (await cleanupDrinkPhotoWithBox(bytes, signal, outline)).png;
}

/**
 * The cutout plus where its subject sits in the source photo, so parts the owner traced on
 * the photo can be mapped onto the model built from the cutout.
 */
export async function cleanupDrinkPhotoWithBox(bytes: Buffer, signal?: AbortSignal, outline?: Outline): Promise<{ png: Buffer; subjectBox: SubjectBox }> {
  signal?.throwIfAborted();
  const prepared = await prepareCleanupPhoto(bytes);
  signal?.throwIfAborted();
  const [issue] = await assessPhotoQuality(prepared);
  if (issue) throw new PhotoCleanupError(issue.message);
  const { width: preparedW = 1, height: preparedH = 1 } = await sharp(prepared).metadata();
  const focused = outline ? await focusOnOutline(prepared, outline) : undefined;
  const input = focused?.image ?? prepared;
  const crop: Crop = focused?.crop ?? { left: 0, top: 0, width: preparedW, height: preparedH };
  signal?.throwIfAborted();

  let output: Buffer;
  if (cutoutEngine() === "openai") {
    output = await openaiCutout(input, signal, focused?.mask);
  } else {
    try {
      output = await localCutout(input, signal);
    } catch (error) {
      if (signal?.aborted || error instanceof PhotoCleanupError) throw error;
      // The local model could not run (missing runtime, corrupt download). Fall back to
      // the provider when it is configured, otherwise say so plainly.
      if (process.env.OPENAI_API_KEY) {
        output = await openaiCutout(input, signal, focused?.mask);
      } else {
        throw new PhotoCleanupError("Photo cleanup is unavailable on this server right now. Try again in a minute.", 503);
      }
    }
  }
  signal?.throwIfAborted();
  if (focused) output = await clipToOutline(output, focused.mask);
  const framed = await frameSubject(await snapAndVerify(output));
  // Engine output may be another size than its input (the provider returns 1024²); the
  // subject's fractions of that output map back onto the crop, then onto the prepared photo.
  const { x, y, w, h } = framed.subject;
  return {
    png: framed.png,
    subjectBox: {
      x: (crop.left + x * crop.width) / preparedW,
      y: (crop.top + y * crop.height) / preparedH,
      w: (w * crop.width) / preparedW,
      h: (h * crop.height) / preparedH,
    },
  };
}
