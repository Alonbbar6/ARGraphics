import { NodeIO, Primitive, type Document, type Material, type Mesh } from "@gltf-transform/core";
import { KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import sharp from "sharp";
import { fillTextureHole } from "./glb-texture-fill";
import { readStoredZip, rootLayerName, writeUsdz } from "./usdz";

/**
 * Meshy builds a drink as one fused shape with one texture, projected from the one photo:
 * the glass is a solid cup, the wall behind the garnish carries a painted copy of it, and the
 * back the camera never saw is a smooth guess. Meshy takes no part labels. So the owner traces
 * the parts on the photo (the drink, the garnish), and after the build every triangle is sorted
 * by where it came from in the photo and whether it sits on the glass wall:
 *
 *   from a garnish loop and off the wall      → solid: the real slice, straw, herbs
 *   from the liquid loop                      → solid: the drink inside the cup
 *   anything else, the painted copy included → glass, stem and base included
 *   no loops traced                           → by colour: pale and colourless is glass
 *
 * The mesh is then split into a solid primitive and a glass primitive. Two primitives, not one
 * texture with alpha, because viewers draw a blended mesh without depth ordering and the rim
 * garnish would flicker behind the wall.
 *
 * Front-facing triangles map straight onto the photo (Meshy's model faces +Z with the photo's
 * x/y, checked on a real build); back-facing ones use the mirrored x, the back being a guess.
 */

export type Loop = Array<[number, number]>;
export type GlassLabels = {
  parts?: { liquid?: Loop; garnish?: Loop[] } | null;
  /** Where the cutout's subject sits in the photo the loops were traced on (0–1). */
  subjectBox?: { x: number; y: number; w: number; h: number } | null;
};

/** The glass primitive: colourless, a touch blue, mostly see-through, glossy. It draws none of
 * the photo's texture, so a painted copy of the garnish on the wall vanishes completely. */
const GLASS_ALPHA = 0.2;
const GLASS_COLOUR: [number, number, number] = [0.92, 0.96, 1];
const GLASS_ROUGHNESS = 0.15;
/** Saturation below the first value is fully glass; above the second, fully solid (colour rule). */
const SATURATION_RAMP: [number, number] = [0.1, 0.26];
/** Lightness (max channel) below the first value is fully solid; above the second, fully glass. */
const LIGHTNESS_RAMP: [number, number] = [0.32, 0.55];
/** The drink's body: an inner surface this far inside the wall (share of height), plus a top. */
const LIQUID_INSET = 0.015;
const LIQUID_ROUGHNESS = 0.35;
/** Outside this range the split is not telling glass apart; the model is left as it came. */
const MIN_GLASS_SHARE = 0.02;
const MAX_GLASS_SHARE = 0.85;
/** A vertex this far from the wall's radius, either side (as a share of height), is not part of the wall. */
const OFF_WALL = 0.04;
const HEIGHT_BINS = 64;

const ramp = (value: number, [from, to]: [number, number]) => Math.min(1, Math.max(0, (value - from) / (to - from)));

/** 1 = clear glass, 0 = solid, from a texel's colour. */
export function glassiness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max ? (max - min) / max : 0;
  return (1 - ramp(saturation, SATURATION_RAMP)) * ramp(max / 255, LIGHTNESS_RAMP);
}

