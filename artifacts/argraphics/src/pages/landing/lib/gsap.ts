import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { EASE_IN_OUT, EASE_OUT, Flip, gsap, hasFinePointer, prefersReducedMotion } from '@/lib/motion';

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

export { EASE_OUT, EASE_IN_OUT, prefersReducedMotion, hasFinePointer };

/** Narrow or portrait viewports get the lighter mobile treatment. */
export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || window.innerHeight > window.innerWidth;
}

export { gsap, ScrollTrigger, SplitText, Flip };
