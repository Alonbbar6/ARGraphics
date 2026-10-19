import { gsap, hasFinePointer, prefersReducedMotion } from './motion';

/**
 * A soft light that follows the cursor across the dashboard's cards.
 *
 * One listener on the owner root tracks the pointer. Each frame the lit point eases toward
 * it (so the light lags and settles instead of snapping), then every card surface on the
 * page gets the cursor in its own coordinates as CSS variables: `--mx`, `--my` and `--spot`
 * (1 when the cursor is near, 0 when it is not). The cards draw the light themselves with a
 * `::before` radial gradient, see owner.css, partner.css and shelf.css.
 *
 * Off under reduced motion and on devices without a fine pointer.
 */
export const SPOTLIGHT_SURFACES = '.owner-stat, .pa-card, .owner-panel, .shelf-stage';

/** How far outside a card's edge the light still reaches, in CSS pixels. */
const REACH = 240;
/** Ease rate per second; higher settles faster. */
const RATE = 11;
const SETTLED = 0.4;

export function installCursorSpotlight(root: HTMLElement): () => void {
  if (prefersReducedMotion() || !hasFinePointer()) return () => undefined;

  const target = { x: Number.NaN, y: Number.NaN };
  const point = { x: Number.NaN, y: Number.NaN };
  let lit = new Set<HTMLElement>();
  let running = false;

  const paint = () => {
    const next = new Set<HTMLElement>();
    root.querySelectorAll<HTMLElement>(SPOTLIGHT_SURFACES).forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
      const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      if (Math.hypot(dx, dy) < REACH) {
        card.style.setProperty('--mx', `${(point.x - rect.left).toFixed(1)}px`);
        card.style.setProperty('--my', `${(point.y - rect.top).toFixed(1)}px`);
        card.style.setProperty('--spot', '1');
        next.add(card);
      } else if (lit.has(card)) {
        card.style.setProperty('--spot', '0');
      }
    });
    for (const card of lit) if (!next.has(card)) card.style.setProperty('--spot', '0');
    lit = next;
  };

  const tick = (_time: number, deltaMs: number) => {
    const k = 1 - Math.exp(-(deltaMs / 1000) * RATE);
    point.x += (target.x - point.x) * k;
    point.y += (target.y - point.y) * k;
    if (Math.abs(target.x - point.x) < SETTLED && Math.abs(target.y - point.y) < SETTLED) {
      point.x = target.x;
      point.y = target.y;
      paint();
      stop();
      return;
    }
    paint();
  };

  const start = () => {
    if (running) return;
    running = true;
    gsap.ticker.add(tick);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    gsap.ticker.remove(tick);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    target.x = event.clientX;
    target.y = event.clientY;
    if (Number.isNaN(point.x)) {
      // First contact: appear where the cursor is instead of sliding in from nowhere.
      point.x = target.x;
      point.y = target.y;
      paint();
      return;
    }
    start();
  };

  const dim = () => {
    stop();
    for (const card of lit) card.style.setProperty('--spot', '0');
    lit.clear();
    point.x = point.y = target.x = target.y = Number.NaN;
  };

  // Scrolling moves the cards under a still cursor.
  const onScroll = () => {
    if (!Number.isNaN(point.x) && !running) paint();
  };

  if (import.meta.env.DEV) {
    (window as unknown as { __spotlight?: unknown }).__spotlight = { point, target, paint, lit: () => lit.size, running: () => running };
  }
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', dim);
  document.addEventListener('visibilitychange', dim);
  window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', dim);
    document.removeEventListener('visibilitychange', dim);
    window.removeEventListener('scroll', onScroll);
    stop();
    for (const card of lit) {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
      card.style.removeProperty('--spot');
    }
    lit.clear();
  };
}