function inLoop(x: number, y: number, loop: Loop): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function percentile(values: number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** A triangle's three UV corners, for the USDZ's texture mask. */
export type UvTriangle = [number, number, number, number, number, number];

/** The drink's body as plain triangles (9 numbers each) in model space, and its colour (linear). */
export type LiquidBody = { positions: Float32Array; colour: [number, number, number] };

export type GlassifiedGlb = {
  glb: Buffer;
  /** The base colour image, as in the GLB. */
  texture: Buffer;
  glassUvTriangles: UvTriangle[];
  glassShare: number;
  liquidBody: LiquidBody | null;
};

export async function glassifyGlb(bytes: Buffer, labels: GlassLabels = {}): Promise<GlassifiedGlb | null> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength]);
  const document = await io.readBinary(new Uint8Array(bytes));
  const materials = document.getRoot().listMaterials();
  const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
  // Meshy bakes everything into one atlas on one primitive; anything else is not ours to guess at.
  if (materials.length !== 1 || primitives.length !== 1) return null;
  const [material] = materials;
  const [primitive] = primitives;
  const mesh = document.getRoot().listMeshes()[0];
  const position = primitive.getAttribute("POSITION");
  const texcoord = primitive.getAttribute("TEXCOORD_0");
  const indices = primitive.getIndices();
  const image = material.getBaseColorTexture()?.getImage();
  if (!position || !texcoord || !indices || !image || primitive.getMode() !== Primitive.Mode.TRIANGLES) return null;
  const vertexCount = position.getCount();
  // Read through the accessors: a slimmed model stores UVs quantized.
  const pos = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const xyz: number[] = [];
  const st: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    position.getElement(i, xyz);
    pos.set(xyz, i * 3);
    texcoord.getElement(i, st);
    uv.set(st, i * 2);
  }
  const idx = indices.getArray()!;

  // Bounds, axis and the wall's radius per height: the median-ish radius in each band is the
  // wall; a vertex well outside it is a garnish, straw or handle.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    for (let k = 0; k < 3; k++) {
      const value = pos[i * 3 + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  const width = max[0] - min[0] || 1;
  const height = max[1] - min[1] || 1;
  const parts = labels.parts ?? undefined;
  const box = labels.subjectBox ?? { x: 0, y: 0, w: 1, h: 1 };
  const labelled = !!(parts?.liquid || parts?.garnish?.length);
  // Where a point of the model sits in the photo. The model faces +Z, so a point on the far
  // side maps to the mirrored x; the back is Meshy's guess from the front anyway.
  const photoPoint = (x: number, y: number, front: boolean): [number, number] => {
    const u = (x - min[0]) / width;
    return [box.x + (front ? u : 1 - u) * box.w, box.y + ((max[1] - y) / height) * box.h];
  };
  const inGarnishLoop = (x: number, y: number, front: boolean) => {
    const [px, py] = photoPoint(x, y, front);
    return !!parts?.garnish?.some((loop) => inLoop(px, py, loop));
  };
  // The axis. With garnish loops, the centre of the extent of everything outside them: the
  // far side of the wall always survives (it maps to the mirrored side of the photo), so the
  // extent is the wall's. Without loops, the centroid: a garnish is a small share of vertices.
  let axisX = 0;
  let axisZ = 0;
  const z0 = (min[2] + max[2]) / 2;
  if (parts?.garnish?.length) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
      const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (inGarnishLoop(x, y, z >= z0)) continue;
      xs.push(x);
      zs.push(z);
    }
    // Trimmed, so a few garnish vertices just outside a loop cannot drag it.
    axisX = (percentile(xs, 0.02) + percentile(xs, 0.98)) / 2;
    axisZ = (percentile(zs, 0.02) + percentile(zs, 0.98)) / 2;
  } else {
    for (let i = 0; i < vertexCount; i++) {
      axisX += pos[i * 3] / vertexCount;
      axisZ += pos[i * 3 + 2] / vertexCount;
    }
  }
  const binOf = (y: number) => Math.min(HEIGHT_BINS - 1, Math.max(0, Math.floor(((y - min[1]) / height) * HEIGHT_BINS)));
  const radii: number[][] = Array.from({ length: HEIGHT_BINS }, () => []);
  const radius = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    radius[i] = Math.hypot(pos[i * 3] - axisX, pos[i * 3 + 2] - axisZ);
    radii[binOf(pos[i * 3 + 1])].push(radius[i]);
  }
  // Each band's wall radius comes from a window of neighbouring bands, so a band that holds
  // mostly garnish still measures against the wall around it.
  const wall = radii.map((_, bin) => percentile(radii.slice(Math.max(0, bin - 2), bin + 3).flat(), 0.6));
  // A garnish disc leans across the rim: its outer half sticks out, its inner half sits
  // inside the bowl's silhouette. Neither is on the wall; the painted copy is.
  const offWall = (i: number) => Math.abs(radius[i] - wall[binOf(pos[i * 3 + 1])]) > OFF_WALL * height;

  // Texels, decoded once: the colour rule where no liquid loop was traced, the drink's colour where one was.
  const decoded = await sharp(Buffer.from(image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const texelAt = (u: number, v: number): [number, number, number] => {
    const { data, info } = decoded;
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const at = (y * info.width + x) * 3;
    return [data[at], data[at + 1], data[at + 2]];
  };
  const colourAt = (u: number, v: number) => glassiness(...texelAt(u, v));

  const triangleCount = idx.length / 3;
  const isGlass = new Uint8Array(triangleCount);
  const isLiquid = new Uint8Array(triangleCount);
  // The drink's colour: the photo's texels on the front of the liquid (the back is a guess).
  const liquidSamples = [0, 0, 0, 0];
  // The drink's height band, for the bowl's underside (which projects below the traced loop).
  let liquidTop = -Infinity;
  let liquidBottom = Infinity;
  if (parts?.liquid) {
    for (const [, v] of parts.liquid) {
      const y = max[1] - ((v - box.y) / box.h) * height;
      liquidTop = Math.max(liquidTop, y);
      liquidBottom = Math.min(liquidBottom, y);
    }
  }
  for (let t = 0; t < triangleCount; t++) {
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    const byColour = () => (colourAt(uv[a * 2], uv[a * 2 + 1]) + colourAt(uv[b * 2], uv[b * 2 + 1]) + colourAt(uv[c * 2], uv[c * 2 + 1])
      + colourAt((uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3)) / 4 >= 0.5;
    let glass: boolean;
    if (labelled) {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      // Which way the triangle faces, from its winding.
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const facingFront = nz >= 0;
      const facingDown = ny < -0.3 * Math.hypot(nx, ny, nz);
      const centreY = (ay + by + cy) / 3;
      const [px, py] = photoPoint((ax + bx + cx) / 3, centreY, facingFront);
      const inGarnish = !!parts!.garnish?.some((loop) => inLoop(px, py, loop));
      let inLiquid = !!parts!.liquid && inLoop(px, py, parts!.liquid);
      // The bowl's underside sits just below the traced drink and faces down; it holds the
      // drink too. The stem is far thinner than the bowl, so it is left out.
      if (parts!.liquid && !inLiquid && facingDown && centreY >= liquidBottom - 0.06 * height && centreY <= liquidTop) {
        const r = (radius[a] + radius[b] + radius[c]) / 3;
        inLiquid = r > 0.35 * wall[binOf(centreY)];
      }
      if (inGarnish) {
        // Off the wall it is the garnish itself; on the wall it is the painted copy, unless
        // the drink sits there too.
        glass = !(offWall(a) || offWall(b) || offWall(c)) && !inLiquid;
      } else if (parts!.liquid) {
        glass = !inLiquid;
      } else {
        glass = byColour();
      }
      if (inLiquid && !glass) {
        isLiquid[t] = 1;
        if (facingFront && !facingDown) {
          const texel = texelAt((uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3);
          liquidSamples[0] += texel[0]; liquidSamples[1] += texel[1]; liquidSamples[2] += texel[2]; liquidSamples[3]++;
        }
      }
    } else {
      glass = byColour();
    }
    isGlass[t] = glass ? 1 : 0;
  }
  smoothLabels(idx, isGlass);
  let glassCount = 0;
  for (let t = 0; t < triangleCount; t++) glassCount += isGlass[t];
  const glassShare = glassCount / triangleCount;
  if (glassShare < MIN_GLASS_SHARE || glassShare > MAX_GLASS_SHARE) return null;

  const split = writeSplit(document, primitive, material, idx, isGlass, uv);
  // The drink's body: a solid behind every clear spot of glass, and a top at the fill line.
  let liquidBody: LiquidBody | null = null;
  if (parts?.liquid && liquidSamples[3] > 0) {
    const srgb = liquidSamples.slice(0, 3).map((sum) => sum / liquidSamples[3] / 255);
    const colour = srgb.map((c) => c ** 2.2) as [number, number, number];
    const positions = buildLiquidBody(pos, idx, isGlass, isLiquid, { axisX, axisZ, radius, wall, binOf, liquidTop, height });
    if (positions.length) {
      liquidBody = { positions, colour };
      addLiquidBody(document, mesh, liquidBody);
    }
  }
  return { glb: Buffer.from(await io.writeBinary(document)), texture: Buffer.from(image), glassUvTriangles: split.glassUvTriangles, glassShare, liquidBody };
}

/**
 * The drink as a body: every liquid triangle copied a little inside the wall and flipped to
 * face the cavity, plus a fan across the bowl at the liquid's top. Meshy's model is a skin,
 * and without this a clear wall shows the empty inside of the far wall.
 */
function buildLiquidBody(pos: Float32Array, idx: ArrayLike<number>, isGlass: Uint8Array, isLiquid: Uint8Array, shape: {
  axisX: number; axisZ: number; radius: Float32Array; wall: number[]; binOf: (y: number) => number; liquidTop: number; height: number;
}): Float32Array {
  const { axisX, axisZ, radius, wall, binOf, liquidTop, height } = shape;
  const out: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    if (isLiquid[t] && !isGlass[t]) insetTriangle(pos, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2], LIQUID_INSET * height, out);
  }
  if (!out.length || !Number.isFinite(liquidTop)) return new Float32Array(out);
  // The top: wall vertices at the fill line, around the axis, a little inside the wall.
  const rim: Array<{ angle: number; x: number; z: number }> = [];
  const band = 0.02 * height;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    if (Math.abs(y - liquidTop) > band) continue;
    if (Math.abs(radius[i] - wall[binOf(y)]) > OFF_WALL * height) continue;
    const dx = pos[i * 3] - axisX;
    const dz = pos[i * 3 + 2] - axisZ;
    rim.push({ angle: Math.atan2(dz, dx), x: axisX + dx * 0.97, z: axisZ + dz * 0.97 });
  }
  rim.sort((p, q) => p.angle - q.angle);
  // One point per ~3°, so a dense rim does not become a jagged fan.
  const ring = rim.filter((point, i) => i === 0 || point.angle - rim[i - 1].angle > 0.05);
  if (ring.length >= 8) {
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % ring.length];
      out.push(axisX, liquidTop, axisZ, q.x, liquidTop, q.z, p.x, liquidTop, p.z);
    }
  }
  return new Float32Array(out);
}

