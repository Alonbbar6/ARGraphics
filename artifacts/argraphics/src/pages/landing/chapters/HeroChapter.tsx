import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { ScrollCanvas, type ScrollCanvasHandle, type ScrollCanvasStatus } from '../components/ScrollCanvas';
import { SplitReveal } from '../components/SplitReveal';
import { Magnetic } from '../components/ui';
import { HERO, HERO_PLATE, HERO_SEQUENCE } from '../data';
import { gsap, isMobileViewport } from '../lib/gsap';
import { setVars, smooth, span, useScrub } from '../lib/scroll';
import { useGsap, useReducedMotion } from '../lib/useGsap';

/**
 * Chapter 1. An empty table. As the visitor scrolls, the house special builds itself
 * out of the table (pre-rendered frames on a canvas), the copy steps aside, and the
 * price chip and offer card lock into place beside it.
 */
export function HeroChapter({ onReady }: { onReady?: () => void }) {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<ScrollCanvasHandle>(null);
  const reduce = useReducedMotion();
  const [status, setStatus] = useState<ScrollCanvasStatus>('loading');
  const [hasPlate, setHasPlate] = useState(true);

  useScrub(
    trackRef,
    (p) => {
      canvasRef.current?.seek(p);
      const copy = 1 - smooth(span(p, 0.02, 0.3));
      const chip = smooth(span(p, 0.5, 0.62));
      const card = smooth(span(p, 0.66, 0.8));
      const tail = smooth(span(p, 0.84, 0.96));
      setVars(stageRef.current, {
        '--copy-o': copy,
        '--copy-y': (1 - copy) * -48,
        '--chip-o': chip,
        '--chip-y': (1 - chip) * 24,
        '--card-o': card,
        '--card-y': (1 - card) * 56,
        '--tail-o': tail,
        '--tail-y': (1 - tail) * 20,
        '--cue-o': 1 - smooth(span(p, 0, 0.08)),
        '--veil': 0.15 + 0.35 * smooth(span(p, 0.3, 0.9)),
        '--plate-s': 1.08 - 0.08 * smooth(span(p, 0, 0.7)),
        '--plate-x': -2 + 2 * smooth(span(p, 0, 0.7)),
      });
    },
    { enabled: !reduce },
  );

  // Entrance for the copy on first paint (the text itself is split by SplitReveal).
  useGsap(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const items = stage.querySelectorAll('[data-hero-in]');
    if (reduce) {
      gsap.set(items, { autoAlpha: 1 });
      return;
    }
    gsap.fromTo(items, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.9 });
  }, [reduce]);

  const handleStatus = (s: ScrollCanvasStatus) => {
    setStatus(s);
    if (s !== 'loading') onReady?.();
  };

  return (
    <section ref={trackRef} className="lp-track lp-hero-track" aria-labelledby="hero-title">
      <div ref={stageRef} className="lp-stage lp-hero">
        {/* The room: a photo plate when one exists, else a lit table. The special renders over it. */}
        {hasPlate ? (
          <img className="lp-hero-plate" src={HERO_PLATE} alt="" aria-hidden="true" decoding="async" onError={() => setHasPlate(false)} />
        ) : (
          <div className="lp-hero-table" aria-hidden="true" />
        )}
        <ScrollCanvas
          ref={canvasRef}
          manifestUrl={HERO_SEQUENCE}
          alt={`A ${HERO.special.toLowerCase()} rising out of a dark restaurant table, turning slowly in the light.`}
          fit={isMobileViewport() ? 'contain' : 'cover'}
          focusY={isMobileViewport() ? 0.42 : 0.6}
          intro
          className="lp-hero-seq"
          onStatus={handleStatus}
        />
        <div className="lp-hero-veil" aria-hidden="true" />

        <div className="lp-container lp-hero-copy">
          <p className="lp-kicker" data-hero-in>
            For independent bars, restaurants and local artists
          </p>
          <SplitReveal as="h1" id="hero-title" type="chars" playOn="mount" delay={0.35} className="lp-h1">
            Empty on Wednesday? Give them a reason to walk in.
          </SplitReveal>
          <p className="lp-hero-sub" data-hero-in>
            ARGraphics puts something in your room that only exists in your room. A 3D special over the table. A mural on
            a blank wall. An offer guests claim in their seat. And you see every guest it brings in.
          </p>
          <div className="lp-actions" data-hero-in>
            <Magnetic>
              <Link href="/register" className="lp-btn lp-btn-primary lp-btn-lg">
                Become a partner
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Magnetic>
            <Magnetic strength={0.2}>
              <a href="#how" className="lp-btn lp-btn-ghost lp-btn-lg">
                See how it works
              </a>
            </Magnetic>
          </div>
          <p className="lp-hero-note" data-hero-in>
            Free pilot for founding venues and artists.
          </p>
        </div>

        {/* Beats that arrive as the special finishes building. */}
        <div className="lp-hero-chip" aria-hidden={reduce ? undefined : 'true'}>
          <span className="lp-dot" />
          <span>{HERO.special}</span>
          <span className="lp-hero-price">{HERO.price}</span>
        </div>
        <div className="lp-hero-card" aria-hidden={reduce ? undefined : 'true'}>
          <span className="lp-tag lp-tag-accent">Tonight only</span>
          <p className="lp-hero-card-title">{HERO.offer}</p>
          <p className="lp-hero-card-sub">Show this to your server. One per table.</p>
          <span className="lp-hero-card-claim">Claim</span>
        </div>
        <p className="lp-hero-tail">
          Guests see it over the table. Only in your room.
        </p>

        <a href="#problem" className="lp-scroll-cue" aria-label="Scroll to continue">
          <ChevronDown size={18} aria-hidden="true" />
        </a>

        {import.meta.env.DEV && (status === 'missing' || status === 'error') ? (
          <p className="lp-dev-note">
            No hero frames yet. Bake them at <a href={`${import.meta.env.BASE_URL}dev/bake`}>/dev/bake</a> into public/sequences/hero.
          </p>
        ) : null}
      </div>
    </section>
  );
}
