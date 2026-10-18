import OpenAI, { toFile } from "openai";
import sharp from "sharp";

export class PhotoCleanupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Decode before sending any bytes to a paid provider; never trust MIME alone. */
export async function prepareCleanupPhoto(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
    throw new PhotoCleanupError("Choose a photo no larger than 15 MB.");
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 32_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) {
      throw new PhotoCleanupError("Choose a still JPEG, PNG, or WebP photo.");
    }
    return await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
  } catch (error) {
    if (error instanceof PhotoCleanupError) throw error;
    throw new PhotoCleanupError("This photo could not be decoded. Choose a different image.");
  }
}

export async function cleanupDrinkPhoto(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const input = await prepareCleanupPhoto(bytes);
  signal?.throwIfAborted();
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
  const output = Buffer.from(encoded, "base64");
  if (output.length > 15 * 1024 * 1024) {
    throw new PhotoCleanupError("The cleaned photo is too large. Try a smaller source photo.", 502);
  }
  const stats = await sharp(output).ensureAlpha().stats();
  const alpha = stats.channels[3];
  if (!alpha || alpha.min === 255 || alpha.max === 0) {
    throw new PhotoCleanupError("The cleanup did not produce a usable transparent cutout. Try a clearer photo.", 502);
  }
  return output;
}