/** One wall triangle copied `inset` inside the wall and flipped to face the cavity, appended to `out`. */
function insetTriangle(pos: Float32Array, a: number, b: number, c: number, inset: number, out: number[]) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const length = Math.hypot(nx, ny, nz);
  if (!length) return;
  nx = (nx / length) * inset; ny = (ny / length) * inset; nz = (nz / length) * inset;
  // Inward is against the outward-facing normal; flipped winding faces the cavity.
  out.push(cx - nx, cy - ny, cz - nz, bx - nx, by - ny, bz - nz, ax - nx, ay - ny, az - nz);
}

/** Puts the body into the mesh as its own primitive, in one flat colour. */
function addLiquidBody(document: Document, mesh: Mesh, body: LiquidBody) {
  const buffer = document.getRoot().listBuffers()[0];
  const material = document.createMaterial("liquid")
    .setBaseColorFactor([...body.colour, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(LIQUID_ROUGHNESS)
    .setDoubleSided(true);
  mesh.addPrimitive(document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor("liquid-body").setType("VEC3").setArray(body.positions).setBuffer(buffer))
    .setMaterial(material));
}

/** The body a stored model already carries, so a re-split can hand it to the USDZ again. */
function readLiquidBody(primitives: Primitive[]): LiquidBody | null {
  const primitive = primitives.find((p) => p.getMaterial()?.getName() === "liquid");
  const position = primitive?.getAttribute("POSITION");
  if (!primitive || !position) return null;
  const [r, g, b] = primitive.getMaterial()!.getBaseColorFactor();
  return { positions: new Float32Array(position.getArray()!), colour: [r, g, b] };
}

/**
 * Two majority-vote passes over edge neighbours: a triangle whose three neighbours mostly carry
 * the other label takes it. Clears speckles and softens the seam between drink and glass
 * without moving any geometry.
 */
function smoothLabels(idx: ArrayLike<number>, isGlass: Uint8Array) {
  const triangleCount = idx.length / 3;
  const byEdge = new Map<string, number[]>();
  const edgeKey = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);
  for (let t = 0; t < triangleCount; t++) {
    const corners = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(corners[k], corners[(k + 1) % 3]);
      const list = byEdge.get(key);
      if (list) list.push(t); else byEdge.set(key, [t]);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(isGlass);
    for (let t = 0; t < triangleCount; t++) {
      const corners = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
      let other = 0;
      let neighbours = 0;
      for (let k = 0; k < 3; k++) {
        for (const n of byEdge.get(edgeKey(corners[k], corners[(k + 1) % 3])) ?? []) {
          if (n === t) continue;
          neighbours++;
          if (isGlass[n] !== isGlass[t]) other++;
        }
      }
      if (neighbours >= 2 && other * 2 > neighbours) next[t] = isGlass[t] ? 0 : 1;
    }
    isGlass.set(next);
  }
}

