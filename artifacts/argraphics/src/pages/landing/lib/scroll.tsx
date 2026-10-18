import { useEffect, type ReactNode, type RefObject } from 'react';
import { ReactLenis, useLenis } from 'lenis/react';
import 'lenis/dist/lenis.css';
import { gsap, ScrollTrigger, registerGsap } from './gsap';
import { useGsap, useReducedMotion } from './useGsap';

/** Height of the fixed nav, used as the anchor offset. Keep in sync with landing.css. */
export const NAV_HEIGHT = 72;

/**
 * Lenis drives the native scroll position, ScrollTrigger reads it. Wiring them to one
 * ticker (and turning off GSAP's lag smoothing) keeps scrubbed animations from stuttering
 * when the two disagree about time.
 */
function LenisBridge() {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis) return;
    registerGsap();
    const onScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onScroll);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      lenis.off('scroll', onScroll);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [lenis]);
  return null;
}

/** Section heights change when the display font swaps in; re-measure every trigger then. */
function RefreshOnFonts() {
  useEffect(() => {
    registerGsap();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

/**
 * Smooth scrolling for the landing page only. Mounted inside the landing route, so the
 * dashboard keeps native scrolling and Lenis is destroyed on navigation.
 * Under reduced motion there is no Lenis at all; ScrollTrigger still reads native scroll.
 */
export function LandingScroll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <>
        <RefreshOnFonts />
        {children}
      </>
    );
  }
  return (
    <ReactLenis
      root
      options={{
        lerp: 0.1,
        smoothWheel: true,
        syncTouch: false,
        autoRaf: false,
        anchors: { offset: -NAV_HEIGHT },
      }}
    >
      <LenisBridge />
      <RefreshOnFonts />
      {children}
    </ReactLenis>
  );
}

/** Scrolls to a selector or element, through Lenis when it is mounted. */
export function useScrollTo() {
  const lenis = useLenis();
  return (target: string | HTMLElement, options?: { immediate?: boolean; offset?: number }) => {
    const offset = options?.offset ?? -NAV_HEIGHT;
    if (lenis) {
      lenis.scrollTo(target, { offset, immediate: options?.immediate });
      return;
    }
    const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: options?.immediate ? 'auto' : 'smooth' });
  };
}

export type ScrubUpdate = (progress: number, direction: 1 | -1) => void;

/**
 * Smoothed scroll progress (0..1) of a tall "track" element. The chapter keeps its stage
 * `position: sticky` inside the track, so the stage stays on screen while progress runs.
 *
 * `onUpdate` is called from GSAP's ticker; keep it cheap (set a few styles, draw a frame).
 */
export function useScrub(
  trackRef: RefObject<HTMLElement | null>,
  onUpdate: ScrubUpdate,
  options: { scrub?: number | boolean; start?: string; end?: string; enabled?: boolean } = {},
) {
  const { scrub = 0.35, start = 'top top', end = 'bottom bottom', enabled = true } = options;
  useGsap(() => {
    const track = trackRef.current;
    if (!track || !enabled) return;
    const proxy = { p: 0 };
    let last = 0;
    gsap.timeline({
      scrollTrigger: { trigger: track, start, end, scrub, invalidateOnRefresh: true },
    }).to(proxy, {
      p: 1,
      ease: 'none',
      onUpdate: () => {
        const direction: 1 | -1 = proxy.p >= last ? 1 : -1;
        last = proxy.p;
        onUpdate(proxy.p, direction);
      },
    });
    onUpdate(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Linear map of `p` from [a, b] to [0, 1], clamped. */
export function span(p: number, a: number, b: number) {
  if (b === a) return p >= b ? 1 : 0;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

/** Smoothstep ease, for hand-rolled scrub mappings. */
export function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Writes numeric CSS custom properties on an element. The stylesheet does the rest. */
export function setVars(el: HTMLElement | null, vars: Record<string, number | string>) {
  if (!el) return;
  for (const name in vars) {
    const v = vars[name];
    el.style.setProperty(name, typeof v === 'number' ? v.toFixed(4) : v);
  }
}
