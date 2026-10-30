import sharp from "sharp";
import type { UvTriangle } from "./glb-glass";

/**
 * Repaints a spot of a drink's texture atlas from the texture around it. Meshy paints the
 * glass wall pale, or with a copy of the garnish; when the owner turns such a spot back into
 * a solid part of the drink, the texels under it are wrong for a drink. So the spot is
 * treated as a hole and filled with texture copied from the model's solid parts:
 *
 *   1. the hole is seeded from its edge inwards, each texel taking the mean of its known
 *      neighbours, so the fill starts with the right colours;
 *   2. then, edge inwards again, each texel takes the centre of the source patch that best
 *      matches its surroundings, so the grain and gradients of the drink are duplicated into
 *      the hole rather than blurred across it.
 *
 * Only texels under solid triangles that are not being filled count as source: the glass's
 * own texels and the atlas's unused padding are never copied. The search runs on a small
 * copy of the atlas and the result is composited back under a feathered mask.
 */

/** Longest side the fill works at; the atlas itself keeps its size. */
const WORK_SIZE = 512;
/** Half the side of the patch compared when choosing a source texel. */
const PATCH = 3;
/** Source candidates tried per hole texel: a sample near the texel, plus a sample from anywhere. */
const NEAR_CANDIDATES = 48;
const FAR_CANDIDATES = 16;
/** How far around a hole texel the nearby candidates are drawn from, in work texels. */
const NEAR_RADIUS = 24;
/** Width of the seam blend between the fill and the texture around it, in atlas texels. */
const FEATHER = 1.5;

export type TextureFillResult = { image: Buffer; mimeType: string; filledShare: number };
export type FillOptions = {
  /**
   * The owner chose the source (a clone stamp): the hole is seeded from the source's own
   * texels rather than whatever borders it in the atlas, and every candidate comes from the
   * source, however far away in the atlas it lies.
   */
  chosenSource?: boolean;
};

/**
 * The atlas with the `hole` triangles repainted from the `source` triangles, encoded as it
 * came (JPEG, WebP or PNG) so the file does not grow, or null when the hole covers no texel
 * or there is nothing to copy from.
 */
export async function fillTextureHole(texture: Buffer, hole: UvTriangle[], source: UvTriangle[], mimeType = "image/png", options: FillOptions = {}): Promise<TextureFillResult | null> {
  if (!hole.length || !source.length) return null;
  const full = await sharp(texture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = full.info;
  const scale = Math.min(1, WORK_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const [holeMask, sourceMask, holeMaskFull] = await Promise.all([
    rasterize(hole, w, h, 1),
    rasterize(source, w, h, 0),
    rasterize(hole, width, height, 1, FEATHER),
  ]);
  const small = scale < 1
    ? await sharp(full.data, { raw: { width, height, channels: 3 } }).resize(w, h, { kernel: "lanczos3" }).raw().toBuffer()
    : Buffer.from(full.data);

  const known = new Uint8Array(w * h);
  const isSource = new Uint8Array(w * h);
  const holeTexels: number[] = [];
  let sourceCount = 0;
  for (let i = 0; i < w * h; i++) {
    const inHole = holeMask[i] > 127;
    if (inHole) holeTexels.push(i);
    else known[i] = 1;
    if (!inHole && sourceMask[i] > 127) { isSource[i] = 1; sourceCount++; }
  }
  if (!holeTexels.length || !sourceCount) return null;
  const sources = new Int32Array(sourceCount);
  for (let i = 0, k = 0; i < w * h; i++) if (isSource[i]) sources[k++] = i;

  const order = peelOrder(holeTexels, known, w, h);
  if (options.chosenSource) {
    // Start every hole texel at the source's mean, then seed from source texels only, so a
    // pale glass border never leaks into the match.
    const mean = [0, 0, 0];
    for (const j of sources) for (let c = 0; c < 3; c++) mean[c] += small[j * 3 + c];
    for (const i of holeTexels) for (let c = 0; c < 3; c++) small[i * 3 + c] = Math.round(mean[c] / sourceCount);
    seedFromEdges(small, order, Uint8Array.from(isSource), w, h);
  } else {
    seedFromEdges(small, order, known, w, h);
  }
  synthesize(small, order, isSource, sources, w, h, options.chosenSource ? 0 : NEAR_CANDIDATES);

  // Back to full size under the feathered mask; outside the hole every texel is the original.
  const filledFull = scale < 1
    ? await sharp(small, { raw: { width: w, height: h, channels: 3 } }).resize(width, height, { kernel: "lanczos3" }).raw().toBuffer()
    : small;
  const out = Buffer.from(full.data);
  for (let i = 0; i < width * height; i++) {
    const m = holeMaskFull[i] / 255;
    if (!m) continue;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - m) + filledFull[i * 3 + c] * m);
  }
  const encoder = sharp(out, { raw: { width, height, channels: 3 } });
  const encoded = mimeType === "image/jpeg" ? encoder.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    : mimeType === "image/webp" ? encoder.webp({ quality: 92 })
    : encoder.png({ compressionLevel: 6 });
  const type = mimeType === "image/jpeg" || mimeType === "image/webp" ? mimeType : "image/png";
  return { image: await encoded.toBuffer(), mimeType: type, filledShare: holeTexels.length / (w * h) };
}

