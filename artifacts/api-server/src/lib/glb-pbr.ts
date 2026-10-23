import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import sharp from "sharp";

/**
 * Meshy's PBR maps (metallic, roughness, normal) come back as separate image URLs, and its
 * docs do not promise they are also inside the GLB. Without them every surface gets one flat
 * finish, so sauce, cheese and ice all look like matte clay. This puts any map the GLB is
 * missing onto its material. A slot the file already fills is left alone.
 */

export type PbrMaps = { metallic?: Buffer; roughness?: Buffer; normal?: Buffer };

/** glTF reads roughness from the green channel and metallic from the blue one of a single image. */
export async function packMetallicRoughness(metallic: Buffer | undefined, roughness: Buffer | undefined): Promise<Buffer> {
  const source = sharp(roughness ?? metallic!);
  const { width = 0, height = 0 } = await source.metadata();
  if (!width || !height) throw new Error("PBR map has no size");
  const channel = async (map: Buffer | undefined, fallback: number) => map
    ? (await sharp(map).resize(width, height, { fit: "fill" }).greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true })).data
    : Buffer.alloc(width * height, fallback);
  // A missing roughness map keeps Meshy's flat 0.8; a missing metallic map means not metal.
  const [rough, metal] = await Promise.all([channel(roughness, 204), channel(metallic, 0)]);
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = 255;
    rgb[i * 3 + 1] = rough[i];
    rgb[i * 3 + 2] = metal[i];
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export async function applyPbrMaps(bytes: Buffer, maps: PbrMaps): Promise<Buffer> {
  if (!maps.metallic && !maps.roughness && !maps.normal) return bytes;
  const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength]);
  const document = await io.readBinary(new Uint8Array(bytes));
  const materials = document.getRoot().listMaterials();
  // Meshy bakes everything into one texture atlas on one material. With several materials
  // there is no telling which one the maps belong to, so the model is left as it came.
  if (materials.length !== 1) return bytes;
  const [material] = materials;
  let changed = false;
  if (!material.getMetallicRoughnessTexture() && (maps.metallic || maps.roughness)) {
    const packed = await packMetallicRoughness(maps.metallic, maps.roughness);
    material.setMetallicRoughnessTexture(document.createTexture("metallicRoughness").setImage(new Uint8Array(packed)).setMimeType("image/png"));
    // The factors multiply the map, so leaving Meshy's flat 0 metallic / 0.8 roughness would cancel it.
    material.setMetallicFactor(1).setRoughnessFactor(1);
    changed = true;
  }
  if (!material.getNormalTexture() && maps.normal) {
    const png = await sharp(maps.normal).png().toBuffer();
    material.setNormalTexture(document.createTexture("normal").setImage(new Uint8Array(png)).setMimeType("image/png"));
    changed = true;
  }
  return changed ? Buffer.from(await io.writeBinary(document)) : bytes;
}
