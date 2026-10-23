import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyPbrMaps, packMetallicRoughness } from "../src/lib/glb-pbr";
import { judgeDrinkModel, summarizeGlb } from "../src/lib/glb-quality";
import { slimGlb } from "../src/lib/glb-slim";

/** A real Meshy build from before PBR: colour texture only, flat 0 metallic / 0.8 roughness. */
const demo = readFileSync(new URL("../assets/demo/garden-gimlet.glb", import.meta.url));
const grey = (value: number, size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: { r: value, g: value, b: value } } }).png().toBuffer();
/** A map with real variation; prune() would swap a single-colour one for a plain factor. */
const noise = (size = 64) => sharp(Buffer.from(Array.from({ length: size * size * 3 }, (_, i) => (i * 37) % 256)), { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
const material = async (bytes: Buffer) => {
  const document = await new NodeIO().registerExtensions([KHRMeshQuantization]).readBinary(new Uint8Array(bytes));
  return document.getRoot().listMaterials()[0];
};

describe("PBR maps", () => {
  it("packs roughness into green and metallic into blue, at the roughness map's size", async () => {
    const packed = await packMetallicRoughness(await grey(40, 32), await grey(180, 64));
    const { data, info } = await sharp(packed).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([64, 64]);
    expect([data[0], data[1], data[2]]).toEqual([255, 180, 40]);
  });
  it("adds missing maps to the model and lets them drive the finish", async () => {
    const result = await applyPbrMaps(demo, { metallic: await grey(0), roughness: await grey(90), normal: await grey(128) });
    const mat = await material(result);
    expect(mat.getMetallicRoughnessTexture()).not.toBeNull();
    expect(mat.getNormalTexture()).not.toBeNull();
    expect([mat.getMetallicFactor(), mat.getRoughnessFactor()]).toEqual([1, 1]);
    expect(judgeDrinkModel(summarizeGlb(result))).toBeNull();
  });
  it("returns the model untouched when there are no maps", async () => {
    expect(await applyPbrMaps(demo, {})).toBe(demo);
  });
  it("survives slimming with every map kept", async () => {
    const slimmed = await slimGlb(await applyPbrMaps(demo, { roughness: await noise(), normal: await noise() }));
    const mat = await material(slimmed);
    expect(mat.getBaseColorTexture()?.getMimeType()).toBe("image/jpeg");
    expect(mat.getMetallicRoughnessTexture()).not.toBeNull();
    expect(mat.getNormalTexture()?.getMimeType()).toBe("image/jpeg");
  });
});