/** A fresh glass material: no photo texture at all, so nothing painted on the wall shows. */
function glassMaterial(document: Document) {
  return document.createMaterial("glass")
    .setBaseColorFactor([...GLASS_COLOUR, GLASS_ALPHA])
    .setMetallicFactor(0)
    .setRoughnessFactor(GLASS_ROUGHNESS)
    .setAlphaMode("BLEND")
    .setDoubleSided(true);
}

/**
 * Writes the labels back as two primitives on the same vertices: the original keeps Meshy's
 * material for the solid part; a clone with the glass material takes the glass triangles.
 */
function writeSplit(document: Document, primitive: Primitive, material: Material, idx: ArrayLike<number>, isGlass: Uint8Array, uv: Float32Array) {
  const vertexCount = primitive.getAttribute("POSITION")!.getCount();
  const solid: number[] = [];
  const glass: number[] = [];
  const glassUvTriangles: UvTriangle[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (isGlass[t]) {
      glass.push(a, b, c);
      glassUvTriangles.push([uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1], uv[c * 2], uv[c * 2 + 1]]);
    } else {
      solid.push(a, b, c);
    }
  }
  const buffer = document.getRoot().listBuffers()[0];
  const indexArray = (values: number[]) => vertexCount > 65535 ? new Uint32Array(values) : new Uint16Array(values);
  const mesh = document.getRoot().listMeshes().find((m) => m.listPrimitives().includes(primitive))!;
  const oldIndices = primitive.getIndices();
  const glassPrimitive = primitive.clone()
    .setIndices(document.createAccessor("glass-indices").setType("SCALAR").setArray(indexArray(glass)).setBuffer(buffer))
    .setMaterial(glassMaterial(document));
  primitive.setMaterial(material)
    .setIndices(document.createAccessor("solid-indices").setType("SCALAR").setArray(indexArray(solid)).setBuffer(buffer));
  oldIndices?.dispose();
  mesh.addPrimitive(glassPrimitive);
  return { glassUvTriangles };
}

