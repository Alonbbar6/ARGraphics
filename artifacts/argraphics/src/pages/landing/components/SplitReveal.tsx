import { createElement, forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { EASE_OUT, gsap, SplitText } from '../lib/gsap';
import { useGsap, useReducedMotion } from '../lib/useGsap';

export type SplitRevealHandle = {
  play: () => void;
  reverse: () => void;
};

type Tag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div' | 'li';

type Props = {
  as?: Tag;
  /** `lines` for body copy and most headings, `chars` for the one big hero line. */
  type?: 'lines' | 'words' | 'chars';
  /**
   * `scroll`: play when the element enters the viewport (default).
   * `mount`: play right away.
   * `manual`: the parent calls `play()` / `reverse()` on the handle (pinned chapters).
   */
  playOn?: 'scroll' | 'mount' | 'manual';
  delay?: number;
  stagger?: number;
  duration?: number;
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Text that rises into place line by line (or letter by letter). The DOM keeps the original
 * text and SplitText adds `aria-label` on the element and hides the split spans from
 * assistive tech. Under reduced motion the text simply appears.
 */
export const SplitReveal = forwardRef<SplitRevealHandle, Props>(function SplitReveal(
  { as = 'p', type = 'lines', playOn = 'scroll', delay = 0, stagger, duration, id, className, children },
  ref,
) {
  const elRef = useRef<HTMLElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const reduce = useReducedMotion();

  useImperativeHandle(ref, () => ({
    play: () => tweenRef.current?.play(),
    reverse: () => tweenRef.current?.reverse(),
  }));

  useGsap(
    (ctx) => {
      const el = elRef.current;
      if (!el) return;
      if (reduce) {
        gsap.set(el, { autoAlpha: 1 });
        return;
      }
      let split: SplitText | null = null;
      let cancelled = false;
      // Split after the display font is in, or line breaks move and the mask is wrong.
      document.fonts.ready.then(() => {
        if (cancelled) return;
        ctx.add(() => {
          split = SplitText.create(el, {
            type: type === 'chars' ? 'chars,words,lines' : type === 'words' ? 'words,lines' : 'lines',
            mask: type === 'chars' ? 'chars' : 'lines',
            autoSplit: true,
            aria: 'auto',
            linesClass: 'lp-split-line',
            wordsClass: 'lp-split-word',
            charsClass: 'lp-split-char',
            onSplit: (self) => {
              const targets = type === 'chars' ? self.chars : type === 'words' ? self.words : self.lines;
              const tween = gsap.from(targets, {
                yPercent: 110,
                opacity: type === 'lines' ? 1 : 0.001,
                duration: duration ?? (type === 'chars' ? 0.9 : 1),
                ease: EASE_OUT,
                stagger: stagger ?? (type === 'chars' ? 0.018 : type === 'words' ? 0.05 : 0.11),
                delay,
                paused: playOn === 'manual',
                scrollTrigger:
                  playOn === 'scroll'
                    ? { trigger: el, start: 'top 85%', once: true }
                    : undefined,
              });
              tweenRef.current = tween;
              return tween;
            },
          });
        });
      });
      return () => {
        cancelled = true;
        split?.revert();
        tweenRef.current = null;
      };
    },
    [reduce, type, playOn, delay, stagger, duration],
  );

  return createElement(as, { ref: elRef, id, className: `lp-split${className ? ` ${className}` : ''}` }, children);
});
