import { gsap, hasFinePointer, prefersReducedMotion } from './motion';

/**
 * A colourful trail that follows the cursor across the owner dashboard.
 *
 * One full-viewport canvas sits over the page (pointer-events: none) and never captures
 * input. Each pointer move adds a point; each frame the points age out and the ribbon is
 * redrawn as a tapered stroke, wide and blurred at the head, thin at the tail. The colour
 * walks through a small palette by distance travelled: a fast sweep spreads the whole
 * palette along the trail, a slow drag stays close to one colour. The canvas is faded a
 * little every frame instead of cleared, which leaves the comet tail behind the ribbon.
 *
 * Off under reduced motion and on devices without a fine pointer. The neutral cursor light
 * in cursor-spotlight.ts keeps running beside it.
 */

export type TracerPoint = { x: number; y: number; at: number; tone: number };

/** Rose first (the dashboard accent), then coral, amber, mint and violet, looping back. */
export const PALETTE: ReadonlyArray<[h: number, s: number, l: number]> = [
  [347, 77, 56],
  [16, 90, 60],
  [42, 95, 58],
  [160, 70, 55],
  [265, 80, 66],
];

/** How many CSS pixels of travel it takes to walk once around the palette. */
export const PALETTE_DISTANCE = 1100;
/** Lifetime of a point, in milliseconds. */
export const POINT_LIFE = 700;
/** Stroke width at the head of the ribbon, in CSS pixels. */
export const HEAD_WIDTH = 28;
const MAX_POINTS = 48;
/** The canvas keeps this much of the previous frame; lower leaves a shorter comet tail. */
const KEEP = 0.78;
const MAX_DPR = 1.5;

const wrap = (value: number) => ((value % 1) + 1) % 1;

/** The palette colour at `t` in [0, 1), interpolated along the shorter hue path, as a CSS string. */
export function paletteAt(t: number): string {
  const steps = PALETTE.length;
  const position = wrap(t) * steps;
  const index = Math.floor(position);
  const mix = position - index;
  const [h1, s1, l1] = PALETTE[index];
  const [h2, s2, l2] = PALETTE[(index + 1) % steps];
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const h = (((h1 + delta * mix) % 360) + 360) % 360;
  const s = s1 + (s2 - s1) * mix;
  const l = l1 + (l2 - l1) * mix;
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

/** Stroke widths from the tail (index 0, nearly nothing) to the head (last, `head` wide). */
export function ribbonWidths(count: number, head = HEAD_WIDTH): number[] {
  if (count <= 1) return count === 1 ? [head] : [];
  return Array.from({ length: count }, (_, index) => {
    const along = index / (count - 1);
    // Ease-in so the tail stays thin for most of its length and swells near the head.
    return Math.max(0.5, head * along * along);
  });
}

/** Drops points older than `life` milliseconds; keeps the order. */
export function agePoints(points: TracerPoint[], now: number, life = POINT_LIFE): TracerPoint[] {
  return points.filter((point) => now - point.at < life);
}

export function installCursorTracer(root: HTMLElement): () => void {
  if (prefersReducedMotion() || !hasFinePointer()) return () => undefined;

  const canvas = document.createElement('canvas');
  canvas.className = 'owner-tracer';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return () => undefined;
  root.appendChild(canvas);

  let points: TracerPoint[] = [];
  let travel = 0;
  let last: { x: number; y: number } | null = null;
  let running = false;
  let quietFrames = 0;
  let dpr = 1;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const alpha = () => (document.documentElement.classList.contains('dark') ? 0.85 : 0.4);

  const fade = () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = `rgba(0, 0, 0, ${(1 - KEEP).toFixed(3)})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };

  const draw = () => {
    if (points.length < 2) return;
    const widths = ribbonWidths(points.length);
    const now = performance.now();
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalAlpha = alpha();
    // Soft, wide ribbon first, then a thin bright core so the colour reads at a glance.
    for (const pass of [{ blur: 10, scale: 1 }, { blur: 0, scale: 0.18 }]) {
      context.filter = pass.blur ? `blur(${pass.blur}px)` : 'none';
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        const life = 1 - (now - to.at) / POINT_LIFE;
        if (life <= 0) continue;
        context.strokeStyle = paletteAt(to.tone);
        context.lineWidth = Math.max(0.5, widths[index] * pass.scale * life);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
    }
    context.restore();
  };

  const tick = () => {
    const now = performance.now();
    points = agePoints(points, now);
    fade();
    draw();
    if (points.length < 2) {
      // Let the comet tail fade out, then stop asking for frames.
      if (++quietFrames > 50) {
        stop();
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      quietFrames = 0;
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    quietFrames = 0;
    gsap.ticker.add(tick);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    gsap.ticker.remove(tick);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const x = event.clientX;
    const y = event.clientY;
    if (last) travel += Math.hypot(x - last.x, y - last.y);
    last = { x, y };
    points.push({ x, y, at: performance.now(), tone: travel / PALETTE_DISTANCE });
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
    start();
  };

  const settle = () => {
    last = null;
  };

  const pause = () => {
    if (document.hidden) {
      stop();
      points = [];
      last = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  if (import.meta.env.DEV) {
    (window as unknown as { __tracer?: unknown }).__tracer = {
      points: () => points.length, running: () => running, travel: () => travel, canvas,
    };
  }

  resize();
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', settle);
  document.addEventListener('visibilitychange', pause);
  window.addEventListener('resize', resize);

  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', settle);
    document.removeEventListener('visibilitychange', pause);
    window.removeEventListener('resize', resize);
    stop();
    canvas.remove();
  };
}