/** A triangle named by its vertex indices, which both primitives share: stable across re-splits. */
export const triangleKey = (a: number, b: number, c: number) => `${a},${b},${c}`;
export type GlassOverrides = Record<string, "solid" | "glass">;

/**
 * Re-splits a stored clear-glass model with the owner's own labels on top: the triangles they
 * lassoed in the studio as solid or glass. Triangles in `fill` are made solid and their spot
 * of the atlas repainted from the other solid parts, and the rewritten atlas stays in the
 * file. Returns null when the model is not a split one.
 */
export type TouchUpSets = {
  /** Triangles made solid with their texture repainted, and the body grown behind them. */
  fill?: ReadonlySet<string>;
  /** Glass triangles that stay clear, with a textured inner surface of the drink added behind them. */
  inside?: ReadonlySet<string>;
  /** Triangles whose texture the fills copy, a clone stamp; empty means the solid parts around them. */
  source?: ReadonlySet<string>;
};

/** Materials of the helper primitives the split adds; neither takes picks nor counts as a part. */
const HELPER_MATERIALS = new Set(["liquid", "inner"]);

export async function resplitGlb(bytes: Buffer, overrides: GlassOverrides, touch: TouchUpSets = {}): Promise<GlassifiedGlb | null> {
  const fill = touch.fill ?? new Set<string>();
  const inside = touch.inside ?? new Set<string>();
  const chosen = touch.source ?? new Set<string>();
  const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength]);
  const document = await io.readBinary(new Uint8Array(bytes));
  const meshes = document.getRoot().listMeshes();
  if (meshes.length !== 1) return null;
  const all = meshes[0].listPrimitives();
  let liquidBody = readLiquidBody(all);
  const primitives = all.filter((p) => !HELPER_MATERIALS.has(p.getMaterial()?.getName() ?? ""));
  const solidPrimitive = primitives.find((p) => p.getMaterial()?.getAlphaMode() === "OPAQUE");
  const glassPrimitive = primitives.find((p) => p.getMaterial()?.getAlphaMode() === "BLEND");
  if (primitives.length !== 2 || !solidPrimitive || !glassPrimitive) return null;
  const material = solidPrimitive.getMaterial()!;
  const image = material.getBaseColorTexture()?.getImage();
  const texcoord = solidPrimitive.getAttribute("TEXCOORD_0");
  if (!image || !texcoord) return null;
  const vertexCount = texcoord.getCount();
  const uv = new Float32Array(vertexCount * 2);
  const st: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    texcoord.getElement(i, st);
    uv.set(st, i * 2);
  }
  const triangles: number[] = [];
  const labels: number[] = [];
  const hole: UvTriangle[] = [];
  const source: UvTriangle[] = [];
  const filledTriangles: number[] = [];
  const insideTriangles: number[] = [];
  const uvTriangle = (a: number, b: number, c: number): UvTriangle => [uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1], uv[c * 2], uv[c * 2 + 1]];
  for (const [primitive, glass] of [[solidPrimitive, 0], [glassPrimitive, 1]] as const) {
    const indices = primitive.getIndices()?.getArray() ?? [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const key = triangleKey(a, b, c);
      const filled = fill.has(key);
      const lined = !filled && inside.has(key);
      const wanted = overrides[key];
      triangles.push(a, b, c);
      // A lined spot keeps a clear wall; its texels are repainted for the inner surface behind it.
      const label = filled ? 0 : lined ? 1 : wanted ? (wanted === "glass" ? 1 : 0) : glass;
      labels.push(label);
      if (filled) { hole.push(uvTriangle(a, b, c)); filledTriangles.push(a, b, c); }
      else if (lined) { hole.push(uvTriangle(a, b, c)); insideTriangles.push(a, b, c); }
      else if (chosen.size ? chosen.has(key) : !label) source.push(uvTriangle(a, b, c));
    }
  }
  const isGlass = Uint8Array.from(labels);
  let glassCount = 0;
  for (const value of isGlass) glassCount += value;
  const glassShare = glassCount / isGlass.length;
  // The filled spots take texture copied from the solid parts; the atlas is rewritten in place.
  let texture: Buffer = Buffer.from(image);
  if (hole.length) {
    const baseColour = material.getBaseColorTexture()!;
    const filled = await fillTextureHole(texture, hole, source, baseColour.getMimeType(), { chosenSource: chosen.size > 0 });
    if (filled) {
      texture = filled.image;
      baseColour.setImage(new Uint8Array(filled.image)).setMimeType(filled.mimeType);
    }
  }
  // The glass primitive is rebuilt from scratch so the old one goes; the helpers are re-added
  // after it, keeping the file order solid, glass, body, inner that the studio's picks rely on.
  glassPrimitive.getIndices()?.dispose();
  glassPrimitive.getMaterial()?.dispose();
  glassPrimitive.dispose();
  const bodyPrimitive = all.find((p) => p.getMaterial()?.getName() === "liquid");
  const innerPrimitive = all.find((p) => p.getMaterial()?.getName() === "inner");
  for (const helper of [bodyPrimitive, innerPrimitive]) if (helper) meshes[0].removePrimitive(helper);
  const split = writeSplit(document, solidPrimitive, material, triangles, isGlass, uv);
  const wall = readWall(solidPrimitive);
  // A filled spot is drink: the body grows behind it, so a wall made clear later shows the
  // drink inside rather than a hollow. The colour is the body's, or the filled texture's own.
  const filledInset = insetTriangles(wall, filledTriangles);
  if (filledInset.length) {
    liquidBody = { positions: concat(liquidBody?.positions, filledInset), colour: liquidBody?.colour ?? await meanColour(texture, hole) };
    if (bodyPrimitive) disposePrimitive(bodyPrimitive);
    addLiquidBody(document, meshes[0], liquidBody);
  } else if (bodyPrimitive) {
    meshes[0].addPrimitive(bodyPrimitive);
  }
  // A lined spot keeps its clear wall and gets the drink's inner surface behind it: the wall
  // triangles copied inside, flipped to face the cavity, drawn with the repainted atlas.
  let inner = readInner(innerPrimitive);
  const linedInset = insetTriangles(wall, insideTriangles);
  if (linedInset.length) {
    const uvs: number[] = [];
    // Flipped winding: the inset copy runs c, b, a.
    for (let t = 0; t < insideTriangles.length; t += 3) {
      for (const corner of [insideTriangles[t + 2], insideTriangles[t + 1], insideTriangles[t]]) uvs.push(uv[corner * 2], uv[corner * 2 + 1]);
    }
    inner = { positions: concat(inner?.positions, linedInset), uvs: concat(inner?.uvs, uvs) };
    if (innerPrimitive) disposePrimitive(innerPrimitive);
    addInner(document, meshes[0], material, inner);
  } else if (innerPrimitive) {
    meshes[0].addPrimitive(innerPrimitive);
  }
  // Quick Look gets one flat-coloured body for both: the inner surface cannot carry the
  // atlas there, where glass texels are made transparent.
  const usdzBody = inner
    ? { positions: concat(liquidBody?.positions, inner.positions), colour: liquidBody?.colour ?? await meanColour(texture, innerUvTriangles(inner)) }
    : liquidBody;
  return { glb: Buffer.from(await io.writeBinary(document)), texture, glassUvTriangles: split.glassUvTriangles, glassShare, liquidBody: usdzBody };
}

