import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { SplitReveal } from '../components/SplitReveal';
import { Chapter, FaqItem, Magnetic, Reveal, Stagger, Wordmark } from '../components/ui';
import { FAQS } from '../data';
import { setVars, useScrub } from '../lib/scroll';
import { useReducedMotion } from '../lib/useGsap';

const POSTER = `${import.meta.env.BASE_URL}sequences/hero/poster.webp`;

/** Chapter 6. The invitation, with the special drifting behind it, then straight answers. */
export function InviteChapter() {
  const ref = useRef<HTMLElement>(null);
  const [hasPoster, setHasPoster] = useState(true);
  const reduce = useReducedMotion();

  useScrub(
    ref,
    (p) => {
      setVars(ref.current, { '--par': (p - 0.5) * -120 });
    },
    { start: 'top bottom', end: 'bottom top', scrub: 0.6, enabled: !reduce },
  );

  return (
    <>
      <section ref={ref} className="lp-section lp-invite" aria-labelledby="final-title">
        {hasPoster ? (
          <img className="lp-invite-bg" src={POSTER} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setHasPoster(false)} />
        ) : null}
        <div className="lp-invite-veil" aria-hidden="true" />
        <div className="lp-container">
          <Reveal className="lp-invite-card">
            <Chapter n="06">Your move</Chapter>
            <SplitReveal as="h2" id="final-title" className="lp-h2 lp-h2-xl" type="words">
              Make next Wednesday worth walking in for.
            </SplitReveal>
            <p className="lp-lede">Free pilot for founding venues and artists. We build your first display with you.</p>
            <div className="lp-actions">
              <Magnetic>
                <Link href="/register" className="lp-btn lp-btn-primary lp-btn-lg">
                  Become a partner
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </Magnetic>
              <Magnetic strength={0.2}>
                <a href={`${import.meta.env.BASE_URL}b/demo-bar`} className="lp-btn lp-btn-ghost lp-btn-lg">
                  Try it as a guest
                </a>
              </Magnetic>
              <Magnetic strength={0.2}>
                <a href="mailto:hello@argraphics.app" className="lp-btn lp-btn-ghost lp-btn-lg">
                  Talk to us
                </a>
              </Magnetic>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="lp-section lp-faq-section" aria-labelledby="faq-title">
        <div className="lp-container lp-faq-wrap">
          <Reveal as="header" className="lp-section-head">
            <Chapter n="—">Questions</Chapter>
            <h2 id="faq-title" className="lp-h2">
              Straight answers.
            </h2>
          </Reveal>
          <Stagger className="lp-faq" gap={0.07}>
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </Stagger>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <Wordmark />
            <p>Local AR for neighborhood rooms.</p>
          </div>
          <nav aria-label="Footer" className="lp-footer-links">
            <a href="mailto:hello@argraphics.app">hello@argraphics.app</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </nav>
          <p className="lp-footer-copy">
            © 2026 ARGraphics · Photos via{' '}
            <a href="https://unsplash.com" rel="noreferrer" target="_blank">
              Unsplash
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
