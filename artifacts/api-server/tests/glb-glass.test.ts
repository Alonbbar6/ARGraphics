import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { glassAlphaTexture, glassifyGlb, glassifyUsdz, glassiness, resplitGlb, triangleKey, type Loop } from "../src/lib/glb-glass";
import { judgeDrinkModel, summarizeGlb } from "../src/lib/glb-quality";
import { slimGlb, slimUsdz } from "../src/lib/glb-slim";
import { readStoredZip, scaledUsdz, writeUsdz } from "../src/lib/usdz";
import { atlas, cup, H, io, R, SEG } from "./support/cup";

/** A real Meshy build of a spritz in a wine glass. */
const demo = readFileSync(new URL("../assets/demo/blood-orange-spritz.glb", import.meta.url));
const demoUsdz = readFileSync(new URL("../assets/demo/blood-orange-spritz.usdz", import.meta.url));

/** The lower half of the photo is the drink; the garnish sits top right, where the disc projects. */
const liquid: Loop = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
const garnish: Loop = [[0.6, 0], [1, 0], [1, 0.45], [0.6, 0.45]];

const primitives = async (bytes: Buffer) => {
  const document = await io().readBinary(new Uint8Array(bytes));
  return document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
};
/** Triangles per primitive; the drink's body has no index. */
const triangleCount = (bytes: Buffer) => primitives(bytes).then((prims) => prims.map((p) => (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3));

describe("see-through glass from the owner's labels", () => {
  it("scores pale colourless texels as glass and coloured ones as solid", () => {
    expect(glassiness(205, 208, 212)).toBe(1);
    expect(glassiness(240, 150, 30)).toBe(0);
    expect(glassiness(40, 40, 42)).toBe(0);
  });
  it("keeps the drink and the rim slice solid and makes the wall above the drink glass, even where the slice is painted on it", async () => {
    const { glb, bandTriangles, discTriangles } = await cup({ paintedSlice: true });
    const result = await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] }, subjectBox: { x: 0, y: 0, w: 1, h: 1 } });
    expect(result).not.toBeNull();
    const [solid, glass] = await primitives(result!.glb);
    expect(solid.getIndices()!.getCount() / 3).toBe(2 * bandTriangles + discTriangles);
    expect(glass.getIndices()!.getCount() / 3).toBe(2 * bandTriangles);
    expect(glass.getMaterial()!.getAlphaMode()).toBe("BLEND");
    expect(glass.getMaterial()!.getBaseColorFactor()[3]).toBeCloseTo(0.2);
    expect(glass.getMaterial()!.getDoubleSided()).toBe(true);
    expect(solid.getMaterial()!.getAlphaMode()).toBe("OPAQUE");
    // Plain clear glass: nothing painted on the wall can show through it.
    expect(glass.getMaterial()!.getBaseColorTexture()).toBeNull();
    expect(solid.getMaterial()!.getBaseColorTexture()).not.toBeNull();
    expect(result!.glassUvTriangles).toHaveLength(2 * bandTriangles);
  });
  it("without labels, falls back to colour and keeps the painted slice solid", async () => {
    const { glb, bandTriangles } = await cup({ paintedSlice: true });
    const [solid, glass] = await triangleCount((await glassifyGlb(glb))!.glb);
    expect(glass).toBeGreaterThan(bandTriangles * 2 * 0.65);
    expect(glass).toBeLessThan(bandTriangles * 2 * 0.8);
    expect(solid + glass).toBe(bandTriangles * 4 + SEG);
  });
  it("with only the garnish traced, finds the drink by colour but still clears the painted slice", async () => {
    const { glb, bandTriangles, discTriangles } = await cup({ paintedSlice: true });
    // The painted band reaches further left than the slice; the owner traces around all of it.
    const wide: Loop = [[0.35, 0], [1, 0], [1, 0.5], [0.35, 0.5]];
    const [solid, glass] = await triangleCount((await glassifyGlb(glb, { parts: { garnish: [wide] } }))!.glb);
    expect(solid).toBe(2 * bandTriangles + discTriangles);
    expect(glass).toBe(2 * bandTriangles);
  });
  it("gives the bowl's underside to the drink when the traced loop stops at the bowl's edge", async () => {
    // A bottom on the cup: a downward-facing disc at y = 0. The loop stops one wall row short
    // of it, as a trace along the bowl's visible edge does.
    const { glb, bandTriangles, discTriangles } = await cup({ bottom: true });
    const short: Loop = [[0, 0.5], [1, 0.5], [1, 0.95], [0, 0.95]];
    const [solid, glass] = await triangleCount((await glassifyGlb(glb, { parts: { liquid: short, garnish: [garnish] } }))!.glb);
    // The lowest wall row (v 0.95–1) is outside the loop and faces sideways: glass. The bottom
    // disc faces down and is as wide as the bowl: drink.
    expect(solid).toBe(2 * bandTriangles - SEG * 2 + discTriangles + SEG);
    expect(glass).toBe(2 * bandTriangles + SEG * 2);
  });
  it("smooths away a lone triangle with the other label", async () => {
    const { glb, bandTriangles, discTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    // Flip one liquid triangle to glass by hand, then re-split: the vote puts it back.
    const [solidPrim] = await primitives(result.glb);
    const indices = solidPrim.getIndices()!.getArray()!;
    const lone = triangleKey(indices[0], indices[1], indices[2]);
    const again = (await resplitGlb(result.glb, { [lone]: "glass" }))!;
    const [solid, glass] = await triangleCount(again.glb);
    expect(glass).toBe(2 * bandTriangles + 1);
    expect(solid).toBe(2 * bandTriangles + discTriangles - 1);
  });
  it("re-splits a stored model with the owner's own labels and keeps the rest", async () => {
    const { glb, bandTriangles, discTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const [, glassPrim] = await primitives(result.glb);
    const indices = glassPrim.getIndices()!.getArray()!;
    const overrides = Object.fromEntries(Array.from({ length: 10 }, (_, t) => [triangleKey(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]), "solid" as const]));
    const again = (await resplitGlb(result.glb, overrides))!;
    const [solid, glass] = await triangleCount(again.glb);
    expect(solid).toBe(2 * bandTriangles + discTriangles + 10);
    expect(glass).toBe(2 * bandTriangles - 10);
    const prims = await primitives(again.glb);
    expect(prims.map((p) => p.getMaterial()!.getAlphaMode()).slice(0, 2)).toEqual(["OPAQUE", "BLEND"]);
    expect(prims[1].getMaterial()!.getBaseColorTexture()).toBeNull();
    // An unsplit model is refused.
    expect(await resplitGlb(glb, overrides)).toBeNull();
  });
  it("fills in lassoed glass spots: solid again, with texture copied from the drink around them", async () => {
    const { glb, bandTriangles, discTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const [, glassPrim] = await primitives(result.glb);
    const indices = glassPrim.getIndices()!.getArray()!;
    // The whole third band of the wall (grey in the atlas) is filled in.
    const fill = new Set(Array.from({ length: bandTriangles }, (_, t) => triangleKey(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])));
    const again = (await resplitGlb(result.glb, {}, { fill }))!;
    const [solid, glass] = await triangleCount(again.glb);
    expect(solid).toBe(3 * bandTriangles + discTriangles);
    expect(glass).toBe(bandTriangles);
    // The atlas in the file is the repainted one the USDZ gets too.
    const prims = await primitives(again.glb);
    const image = Buffer.from(prims[0].getMaterial()!.getBaseColorTexture()!.getImage()!);
    expect(image.equals(again.texture)).toBe(true);
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    const texel = (u: number, v: number) => {
      const at = (Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * 3;
      return [data[at], data[at + 1], data[at + 2]];
    };
    // Band 2 maps to the atlas's left half at v 0.25–0.5: grey before, now the drink's orange.
    const [r, g, b] = texel(0.25, 0.375);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeLessThan(100);
    // Band 3 (v 0–0.25) was not filled and stays grey; the orange half is untouched.
    expect(texel(0.25, 0.1)).toEqual([205, 208, 212]);
    expect(texel(0.75, 0.75)).toEqual([240, 150, 30]);
    // The drink's body grew behind the filled band, in the body's colour, so a wall made
    // clear again later shows the drink inside rather than a hollow.
    const bodyBefore = result.liquidBody!.positions.length;
    expect(again.liquidBody!.positions.length).toBe(bodyBefore + bandTriangles * 9);
    expect(again.liquidBody!.colour).toEqual(result.liquidBody!.colour);
    expect(prims[2].getMaterial()!.getName()).toBe("liquid");
    expect(prims[2].getAttribute("POSITION")!.getCount()).toBe((bodyBefore + bandTriangles * 9) / 3);
    const clearAgain = (await resplitGlb(again.glb, Object.fromEntries([...fill].map((key) => [key, "glass" as const]))))!;
    expect((await triangleCount(clearAgain.glb)).slice(0, 2)).toEqual([2 * bandTriangles + discTriangles, 2 * bandTriangles]);
    expect(clearAgain.liquidBody!.positions.length).toBe(bodyBefore + bandTriangles * 9);
    // Without a hole nothing is repainted.
    const untouched = (await resplitGlb(result.glb, {}))!;
    expect(untouched.texture.equals(Buffer.from(await atlas()))).toBe(true);
  });
  it("gives a filled spot a body even when the model had none, coloured like the fill", async () => {
    const { glb, bandTriangles } = await cup();
    // No loops traced: the split goes by colour and builds no body.
    const result = (await glassifyGlb(glb))!;
    expect(result.liquidBody).toBeNull();
    const [, glassPrim] = await primitives(result.glb);
    const indices = glassPrim.getIndices()!.getArray()!;
    const fill = new Set(Array.from({ length: bandTriangles }, (_, t) => triangleKey(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])));
    const again = (await resplitGlb(result.glb, {}, { fill }))!;
    expect(again.liquidBody!.positions.length).toBe(bandTriangles * 9);
    const [r, , b] = again.liquidBody!.colour;
    expect(r).toBeGreaterThan(0.5);
    expect(b).toBeLessThan(0.1);
    expect((await primitives(again.glb)).map((p) => p.getMaterial()!.getName())).toEqual(["mat0", "glass", "liquid"]);
  });
  it("copies the owner's chosen texture into a filled spot instead of the drink around it", async () => {
    const { glb, bandTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const [, glassPrim] = await primitives(result.glb);
    const indices = glassPrim.getIndices()!.getArray()!;
    const key = (t: number) => triangleKey(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
    // Fill band 2 (atlas left half, v 0.25–0.5) copying from band 3 (left half, v 0–0.25), which is grey.
    const fill = new Set(Array.from({ length: bandTriangles }, (_, t) => key(t)));
    const source = new Set(Array.from({ length: bandTriangles }, (_, t) => key(bandTriangles + t)));
    const again = (await resplitGlb(result.glb, {}, { fill, source }))!;
    const { data, info } = await sharp(again.texture).raw().toBuffer({ resolveWithObject: true });
    const at = (Math.floor(0.375 * info.height) * info.width + Math.floor(0.25 * info.width)) * 3;
    expect(Math.abs(data[at] - 205)).toBeLessThan(12);
    expect(Math.abs(data[at + 2] - 212)).toBeLessThan(12);
    // The same fill without a chosen source copies the drink: orange.
    const auto = (await resplitGlb(result.glb, {}, { fill }))!;
    const autoData = (await sharp(auto.texture).raw().toBuffer({ resolveWithObject: true })).data;
    expect(autoData[at]).toBeGreaterThan(200);
    expect(autoData[at + 2]).toBeLessThan(100);
  });
  it("fills the inside behind lassoed glass: the wall stays clear and a textured inner surface sits behind it", async () => {
    const { glb, bandTriangles, discTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const [, glassPrim] = await primitives(result.glb);
    const indices = glassPrim.getIndices()!.getArray()!;
    const inside = new Set(Array.from({ length: bandTriangles }, (_, t) => triangleKey(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])));
    const again = (await resplitGlb(result.glb, {}, { inside }))!;
    // The split is unchanged: the lined band is still glass.
    expect((await triangleCount(again.glb)).slice(0, 2)).toEqual([2 * bandTriangles + discTriangles, 2 * bandTriangles]);
    const prims = await primitives(again.glb);
    expect(prims.map((p) => p.getMaterial()!.getName())).toEqual(["mat0", "glass", "liquid", "inner"]);
    const inner = prims[3];
    expect(inner.getAttribute("POSITION")!.getCount()).toBe(bandTriangles * 3);
    expect(inner.getAttribute("TEXCOORD_0")!.getCount()).toBe(bandTriangles * 3);
    // The inner surface draws the same atlas as the solid part, now repainted under the band.
    expect(inner.getMaterial()!.getBaseColorTexture()).toBe(prims[0].getMaterial()!.getBaseColorTexture());
    expect(inner.getMaterial()!.getDoubleSided()).toBe(true);
    const { data, info } = await sharp(again.texture).raw().toBuffer({ resolveWithObject: true });
    const at = (Math.floor(0.375 * info.height) * info.width + Math.floor(0.25 * info.width)) * 3;
    expect(data[at]).toBeGreaterThan(200);
    expect(data[at + 2]).toBeLessThan(100);
    // The inner surface sits just inside the wall, facing the cavity.
    const xyz: number[] = [];
    inner.getAttribute("POSITION")!.getElement(0, xyz);
    expect(Math.hypot(xyz[0], xyz[2])).toBeLessThan(R);
    expect(Math.hypot(xyz[0], xyz[2])).toBeGreaterThan(R * 0.9);
    // Quick Look's flat body covers both the traced drink and the lined spot.
    expect(again.liquidBody!.positions.length).toBe(result.liquidBody!.positions.length + bandTriangles * 9);
    // A later touch-up keeps the inner surface, and lining more adds to it.
    const more = new Set([triangleKey(indices[bandTriangles * 3], indices[bandTriangles * 3 + 1], indices[bandTriangles * 3 + 2])]);
    const later = (await resplitGlb(again.glb, {}, { inside: more }))!;
    const laterPrims = await primitives(later.glb);
    expect(laterPrims.map((p) => p.getMaterial()!.getName())).toEqual(["mat0", "glass", "liquid", "inner"]);
    expect(laterPrims[3].getAttribute("POSITION")!.getCount()).toBe(bandTriangles * 3 + 3);
    const plain = (await resplitGlb(later.glb, {}))!;
    expect((await primitives(plain.glb))[3].getAttribute("POSITION")!.getCount()).toBe(bandTriangles * 3 + 3);
  });
  it("gives the drink a body: an inner surface behind the wall and a top at the fill line, in the drink's colour", async () => {
    const { glb, bandTriangles } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    expect(result.liquidBody).not.toBeNull();
    const prims = await primitives(result.glb);
    expect(prims).toHaveLength(3);
    const body = prims[2];
    expect(body.getMaterial()!.getName()).toBe("liquid");
    expect(body.getMaterial()!.getAlphaMode()).toBe("OPAQUE");
    // Orange (240,150,30) in linear terms: red high, blue low.
    const [r, g, b] = body.getMaterial()!.getBaseColorFactor();
    expect(r).toBeGreaterThan(0.8);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeLessThan(0.05);
    // Every liquid triangle copied inside the wall, plus a fan across the top.
    const positions = body.getAttribute("POSITION")!;
    expect(positions.getCount() / 3).toBe(2 * bandTriangles + SEG);
    const xyz: number[] = [];
    let inside = 0;
    let onTop = 0;
    for (let i = 0; i < positions.getCount(); i++) {
      positions.getElement(i, xyz);
      if (Math.hypot(xyz[0], xyz[2]) < R - 0.01) inside++;
      if (Math.abs(xyz[1] - H / 2) < 0.001) onTop++;
    }
    expect(inside).toBe(positions.getCount());
    expect(onTop).toBeGreaterThanOrEqual(SEG * 3);
    expect(result.liquidBody!.positions.length).toBe(positions.getCount() * 3);
    // A later re-split keeps the body and hands it on.
    const again = (await resplitGlb(result.glb, {}))!;
    expect((await primitives(again.glb))).toHaveLength(3);
    expect(again.liquidBody!.positions.length).toBe(positions.getCount() * 3);
    expect(again.liquidBody!.colour[0]).toBeCloseTo(r, 3);
  });
  it("writes the body into the iPhone file as its own mesh", async () => {
    const { glb } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const glassed = (await glassifyUsdz(demoUsdz, result.texture, result.glassUvTriangles, result.liquidBody))!;
    const layer = readStoredZip(glassed)[0].data.toString("utf8");
    expect(layer).toContain('def Mesh "LiquidBody"');
    expect(layer).toContain('rel material:binding = </Root/ARGraphicsLiquid/Materials/liquid>');
    expect(layer).toMatch(/inputs:diffuseColor = \(0\.8\d+, 0\.\d+, 0\.0\d+\)/);
    expect((layer.match(/\(/g) ?? []).length).toBeGreaterThan(result.liquidBody!.positions.length / 3);
  });
  it("leaves a model alone when nothing or nearly everything would be glass", async () => {
    const { glb } = await cup();
    expect(await glassifyGlb(glb, { parts: { liquid: [[0, 0], [1, 0], [1, 1], [0, 1]] } })).toBeNull();
  });
  it("splits a real build and keeps it a good model through slimming", async () => {
    const result = await glassifyGlb(demo);
    expect(result).not.toBeNull();
    expect(result!.glassShare).toBeGreaterThan(0.1);
    expect(result!.glassShare).toBeLessThan(0.6);
    expect(judgeDrinkModel(summarizeGlb(result!.glb))).toBeNull();
    const slimmed = await slimGlb(result!.glb);
    const prims = await primitives(slimmed);
    expect(prims).toHaveLength(2);
    expect(prims.map((p) => p.getMaterial()!.getAlphaMode()).sort()).toEqual(["BLEND", "OPAQUE"]);
    expect(prims[0].getMaterial()!.getBaseColorTexture()!.getMimeType()).toBe("image/jpeg");
    expect(slimmed.length).toBeLessThan(demo.length * 1.5);
  });
  it("paints the glass triangles into the texture's alpha for Quick Look", async () => {
    const { glb } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const png = await glassAlphaTexture(result.texture, result.glassUvTriangles);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (u: number, v: number) => data[(Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * 4 + 3];
    expect(alphaAt(0.2, 0.2)).toBeLessThan(90); // upper wall, grey half
    const rgbAt = (u: number, v: number) => { const o = (Math.floor(v * info.height) * info.width + Math.floor(u * info.width)) * 4; return [data[o], data[o + 1], data[o + 2]]; };
    expect(rgbAt(0.2, 0.2)[2]).toBeGreaterThan(240); // painted colourless
    expect(rgbAt(0.7, 0.8)[0]).toBeGreaterThan(200); // the drink keeps its orange
    expect(alphaAt(0.7, 0.8)).toBe(255); // lower wall, orange half
    expect(alphaAt(0.75, 0.5)).toBe(255); // the disc
    expect(png.length).toBeLessThan(result.texture.length * 2);
  });
  it("puts a glass layer first in the USDZ that overrides the texture and opacity", async () => {
    const { glb } = await cup();
    const result = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
    const glassed = await glassifyUsdz(demoUsdz, result.texture, result.glassUvTriangles);
    expect(glassed).not.toBeNull();
    const entries = readStoredZip(glassed!);
    expect(entries[0].name).toBe("argraphics-glass.usda");
    expect(entries[1].name).toBe("argraphics-glass.png");
    const layer = entries[0].data.toString("utf8");
    expect(layer).toContain(`subLayers = [ @./${readStoredZip(demoUsdz).find((e) => /\.usdc$/.test(e.name))!.name}@ ]`);
    expect(layer).toContain("inputs:opacity.connect = </Root/Materials/mat0/tex_base_color.outputs:a>");
    expect(layer).toContain("inputs:file = @./argraphics-glass.png@");
    // Scaling for Quick Look sublayers the glass layer, which sublayers Meshy's.
    const scaled = readStoredZip(scaledUsdz(glassed!, 0.1));
    expect(scaled[0].name).toBe("argraphics.usda");
    expect(scaled[0].data.toString("utf8")).toContain("@./argraphics-glass.usda@");
    expect(scaled[1].name).toBe("argraphics-glass.usda");
    // Slimming keeps the PNG's alpha and the layer order; a second pass replaces, not stacks.
    const slimmed = readStoredZip(await slimUsdz(glassed!));
    expect(slimmed.map((e) => e.name).slice(0, 2)).toEqual(["argraphics-glass.usda", "argraphics-glass.png"]);
    expect((await sharp(slimmed[1].data).stats()).channels).toHaveLength(4);
    const twice = await glassifyUsdz(glassed!, result.texture, result.glassUvTriangles);
    expect(readStoredZip(twice!).filter((e) => e.name.startsWith("argraphics-glass"))).toHaveLength(2);
  });
  it("also handles a build with PBR maps, which carries several images", async () => {
    const usdc = Buffer.from("PXR-USDC stand-in", "utf8");
    const pbr = writeUsdz([{ name: "model.x.usdc", data: usdc }, { name: "extracted_image_0.png", data: usdc }, { name: "extracted_image_1.jpg", data: usdc }, { name: "extracted_image_2.jpg_roughness.png", data: usdc }]);
    const glassed = await glassifyUsdz(pbr, await atlas(), [[0, 0, 0.5, 0, 0, 0.5]]);
    expect(readStoredZip(glassed!).map((e) => e.name)).toEqual(["argraphics-glass.usda", "argraphics-glass.png", "model.x.usdc", "extracted_image_0.png", "extracted_image_1.jpg", "extracted_image_2.jpg_roughness.png"]);
  });
  it("leaves a file with no USD layer alone", async () => {
    expect(await glassifyUsdz(writeUsdz([{ name: "tex.jpg", data: Buffer.alloc(10) }]), await atlas(), [])).toBeNull();
  });
});
