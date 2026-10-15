import type { File } from "@google-cloud/storage";
import sharp from "sharp";

export const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
export const MAX_ARTWORK_PIXELS = 16_000_000;
export const MAX_ARTWORK_DIMENSION = 8192;

export class InvalidArtworkError extends Error {}

const malformed = (subject: string) => new InvalidArtworkError(
  `The ${subject} is not a complete, valid PNG, JPEG, or WebP image.`,
);

// Check the container before invoking a decoder (in particular, never load SVG).
function contentType(bytes: Buffer, subject: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    if (!bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))) {
      throw malformed(subject);
    }
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw malformed(subject);
    return "image/jpeg";
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.length < 12 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw malformed(subject);
    return "image/webp";
  }
  throw malformed(subject);
}

export async function validateTableCardArtwork(file: File): Promise<void> {
  return validateRasterImage(file, {
    subject: "artwork", maxBytes: MAX_ARTWORK_BYTES, limitLabel: "10 MB",
    stillImageLabel: "table-card artwork",
  });
}

/** Shared bounded content checks; callers retain their existing upload limits. */
export async function validateRasterImage(file: File, options: {
  subject: string;
  maxBytes: number;
  limitLabel: string;
  stillImageLabel: string;
}): Promise<void> {
  const { subject, maxBytes, limitLabel, stillImageLabel } = options;
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!["image/png", "image/jpeg", "image/webp"].includes(metadata.contentType ?? "") ||
      !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    throw new InvalidArtworkError(`The uploaded file must be a supported image under ${limitLabel}.`);
  }

  // A bounded range and an independent byte count protect against false/stale
  // metadata. The extra byte distinguishes a full-limit image from an overflow.
  const stream = file.createReadStream({ end: maxBytes });
  const timer = setTimeout(() => stream.destroy(new Error(`${subject} read timed out`)), 10_000);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) {
        throw new InvalidArtworkError(`The uploaded ${subject} exceeds the ${limitLabel} limit.`);
      }
      chunks.push(bytes);
    }
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  const bytes = Buffer.concat(chunks, length);
  if (length !== size) throw malformed(subject);
  if (contentType(bytes, subject) !== metadata.contentType) {
    throw new InvalidArtworkError(`The ${subject} contents do not match its PNG, JPEG, or WebP file type.`);
  }

  try {
    // Metadata does not decode pixels. Check both axes and pixel count before
    // allocating the bounded raw output, then decode fully to catch corruption.
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: false });
    const info = await image.metadata();
    if (!info.width || !info.height) throw malformed(subject);
    if (info.width > MAX_ARTWORK_DIMENSION || info.height > MAX_ARTWORK_DIMENSION ||
        info.width * info.height > MAX_ARTWORK_PIXELS) {
      throw new InvalidArtworkError(
        `The ${subject} is too large to decode. Use at most 8192 pixels per side and 16 million pixels total.`,
      );
    }
    if ((info.pages ?? 1) !== 1) {
      throw new InvalidArtworkError(`Use a still image, not animated ${stillImageLabel}.`);
    }
    await sharp(bytes, { failOn: "warning", limitInputPixels: MAX_ARTWORK_PIXELS })
      .timeout({ seconds: 5 }).raw().toBuffer();
  } catch (error) {
    if (error instanceof InvalidArtworkError) throw error;
    throw malformed(subject);
  }
}