/** The triangles painted white on black at the given size, with a stroke so edge texels are covered. */
async function rasterize(triangles: UvTriangle[], width: number, height: number, stroke: number, blur = 0): Promise<Buffer> {
  const polygons = triangles.map(([ax, ay, bx, by, cx, cy]) =>
    `<polygon points="${(ax * width).toFixed(1)},${(ay * height).toFixed(1)} ${(bx * width).toFixed(1)},${(by * height).toFixed(1)} ${(cx * width).toFixed(1)},${(cy * height).toFixed(1)}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<g fill="#fff" stroke="#fff" stroke-width="${stroke}" stroke-linejoin="round">${polygons}</g></svg>`;
  let image = sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3);
  if (blur) image = image.blur(blur);
  return image.toColourspace("b-w").raw().toBuffer();
}

/**
 * Hole texels ordered from the edge inwards: a texel's ring is one more than the lowest
 * ring of its 4-neighbours, texels outside the hole being ring 0.
 */
function peelOrder(holeTexels: number[], known: Uint8Array, w: number, h: number): Int32Array {
  const ring = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (const i of holeTexels) {
    const x = i % w;
    const y = (i - x) / w;
    const edge = (x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w]);
    if (edge) { ring[i] = 1; queue.push(i); }
  }
  // A hole touching nothing known (the whole atlas) peels from its first texel.
  if (!queue.length && holeTexels.length) { ring[holeTexels[0]] = 1; queue.push(holeTexels[0]); }
  const order: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    order.push(i);
    const x = i % w;
    const y = (i - x) / w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n >= 0 && !known[n] && ring[n] < 0) { ring[n] = ring[i] + 1; queue.push(n); }
    }
  }
  return Int32Array.from(order);
}

/** First pass: each hole texel takes the mean of its already-known 8-neighbours. */
function seedFromEdges(data: Buffer, order: Int32Array, known: Uint8Array, w: number, h: number) {
  for (const i of order) {
    const x = i % w;
    const y = (i - x) / w;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!known[j]) continue;
      r += data[j * 3]; g += data[j * 3 + 1]; b += data[j * 3 + 2]; n++;
    }
    if (n) { data[i * 3] = Math.round(r / n); data[i * 3 + 1] = Math.round(g / n); data[i * 3 + 2] = Math.round(b / n); }
    known[i] = 1;
  }
}

/**
 * Second pass: each hole texel, edge inwards, takes the centre of the source patch whose
 * surroundings best match its own (already seeded) surroundings. Candidates are drawn from
 * near the texel first, where the drink's texture is most alike, plus a few from anywhere.
 */
function synthesize(data: Buffer, order: Int32Array, isSource: Uint8Array, sources: Int32Array, w: number, h: number, nearCandidates: number) {
  let seed = 0x9e3779b9 ^ order.length;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const scratch = new Int32Array(NEAR_CANDIDATES + FAR_CANDIDATES);
  for (const i of order) {
    const x = i % w;
    const y = (i - x) / w;
    // Nearby candidates: source texels in a box around the hole texel, picked at random.
    let count = 0;
    for (let k = 0; k < nearCandidates * 4 && count < nearCandidates; k++) {
      const cx = x + Math.round((random() * 2 - 1) * NEAR_RADIUS);
      const cy = y + Math.round((random() * 2 - 1) * NEAR_RADIUS);
      if (cx < PATCH || cy < PATCH || cx >= w - PATCH || cy >= h - PATCH) continue;
      const j = cy * w + cx;
      if (isSource[j]) scratch[count++] = j;
    }
    // The rest from anywhere in the source: all of them when the source is the owner's choice.
    for (let k = 0, far = NEAR_CANDIDATES + FAR_CANDIDATES - count; k < far; k++) {
      const j = sources[Math.floor(random() * sources.length)];
      const cx = j % w;
      const cy = (j - cx) / w;
      if (cx >= PATCH && cy >= PATCH && cx < w - PATCH && cy < h - PATCH) scratch[count++] = j;
    }
    if (!count) continue;
    let best = -1;
    let bestCost = Infinity;
    for (let k = 0; k < count; k++) {
      const j = scratch[k];
      const cx = j % w;
      const cy = (j - cx) / w;
      let cost = 0;
      for (let dy = -PATCH; dy <= PATCH && cost < bestCost; dy++) {
        const py = y + dy;
        if (py < 0 || py >= h) continue;
        for (let dx = -PATCH; dx <= PATCH; dx++) {
          const px = x + dx;
          if (px < 0 || px >= w) continue;
          const p = (py * w + px) * 3;
          const q = ((cy + dy) * w + cx + dx) * 3;
          const dr = data[p] - data[q], dg = data[p + 1] - data[q + 1], db = data[p + 2] - data[q + 2];
          cost += dr * dr + dg * dg + db * db;
        }
      }
      if (cost < bestCost) { bestCost = cost; best = j; }
    }
    if (best >= 0) { data[i * 3] = data[best * 3]; data[i * 3 + 1] = data[best * 3 + 1]; data[i * 3 + 2] = data[best * 3 + 2]; }
  }
}
