import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { gsap, hasFinePointer, ScrollTrigger } from '../lib/gsap';
import { useGsap, useReducedMotion } from '../lib/useGsap';

/* ------------------------------------------------------------------ brand */

export function Wordmark() {
  return (
    <Link href="/" className="lp-wordmark" aria-label="ARGraphics home">
      <span className="lp-mark" aria-hidden="true" />
      <span>ARGraphics</span>
    </Link>
  );
}

/** Chapter marker: "02 — The problem". A storytelling device, not a dashboard label. */
export function Chapter({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="lp-chapter">
      <span className="lp-chapter-n">{n}</span>
      <span className="lp-chapter-rule" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------ magnetic CTA */

/** Nudges its child toward the cursor on hover. Pointer devices only. */
export function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  useGsap(() => {
    const el = ref.current;
    if (!el || reduce || !hasFinePointer()) return;
    const toX = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
    const toY = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      toX((event.clientX - (rect.left + rect.width / 2)) * strength);
      toY((event.clientY - (rect.top + rect.height / 2)) * strength);
    };
    const onLeave = () => {
      toX(0);
      toY(0);
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [reduce, strength]);

  return (
    <span ref={ref} className="lp-magnetic">
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- reveal */

/** Fades and lifts a block the first time it scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: 'div' | 'li' | 'header' | 'figure' | 'p' | 'section';
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useGsap(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      gsap.set(el, { autoAlpha: 1 });
      return;
    }
    gsap.fromTo(
      el,
      { autoAlpha: 0, y },
      { autoAlpha: 1, y: 0, duration: 0.9, delay, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } },
    );
  }, [reduce, delay, y]);
  const Tag = as;
  return (
    <Tag ref={ref as never} className={`lp-reveal${className ? ` ${className}` : ''}`}>
      {children}
    </Tag>
  );
}

/** Reveals direct children one after another. */
export function Stagger({
  children,
  className,
  as = 'div',
  gap = 0.09,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'ul' | 'ol';
  gap?: number;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useGsap(() => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.children);
    if (reduce) {
      gsap.set(items, { autoAlpha: 1 });
      return;
    }
    gsap.fromTo(
      items,
      { autoAlpha: 0, y: 24 },
      { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: gap, scrollTrigger: { trigger: el, start: 'top 85%', once: true } },
    );
  }, [reduce, gap]);
  const Tag = as;
  return (
    <Tag ref={ref as never} className={`lp-stagger${className ? ` ${className}` : ''}`} aria-label={ariaLabel}>
      {children}
    </Tag>
  );
}

/* --------------------------------------------------------------- numbers */

/** Counts up to `value` when it scrolls into view, or when `progress` (0..1) is driven. */
export function CountUp({ value, duration = 1.6 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useGsap(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = value.toLocaleString();
      return;
    }
    const proxy = { v: 0 };
    gsap.to(proxy, {
      v: value,
      duration,
      ease: 'power3.out',
      snap: { v: 1 },
      onUpdate: () => {
        el.textContent = Math.round(proxy.v).toLocaleString();
      },
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  }, [value, duration, reduce]);
  return <span ref={ref}>0</span>;
}

/* ------------------------------------------------------------------- nav */

/** Adds `is-scrolled` past the top and `is-hidden` while scrolling down. */
export function useNavState(ref: React.RefObject<HTMLElement | null>) {
  useGsap(() => {
    const el = ref.current;
    if (!el) return;
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const y = self.scroll();
        el.classList.toggle('is-scrolled', y > 24);
        el.classList.toggle('is-hidden', self.direction === 1 && y > 160);
      },
    });
  }, []);
}

/* ------------------------------------------------------------------- faq */

export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const base = useId().replace(/:/g, '');
  const panelId = `faq-panel-${base}`;
  const buttonId = `faq-button-${base}`;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    gsap.killTweensOf(panel);
    if (reduce) {
      gsap.set(panel, { height: open ? 'auto' : 0, autoAlpha: open ? 1 : 0 });
      return;
    }
    if (open) {
      gsap.set(panel, { height: 'auto', autoAlpha: 1 });
      gsap.from(panel, { height: 0, autoAlpha: 0, duration: 0.4, ease: 'power3.out' });
    } else {
      gsap.to(panel, { height: 0, autoAlpha: 0, duration: 0.3, ease: 'power2.inOut' });
    }
  }, [open, reduce]);

  return (
    <div className={`lp-faq-item${open ? ' is-open' : ''}`}>
      <h3 className="lp-faq-q">
        <button
          type="button"
          id={buttonId}
          className="lp-faq-button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{q}</span>
          <ChevronDown size={20} aria-hidden="true" className="lp-faq-chevron" />
        </button>
      </h3>
      <div ref={panelRef} className="lp-faq-panel-wrap" style={{ height: 0, opacity: 0, visibility: 'hidden' }}>
        <div id={panelId} role="region" aria-labelledby={buttonId} className="lp-faq-panel">
          <p>{a}</p>
        </div>
      </div>
    </div>
  );
}
