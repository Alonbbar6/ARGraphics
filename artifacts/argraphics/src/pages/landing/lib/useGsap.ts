import { useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';
import { gsap, prefersReducedMotion, registerGsap } from './gsap';

/**
 * Runs GSAP setup inside a `gsap.context` scoped to `scope`, and reverts every tween,
 * timeline and ScrollTrigger it created when the component unmounts or `deps` change.
 * This is what keeps a double-mount (React StrictMode) or a route change from leaving
 * orphaned ScrollTriggers behind.
 *
 * `setup` receives the context so it can register cleanup via `ctx.add(...)` if needed.
 */
export function useGsap(
  setup: (ctx: gsap.Context) => void | (() => void),
  deps: DependencyList,
  scope?: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    registerGsap();
    let teardown: void | (() => void);
    const ctx = gsap.context((self) => {
      teardown = setup(self);
    }, scope?.current ?? undefined);
    return () => {
      if (typeof teardown === 'function') teardown();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Live `prefers-reduced-motion` value that updates if the OS setting changes. */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduce;
}
