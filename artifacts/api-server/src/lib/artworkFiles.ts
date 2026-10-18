import type { File } from "@google-cloud/storage";
import { InvalidArtworkError } from "./tableCardArtwork";

/** Artists' own 3D files. 30 MB keeps a textured GLB loadable over bar wifi. */
export const MAX_MODEL_BYTES = 30 * 1024 * 1024;
export const MODEL_TYPES = ["model/gltf-binary", "model/vnd.usdz+zip"] as const;

async function readBounded(file: File, subject: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    throw new InvalidArtworkError(`The ${subject} must be under 30 MB.`);
  }
  const stream = file.createReadStream({ end: maxBytes });
  const timer = setTimeout(() => stream.destroy(new Error(`${subject} read timed out`)), 15_000);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) throw new InvalidArtworkError(`The ${subject} exceeds the 30 MB limit.`);
      chunks.push(bytes);
    }
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  if (length !== size) throw new InvalidArtworkError(`The ${subject} upload is incomplete. Upload it again.`);
  return { bytes: Buffer.concat(chunks, length), contentType: metadata.contentType ?? "" };
}

/**
 * A binary glTF 2.0 container: magic "glTF", version 2, a total length that matches the
 * bytes, and a first chunk of JSON. Anything else is not a model the viewers can load.
 */
export async function validateGlb(file: File): Promise<void> {
  const { bytes, contentType } = await readBounded(file, "3D model", MAX_MODEL_BYTES);
  if (contentType !== "model/gltf-binary") throw new InvalidArtworkError("Upload the 3D model as a .glb file.");
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new InvalidArtworkError("That file is not a binary glTF (.glb) model.");
  }
  if (bytes.readUInt32LE(4) !== 2) throw new InvalidArtworkError("Only glTF 2.0 models are supported.");
  if (bytes.readUInt32LE(8) !== bytes.length) throw new InvalidArtworkError("The .glb file is truncated or padded. Export it again.");
  const chunkLength = bytes.readUInt32LE(12);
  const chunkType = bytes.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a || chunkLength === 0 || 20 + chunkLength > bytes.length) {
    throw new InvalidArtworkError("The .glb file has no scene description.");
  }
  try {
    const scene = JSON.parse(bytes.toString("utf8", 20, 20 + chunkLength)) as { asset?: { version?: string } };
    if (scene?.asset?.version?.split(".")[0] !== "2") throw new Error("version");
  } catch {
    throw new InvalidArtworkError("The .glb file's scene description could not be read.");
  }
}

/** A USDZ is an uncompressed zip; the first local-file header is enough to tell. */
export async function validateUsdz(file: File): Promise<void> {
  const { bytes, contentType } = await readBounded(file, "USDZ model", MAX_MODEL_BYTES);
  if (contentType !== "model/vnd.usdz+zip") throw new InvalidArtworkError("Upload the iPhone model as a .usdz file.");
  if (bytes.length < 30 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new InvalidArtworkError("That file is not a .usdz package.");
  }
  const nameLength = bytes.readUInt16LE(26);
  const name = bytes.toString("utf8", 30, 30 + nameLength).toLowerCase();
  if (!/\.(usd[ac]?|usdz)$/.test(name)) {
    throw new InvalidArtworkError("The .usdz package does not start with a USD scene file.");
  }
}
