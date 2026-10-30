/** A point on the photo as fractions (0–1) of its displayed width and height. */
export type OutlinePoint = [number, number];

/** The server accepts up to 400; a finger trace rarely needs more than this to hug a glass. */
export const MAX_SENT_POINTS = 240;

/** Smallest outline worth sending, as a share of the photo's area. Matches the server. */
const MIN_AREA = 0.005;

export function outlineArea(points: OutlinePoint[]) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** True when the trace encloses enough of the photo to describe an item. */
export function outlineUsable(points: OutlinePoint[]) {
  return points.length >= 3 && outlineArea(points) >= MIN_AREA;
}

/** Evenly thins a long trace so the request stays small; the shape barely changes. */
export function thinOutline(points: OutlinePoint[], max = MAX_SENT_POINTS): OutlinePoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
}

/** The `outline` query value: `x,y;x,y;…`, clamped to the photo and rounded to 4 places. */
export function encodeOutline(points: OutlinePoint[]) {
  return thinOutline(points).map(([x, y]) => `${roundedPoint(x)},${roundedPoint(y)}`).join(';');
}

const roundedPoint = (value: number) => +Math.min(1, Math.max(0, value)).toFixed(4);

/** Parts traced inside the item outline: the drink itself and each garnish, same coordinates. */
export type Parts = { liquid?: OutlinePoint[]; garnish?: OutlinePoint[][] };

/** The `parts` query value, JSON with the same thinning and rounding as the outline. */
export function encodeParts(parts: Parts): string | undefined {
  const loop = (points: OutlinePoint[]) => thinOutline(points).map(([x, y]) => [roundedPoint(x), roundedPoint(y)]);
  const encoded: { liquid?: number[][]; garnish?: number[][][] } = {};
  if (parts.liquid && outlineUsable(parts.liquid)) encoded.liquid = loop(parts.liquid);
  const garnish = (parts.garnish ?? []).filter(outlineUsable).slice(0, 6).map(loop);
  if (garnish.length) encoded.garnish = garnish;
  return encoded.liquid || encoded.garnish ? JSON.stringify(encoded) : undefined;
}