type Wall = { pos: Float32Array; inset: number };
type Inner = { positions: Float32Array; uvs: Float32Array };

/** The wall's vertices and the depth a copy sits inside it. */
function readWall(primitive: Primitive): Wall {
  const position = primitive.getAttribute("POSITION")!;
  const vertexCount = position.getCount();
  const pos = new Float32Array(vertexCount * 3);
  const xyz: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    position.getElement(i, xyz);
    pos.set(xyz, i * 3);
    if (xyz[1] < minY) minY = xyz[1];
    if (xyz[1] > maxY) maxY = xyz[1];
  }
  return { pos, inset: LIQUID_INSET * (maxY - minY || 1) };
}

/** Wall triangles copied a little inside the wall and flipped to face the cavity, 9 numbers each. */
function insetTriangles(wall: Wall, triangles: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) insetTriangle(wall.pos, triangles[t], triangles[t + 1], triangles[t + 2], wall.inset, out);
  return out;
}

function concat(head: Float32Array | undefined, tail: ArrayLike<number>): Float32Array {
  const out = new Float32Array((head?.length ?? 0) + tail.length);
  if (head) out.set(head);
  out.set(tail, head?.length ?? 0);
  return out;
}

function disposePrimitive(primitive: Primitive) {
  for (const semantic of primitive.listSemantics()) primitive.getAttribute(semantic)?.dispose();
  primitive.getMaterial()?.dispose();
  primitive.dispose();
}

