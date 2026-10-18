import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { Flip } from 'gsap/Flip';

/**
 * One place that registers the GSAP plugins the landing page uses. Safe to call many
 * times; everything after the first call is a no-op. Dashboard pages never import this,
 * so ScrollTrigger only exists while the landing page is mounted.
 */
let registered = false;

export function registerGsap() {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger, SplitText, Flip);
  // The iOS address bar collapsing fires resize; a refresh storm there re-pins everything.
  ScrollTrigger.config({ ignoreMobileResize: true });
  registered = true;
}

export const EASE_OUT = 'power3.out';
export const EASE_IN_OUT = 'power2.inOut';

/** True when the visitor asked the OS for reduced motion. Checked at call time. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mouse-driven effects (magnetic buttons, tilt) only make sense with a real pointer. */
export function hasFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Narrow or portrait viewports get the lighter mobile treatment. */
export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || window.innerHeight > window.innerWidth;
}

export { gsap, ScrollTrigger, SplitText, Flip };
