import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Motion building blocks for the landing page. Every effect here is transform/opacity
 * only (compositor-friendly) and collapses to a plain fade, or nothing, when the visitor
 * has asked for reduced motion.
 */

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Mouse-driven effects only make sense with a real pointer. */
function hasFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/* ------------------------------------------------------------ reveals */

/** Fades and lifts a block into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
  as = 'div',
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'li' | 'header' | 'figure' | 'p';
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={style}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: 'blur(6px)' }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: reduce ? 0.3 : 0.7, delay, ease: EASE_OUT }}
    >
      {children}
    </Tag>
  );
}

/** Reveals children one after another. Wrap items in `StaggerItem`. */
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
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      aria-label={ariaLabel}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ staggerChildren: gap, delayChildren: 0.05 }}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'span';
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={style}
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 },
        show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE_OUT } },
      }}
    >
      {children}
    </Tag>
  );
}

/** Headline words that sharpen into place one after another. */
export function SplitWords({ text, delay = 0, step = 0.06 }: { text: string; delay?: number; step?: number }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  return (
    <>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="lp-word-wrap">
          <motion.span
            className="lp-word"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: '0.6em', filter: 'blur(8px)' }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, delay: delay + i * step, ease: EASE_OUT }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </>
  );
}

/* --------------------------------------------------------------- numbers */

/** Counts from 0 to `value` the first time it scrolls into view. */
export function CountUp({ value, duration = 1.6 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const [shown, setShown] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);

  return <span ref={ref}>{shown.toLocaleString()}</span>;
}

/* ----------------------------------------------------------- 3D tilt */

/**
 * A card that tilts toward the cursor and carries a spotlight (`--mx`/`--my` CSS vars
 * for the stylesheet's radial highlight). Pointer-only; touch devices get a flat card.
 */
export function TiltCard({
  children,
  className,
  as = 'div',
  max = 7,
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li';
  max?: number;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const Tag = motion[as];

  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduce || !hasFinePointer()) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    ry.set((px - 0.5) * 2 * max);
    rx.set((0.5 - py) * 2 * max);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <Tag
      ref={ref as never}
      className={`lp-tilt ${className ?? ''}`.trim()}
      style={{ ...style, rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------- magnetic CTA */

/** Nudges its child toward the cursor when hovered, like a magnet. */
export function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 16 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 16 });

  const onMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (reduce || !hasFinePointer()) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
  };
  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      ref={ref}
      className="lp-magnetic"
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      whileTap={reduce ? undefined : { scale: 0.96 }}
    >
      {children}
    </motion.span>
  );
}

/* ------------------------------------------------------------ parallax */

/** Scroll progress (0..1) of an element passing through the viewport. */
export function useSectionProgress(ref: React.RefObject<HTMLElement | null>) {
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  return scrollYProgress;
}

/** A `y` motion value that drifts by ±`distance` px as the section scrolls past. */
export function useDrift(progress: MotionValue<number>, distance: number) {
  const reduce = useReducedMotion();
  const y = useTransform(progress, [0, 1], [distance, -distance]);
  const still = useMotionValue(0);
  return reduce ? still : y;
}

/* --------------------------------------------------------- draw / grow */

/** A bar that grows from the left when it scrolls into view. */
export function GrowBar({ className, delay = 0, style }: { className?: string; delay?: number; style?: CSSProperties }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className={className}
      aria-hidden="true"
      style={{ ...style, transformOrigin: 'left center' }}
      initial={reduce ? { opacity: 0 } : { scaleX: 0 }}
      whileInView={reduce ? { opacity: 1 } : { scaleX: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 1, delay, ease: EASE_OUT }}
    />
  );
}

export { motion, useReducedMotion, useScroll, useTransform, useSpring, useMotionValue };
