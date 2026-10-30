/** Screen-space helpers for the touch-up lasso. Pure, so they can be tested without a canvas. */

export type Point = [number, number];

/** Ray casting: whether a point lies inside a closed loop. */
export function insideLoop(x: number, y: number, loop: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The loop's bounding box, clamped to the view, as integers. */
export function loopBounds(loop: Point[], width: number, height: number) {
  const xs = loop.map(([x]) => x);
  const ys = loop.map(([, y]) => y);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs))),
    y0: Math.max(0, Math.floor(Math.min(...ys))),
    x1: Math.min(width - 1, Math.ceil(Math.max(...xs))),
    y1: Math.min(height - 1, Math.ceil(Math.max(...ys))),
  };
}

/**
 * Triangle ids travel through the picking render as colours. Id 0 is the background, so a
 * triangle's colour is its id plus one, split across the three bytes.
 */
export function encodePickId(id: number): [number, number, number] {
  const value = id + 1;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** The triangle id a pixel's colour names, or -1 for the background. */
export function decodePickId(r: number, g: number, b: number): number {
  return ((r << 16) | (g << 8) | b) - 1;
}

/**
 * Every distinct triangle id painted inside the loop. `pixels` is the picking render's RGBA
 * bytes for the loop's bounding box, rows from the top like the loop's coordinates.
 */
export function pickedIds(pixels: Uint8Array, bounds: { x0: number; y0: number; x1: number; y1: number }, loop: Point[]): Set<number> {
  const width = bounds.x1 - bounds.x0 + 1;
  const ids = new Set<number>();
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (!insideLoop(x + 0.5, y + 0.5, loop)) continue;
      const at = ((y - bounds.y0) * width + (x - bounds.x0)) * 4;
      const id = decodePickId(pixels[at], pixels[at + 1], pixels[at + 2]);
      if (id >= 0) ids.add(id);
    }
  }
  return ids;
}