/** The mean of the texels at the triangles' centres, in linear terms, for a flat body. */
async function meanColour(texture: Buffer, uvTriangles: UvTriangle[]): Promise<[number, number, number]> {
  const { data, info } = await sharp(texture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (const [ax, ay, bx, by, cx, cy] of uvTriangles) {
    const u = (ax + bx + cx) / 3;
    const v = (ay + by + cy) / 3;
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const at = (y * info.width + x) * 3;
    for (let k = 0; k < 3; k++) sum[k] += data[at + k];
  }
  return sum.map((value) => (value / Math.max(1, uvTriangles.length) / 255) ** 2.2) as [number, number, number];
}

/** The inner surface a stored model already carries. */
function readInner(primitive: Primitive | undefined): Inner | null {
  const position = primitive?.getAttribute("POSITION");
  const texcoord = primitive?.getAttribute("TEXCOORD_0");
  if (!position || !texcoord) return null;
  return { positions: new Float32Array(position.getArray()!), uvs: new Float32Array(texcoord.getArray()!) };
}

function innerUvTriangles(inner: Inner): UvTriangle[] {
  const out: UvTriangle[] = [];
  for (let i = 0; i + 5 < inner.uvs.length; i += 6) out.push([inner.uvs[i], inner.uvs[i + 1], inner.uvs[i + 2], inner.uvs[i + 3], inner.uvs[i + 4], inner.uvs[i + 5]]);
  return out;
}

/** Puts the inner surface into the mesh as its own primitive, drawn with the solid part's atlas. */
function addInner(document: Document, mesh: Mesh, material: Material, inner: Inner) {
  const buffer = document.getRoot().listBuffers()[0];
  mesh.addPrimitive(document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor("inner-positions").setType("VEC3").setArray(inner.positions).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor("inner-uvs").setType("VEC2").setArray(inner.uvs).setBuffer(buffer))
    .setMaterial(material.clone().setName("inner").setDoubleSided(true)));
}

/**
 * The same glass in the iPhone AR file. Meshy's USDZ is one binary layer whose material is
 * `/Root/Materials/mat0` with a `PbrPreview` surface fed by `tex_base_color` (the same names
 * with or without PBR maps). A binary layer cannot be split, so the glass goes into the
 * texture's alpha instead: the glass triangles are painted into the atlas, and a small text
 * layer goes in first, sublayers the original, and overrides the texture file and the opacity
 * input. An override of a prim that does not exist is ignored by USD, so a layout we did not
 * expect simply renders as before. Quick Look cannot read WebP, so the texture is a palette
 * PNG: a fifth the size of a full PNG, and a drink atlas has few enough hues for 256 colours.
 */
