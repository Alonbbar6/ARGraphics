/**
 * Pure helpers for scroll-scrubbed image sequences (no DOM, unit-tested in node).
 *
 * A sequence lives in `public/sequences/<name>/` as a `manifest.json` plus one folder per
 * set (desktop, mobile). The dev-only baker at /dev/bake writes this layout.
 */

export type FrameFormat = 'webp' | 'avif' | 'jpg' | 'png';

export type FrameSet = {
  /** Folder relative to the manifest, or an absolute URL. */
  dir: string;
  count: number;
  width: number;
  height: number;
  format: FrameFormat;
  /** Zero-padding of the frame number in file names. Default 4 (`0000.webp`). */
  pad?: number;
};

export type FrameManifest = {
  name: string;
  version: 1;
  /** Relative to the manifest. Shown until the first batch decodes and under reduced motion. */
  poster: string;
  /** Optional autoplay before the visitor scrolls, in frames of the chosen set. */
  intro?: { endFrame: number; durationMs: number };
  sets: { desktop: FrameSet; mobile?: FrameSet };
  /** Free-form notes from the baker (source model, lighting), kept for regeneration. */
  source?: Record<string, unknown>;
};

export type Rect = { dx: number; dy: number; dw: number; dh: number };

/** Mobile set for narrow or portrait viewports, when the manifest has one. */
export function pickFrameSet(manifest: FrameManifest, viewportWidth: number, viewportHeight: number): FrameSet {
  const mobile = manifest.sets.mobile;
  if (mobile && (viewportWidth < 768 || viewportHeight > viewportWidth)) return mobile;
  return manifest.sets.desktop;
}

function isAbsolute(url: string) {
  return /^(https?:)?\/\//.test(url) || url.startsWith('/');
}

/** Joins URL segments without doubling or dropping slashes. */
export function joinUrl(...parts: string[]) {
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/');
}

/** Resolves a manifest-relative path against the manifest's folder. */
export function resolveFromManifest(manifestUrl: string, path: string) {
  if (isAbsolute(path)) return path;
  const folder = manifestUrl.replace(/[^/]*$/, '');
  return joinUrl(folder, path);
}

/** URL of frame `index` in `set`. */
export function frameUrl(manifestUrl: string, set: FrameSet, index: number) {
  const pad = set.pad ?? 4;
  const name = `${String(index).padStart(pad, '0')}.${set.format}`;
  return joinUrl(resolveFromManifest(manifestUrl, set.dir), name);
}

/** Maps scroll progress 0..1 to a frame index, clamped to the set. */
export function progressToIndex(progress: number, count: number) {
  if (count <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return Math.min(count - 1, Math.round(clamped * (count - 1)));
}

/**
 * Load order: a small priority batch first (the frames the visitor sees before scrolling),
 * then the rest in fixed-size batches. Returns `[start, end)` ranges.
 */
export function batchRanges(count: number, first = 10, batch = 30): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (count <= 0) return ranges;
  let start = 0;
  let size = Math.min(first, count);
  while (start < count) {
    const end = Math.min(count, start + size);
    ranges.push([start, end]);
    start = end;
    size = batch;
  }
  return ranges;
}

/** Destination rectangle that covers `dw`×`dh` with a `sw`×`sh` image, centred. */
export function coverRect(sw: number, sh: number, dw: number, dh: number, focusY = 0.5): Rect {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { dx: 0, dy: 0, dw: 0, dh: 0 };
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { dx: (dw - w) / 2, dy: (dh - h) * focusY + 0, dw: w, dh: h };
}

/** Destination rectangle that fits the whole image inside `dw`×`dh`, centred. */
export function containRect(sw: number, sh: number, dw: number, dh: number, focusY = 0.5): Rect {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { dx: 0, dy: 0, dw: 0, dh: 0 };
  const scale = Math.min(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { dx: (dw - w) / 2, dy: (dh - h) * focusY + 0, dw: w, dh: h };
}

/**
 * Which frames to keep decoded around `center`. Decoded bitmaps are big (a 1080p frame
 * is ~8 MB of GPU memory), so phones only hold a sliding window.
 */
export function residentWindow(center: number, count: number, maxResident: number): [number, number] {
  if (count <= 0) return [0, 0];
  if (maxResident >= count) return [0, count];
  const half = Math.floor(maxResident / 2);
  let start = Math.max(0, center - half);
  const end = Math.min(count, start + maxResident);
  start = Math.max(0, end - maxResident);
  return [start, end];
}
