import { useRef } from 'react';
import { Link } from 'wouter';
import { MapPin, Palette } from 'lucide-react';
import { SplitReveal } from '../components/SplitReveal';
import { Chapter, Magnetic, Reveal, Stagger } from '../components/ui';
import { DISPLAY_TYPES, PIECES } from '../data';
import { setVars, smooth, span, useScrub } from '../lib/scroll';
import { useReducedMotion } from '../lib/useGsap';

const N = DISPLAY_TYPES.length;

/**
 * Chapter 4. Four kinds of displays arrive as a stack of cards: each new one slides up
 * over the last, and the ones underneath settle back and dim, like a deck being dealt.
 */
export function DisplaysChapter() {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useScrub(
    trackRef,
    (p) => {
      const vars: Record<string, number> = {};
      const seg = 1 / N;
      for (let i = 0; i < N; i++) {
        // Card i enters during its segment (card 0 is already in place).
        const enter = i === 0 ? 1 : smooth(span(p, i * seg - 0.02, i * seg + seg * 0.55));
        // How many cards are stacked on top of it so far.
        let depth = 0;
        for (let j = i + 1; j < N; j++) depth += smooth(span(p, j * seg - 0.02, j * seg + seg * 0.55));
        vars[`--enter-${i}`] = enter;
        vars[`--depth-${i}`] = depth;
      }
      vars['--stack-p'] = p;
      setVars(stageRef.current, vars);
    },
    { enabled: !reduce },
  );

  return (
    <section ref={trackRef} id="venues" className="lp-track lp-displays-track" aria-labelledby="venues-title">
      <div ref={stageRef} className="lp-stage lp-displays">
        <div className="lp-container lp-displays-grid">
          <div className="lp-displays-copy">
            <Chapter n="04">Where it lives</Chapter>
            <SplitReveal as="h2" id="venues-title" className="lp-h2" playOn={reduce ? 'mount' : 'scroll'}>
              Four kinds of displays, placed wherever people already look.
            </SplitReveal>
            <p className="lp-lede">
              Bars, restaurants, the taco spot with the line out the door. Pick what guests see and where they find it.
            </p>
            <ol className="lp-stack-index" aria-hidden="true">
              {DISPLAY_TYPES.map((t, i) => (
                <li key={t.title} style={{ ['--i' as string]: i }}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {t.where}
                </li>
              ))}
            </ol>
          </div>

          <ul className="lp-stack" aria-label="Display types">
            {DISPLAY_TYPES.map((t, i) => (
              <li
                key={t.title}
                className={`lp-card lp-stack-card lp-stack-${i}${t.offer ? ' is-offer' : ''}`}
                style={{ ['--i' as string]: i }}
              >
                <div className={`lp-stack-art lp-stack-art-${i}`}>
                  <img className="lp-stack-photo" src={t.photo} alt={t.photoAlt} loading="lazy" decoding="async" />
                  {i === 0 ? (
                    <span className="lp-art-chip" aria-hidden="true">
                      <span className="lp-dot" />
                      Tuesday birria tower
                    </span>
                  ) : null}
                  {i === 1 ? (
                    <span className="lp-art-ticket">
                      <span className="lp-tag lp-tag-accent">Tonight only</span>
                      <span>2-for-1 house margaritas</span>
                    </span>
                  ) : null}
                  {i === 2 ? (
                    <span className="lp-art-chip" aria-hidden="true">
                      <span className="lp-dot" />
                      “Low Tide Neon” · only in this room
                    </span>
                  ) : null}
                  {i === 3 ? (
                    <span className="lp-art-poster">
                      <span>Thu</span>
                      <strong>Trivia night</strong>
                      <span>8pm · prizes</span>
                    </span>
                  ) : null}
                </div>
                <div className="lp-stack-body">
                  <span className="lp-type-icon">
                    <t.icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="lp-h3">{t.title}</h3>
                  <p>{t.body}</p>
                  <p className="lp-type-where">
                    <MapPin size={14} aria-hidden="true" />
                    <span className="lp-sr">Placement: </span>
                    {t.where}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** For artists: the wall that only exists if you show up. Un-pinned, with a drifting gallery. */
export function ArtistsStrip() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useScrub(
    ref,
    (p) => {
      setVars(ref.current, { '--drift': (p - 0.5) * 2 });
    },
    { start: 'top bottom', end: 'bottom top', scrub: 0.5, enabled: !reduce },
  );

  return (
    <section ref={ref} id="artists" className="lp-section lp-artists" aria-labelledby="artists-title">
      <div className="lp-container lp-artists-grid">
        <Reveal className="lp-artists-copy">
          <span className="lp-tag">
            <Palette size={14} aria-hidden="true" />
            For artists
          </span>
          <h2 id="artists-title" className="lp-h2">
            Your work, on a wall that only exists if you show up.
          </h2>
          <p className="lp-lede">
            Local venues host your piece in AR. It lives on their wall, and only there. People have to come in to see it.
          </p>
          <ul className="lp-checks">
            <li>Venues host your work. You keep it.</li>
            <li>See how many people came to see your piece.</li>
            <li>“Find other ARGraphics spots nearby” sends guests down the block to the next venue, and the next piece.</li>
          </ul>
          <Magnetic strength={0.2}>
            <Link href="/register" className="lp-btn lp-btn-ghost">
              Show your work with ARGraphics
            </Link>
          </Magnetic>
        </Reveal>
        <Stagger as="ul" className="lp-pieces" ariaLabel="Example AR art pieces" gap={0.12}>
          {PIECES.map((piece, i) => (
            <li key={piece.title} className={`lp-piece lp-piece-${piece.hue}${piece.tall ? ' is-tall' : ''}`} style={{ ['--k' as string]: i % 2 ? -1 : 1 }}>
              <div className="lp-piece-art">
                <img src={piece.photo} alt={piece.alt} loading="lazy" decoding="async" />
              </div>
              <div className="lp-piece-meta">
                <h3 className="lp-piece-title">{piece.title}</h3>
                <p className="lp-piece-place">
                  <MapPin size={12} aria-hidden="true" />
                  {piece.place}
                </p>
              </div>
            </li>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