export async function glassifyUsdz(original: Buffer, texture: Buffer, glassUvTriangles: UvTriangle[], liquidBody: LiquidBody | null = null): Promise<Buffer | null> {
  const entries = readStoredZip(original).filter((entry) => !entry.name.startsWith("argraphics"));
  let layer: string;
  try {
    layer = rootLayerName(entries);
  } catch {
    return null;
  }
  const png = await glassAlphaTexture(texture, glassUvTriangles);
  const glass = [
    "#usda 1.0",
    "(",
    `    subLayers = [ @./${layer}@ ]`,
    ")",
    "",
    'over "Root" {',
    '    over "Materials" {',
    '        over "mat0" {',
    '            over "PbrPreview" {',
    "                float inputs:opacity.connect = </Root/Materials/mat0/tex_base_color.outputs:a>",
    `                float inputs:roughness = ${GLASS_ROUGHNESS}`,
    "                float inputs:ior = 1.5",
    "            }",
    '            over "tex_base_color" {',
    "                asset inputs:file = @./argraphics-glass.png@",
    "                float outputs:a",
    "            }",
    "        }",
    "    }",
    ...(liquidBody ? liquidBodyUsd(liquidBody) : []),
    "}",
    "",
  ].join("\n");
  return writeUsdz([
    { name: "argraphics-glass.usda", data: Buffer.from(glass, "utf8") },
    { name: "argraphics-glass.png", data: png },
    ...entries,
  ]);
}

/** The drink's body as USD text under /Root: one flat-coloured mesh, bound to its own material. */
function liquidBodyUsd(body: LiquidBody): string[] {
  const { positions, colour } = body;
  const count = positions.length / 3;
  const points: string[] = [];
  for (let i = 0; i < count; i++) points.push(`(${positions[i * 3].toFixed(4)}, ${positions[i * 3 + 1].toFixed(4)}, ${positions[i * 3 + 2].toFixed(4)})`);
  const faceCounts = Array.from({ length: count / 3 }, () => "3").join(", ");
  const faceIndices = Array.from({ length: count }, (_, i) => String(i)).join(", ");
  return [
    '    def Xform "ARGraphicsLiquid" {',
    '        def Scope "Materials" {',
    '            def Material "liquid" {',
    "                token outputs:surface.connect = </Root/ARGraphicsLiquid/Materials/liquid/Surface.outputs:surface>",
    '                def Shader "Surface" {',
    '                    uniform token info:id = "UsdPreviewSurface"',
    `                    color3f inputs:diffuseColor = (${colour.map((c) => c.toFixed(4)).join(", ")})`,
    "                    float inputs:metallic = 0",
    `                    float inputs:roughness = ${LIQUID_ROUGHNESS}`,
    "                    token outputs:surface",
    "                }",
    "            }",
    "        }",
    '        def Mesh "LiquidBody" (',
    '            prepend apiSchemas = ["MaterialBindingAPI"]',
    "        ) {",
    "            uniform bool doubleSided = 1",
    `            int[] faceVertexCounts = [${faceCounts}]`,
    `            int[] faceVertexIndices = [${faceIndices}]`,
    `            point3f[] points = [${points.join(", ")}]`,
    "            rel material:binding = </Root/ARGraphicsLiquid/Materials/liquid>",
    '            uniform token subdivisionScheme = "none"',
    "        }",
    "    }",
  ];
}

/**
 * The base colour with the glass triangles painted colourless and their alpha lowered, as a
 * palette PNG. Quick Look has one material, so the glass look lives in the texture.
 */
export async function glassAlphaTexture(texture: Buffer, glassUvTriangles: UvTriangle[]): Promise<Buffer> {
  const { data, info } = await sharp(texture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // glTF texture coordinates start at the image's top left, like SVG.
  const polygons = glassUvTriangles.map(([ax, ay, bx, by, cx, cy]) =>
    `<polygon points="${(ax * width).toFixed(1)},${(ay * height).toFixed(1)} ${(bx * width).toFixed(1)},${(by * height).toFixed(1)} ${(cx * width).toFixed(1)},${(cy * height).toFixed(1)}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<g fill="#fff" stroke="#fff" stroke-width="1">${polygons}</g></svg>`;
  // Where the mask is white the texel is glass: colourless and mostly transparent.
  const mask = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3).blur(0.6).toColourspace("b-w").raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  const glassRgb = GLASS_COLOUR.map((v) => Math.round(v * 255));
  const glassAlpha = Math.round(GLASS_ALPHA * 255);
  for (let i = 0; i < width * height; i++) {
    const m = mask[i] / 255;
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(data[i * 3 + k] * (1 - m) + glassRgb[k] * m);
    rgba[i * 4 + 3] = Math.round(255 * (1 - m) + glassAlpha * m);
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ palette: true, quality: 90, effort: 7 })
    .toBuffer();
}
