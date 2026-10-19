import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { dedup, prune, quantize, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { readStoredZip, writeUsdz, type ZipEntry } from "./usdz";

/**
 * Makes a generated model light enough for a phone on cellular. Meshy exports about 4 MB:
 * a 2048-pixel texture that is most of it, and full-precision vertex data. A 1024 texture
 * is indistinguishable on a phone screen, and quantized normals and UVs (a standard glTF
 * extension every viewer we target supports) shave the rest. Nothing changes
 * the shape; this is the same model with less to download.
 */

export const TEXTURE_MAX_SIZE = 1024;
const JPEG_QUALITY = 84;

export async function slimGlb(bytes: Buffer): Promise<Buffer> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength]);
  const document = await io.readBinary(new Uint8Array(bytes));
  await document.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [TEXTURE_MAX_SIZE, TEXTURE_MAX_SIZE], quality: JPEG_QUALITY }),
    // Positions stay float: the quality judge and the USDZ scaling read the accessor bounds
    // as real model units, which integer-quantized positions would break.
    quantize({ pattern: /^(NORMAL|TEXCOORD_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  return Buffer.from(await io.writeBinary(document));
}

/**
 * The USDZ carries its own copy of the texture. Shrink any JPEG or PNG inside it the same
 * way, keeping file names so the USD layer's references still resolve.
 */
export async function slimUsdz(bytes: Buffer): Promise<Buffer> {
  const entries = readStoredZip(bytes);
  const slimmed: ZipEntry[] = [];
  for (const entry of entries) {
    if (/\.(jpe?g|png)$/i.test(entry.name)) {
      const image = sharp(entry.data);
      const meta = await image.metadata();
      if ((meta.width ?? 0) > TEXTURE_MAX_SIZE || (meta.height ?? 0) > TEXTURE_MAX_SIZE || /\.jpe?g$/i.test(entry.name)) {
        const resized = image.resize(TEXTURE_MAX_SIZE, TEXTURE_MAX_SIZE, { fit: "inside", withoutEnlargement: true });
        const data = /\.png$/i.test(entry.name) ? await resized.png().toBuffer() : await resized.jpeg({ quality: JPEG_QUALITY }).toBuffer();
        slimmed.push({ name: entry.name, data });
        continue;
      }
    }
    slimmed.push(entry);
  }
  return writeUsdz(slimmed);
}
