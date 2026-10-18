import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArtistsStrip, DisplaysChapter } from './chapters/DisplaysChapter';
import { HeroChapter } from './chapters/HeroChapter';
import { HowChapter } from './chapters/HowChapter';
import { InviteChapter } from './chapters/InviteChapter';
import { ProblemChapter } from './chapters/ProblemChapter';
import { ProofChapter } from './chapters/ProofChapter';
import { useNavState, Wordmark } from './components/ui';
import { gsap, registerGsap } from './lib/gsap';
import { LandingScroll, useScrollTo } from './lib/scroll';
import { useReducedMotion } from './lib/useGsap';
import './landing.css';

function Nav() {
  const ref = useRef<HTMLElement>(null);
  useNavState(ref);
  return (
    <nav ref={ref} className="lp-nav" aria-label="Main">
      <div className="lp-container lp-nav-inner">
        <Wordmark />
        <ul className="lp-nav-links">
          <li>
            <a href="#venues">For venues</a>
          </li>
          <li>
            <a href="#artists">For artists</a>
          </li>
          <li>
            <a href="#how">How it works</a>
          </li>
        </ul>
        <div className="lp-nav-actions">
          <Link href="/login" className="lp-nav-signin">
            Sign in
          </Link>
          <Link href="/register" className="lp-btn lp-btn-primary lp-btn-sm">
            Become a partner
          </Link>
        </div>
      </div>
    </nav>
  );
}

function SkipLink() {
  const scrollTo = useScrollTo();
  return (
    <a
      href="#main"
      className="lp-skip"
      onClick={(event) => {
        event.preventDefault();
        scrollTo('#main', { immediate: true, offset: 0 });
        document.getElementById('main')?.focus();
      }}
    >
      Skip to main content
    </a>
  );
}

/** A near-black curtain that holds until the hero's first frames are in, then lifts. */
function Curtain({ ready }: { ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ready || gone) return;
    const el = ref.current;
    if (!el) return;
    registerGsap();
    if (reduce) {
      setGone(true);
      return;
    }
    const tween = gsap.to(el, { yPercent: -100, duration: 0.9, ease: 'power4.inOut', onComplete: () => setGone(true) });
    return () => {
      tween.kill();
    };
  }, [ready, gone, reduce]);

  if (gone) return null;
  return (
    <div ref={ref} className={`lp-curtain${ready ? ' is-ready' : ''}`} aria-hidden="true">
      <span className="lp-curtain-mark">
        <span className="lp-mark" />
        ARGraphics
      </span>
      <span className="lp-curtain-bar" />
    </div>
  );
}

export function Landing() {
  const [heroReady, setHeroReady] = useState(false);

  // Never hold the page hostage: lift the curtain after 2.5 s no matter what.
  useEffect(() => {
    const id = window.setTimeout(() => setHeroReady(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="landing-root">
      <LandingScroll>
        <SkipLink />
        <Curtain ready={heroReady} />
        <Nav />
        <main id="main" tabIndex={-1}>
          <HeroChapter onReady={() => setHeroReady(true)} />
          <ProblemChapter />
          <HowChapter />
          <DisplaysChapter />
          <ArtistsStrip />
          <ProofChapter />
          <InviteChapter />
        </main>
      </LandingScroll>
    </div>
  );
}
