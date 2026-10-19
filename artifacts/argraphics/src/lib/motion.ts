import gsap from 'gsap';
import { Flip } from 'gsap/Flip';

/**
 * GSAP for the dashboard: the core plus Flip, nothing that touches scrolling.
 * The landing page registers its own scroll plugins on top of this.
 */
let registered = false;

export function registerFlip() {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(Flip);
  registered = true;
}

export const EASE_OUT = 'power3.out';
export const EASE_IN_OUT = 'power2.inOut';

/** True when the visitor asked the OS for reduced motion. Checked at call time. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mouse-driven effects (magnetic buttons, tilt, the cursor light) only make sense with a real pointer. */
export function hasFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export { gsap, Flip };
