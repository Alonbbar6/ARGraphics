import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Box,
  CalendarDays,
  ChevronDown,
  Eye,
  Footprints,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  Palette,
  QrCode,
  ScanLine,
  Sparkles,
  Store,
  Tag,
  Users,
} from 'lucide-react';
import {
  CountUp,
  GrowBar,
  Magnetic,
  Reveal,
  SplitWords,
  Stagger,
  StaggerItem,
  TiltCard,
  motion,
  useDrift,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSectionProgress,
  useSpring,
  useTransform,
} from './landing-motion';
import './landing.css';

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Wordmark() {
  return (
    <Link href="/" className="lp-wordmark" aria-label="ARGraphics home">
      <span className="lp-mark" aria-hidden="true" />
      <span>ARGraphics</span>
    </Link>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="lp-eyebrow">{children}</p>;
}

function SectionHead({
  eyebrow,
  title,
  lede,
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  id: string;
}) {
  return (
    <Reveal as="header" className="lp-section-head">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="lp-h2">
        {title}
      </h2>
      {lede ? <p className="lp-lede">{lede}</p> : null}
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Hero visual: phone in hand, 3D special over a table, offer sheet    */
/* ------------------------------------------------------------------ */

const SPRING = { type: 'spring', stiffness: 170, damping: 18 } as const;

/**
 * The phone glides in from the right, then follows the cursor in 3D. Inside it the
 * AR object drops onto the table, the anchor locks, and the offer sheet slides up,
 * in the order a guest would actually see them.
 */
function HeroPhone({ drift }: { drift: ReturnType<typeof useDrift> }) {
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 120, damping: 16 });
  const ry = useSpring(useMotionValue(0), { stiffness: 120, damping: 16 });

  useEffect(() => {
    if (reduce || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const onMove = (event: PointerEvent) => {
      ry.set(((event.clientX / window.innerWidth) - 0.5) * 16);
      rx.set((0.5 - event.clientY / window.innerHeight) * 10);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduce, rx, ry]);

  return (
    <motion.div
      className="lp-hero-visual"
      role="img"
      aria-label="A phone running the ARGraphics app: a glowing 3D birria tower floats over a restaurant table, with an offer card reading 'Free agua fresca with any birria tower.'"
      style={{ y: drift, rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 90, rotateY: -22 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, rotateY: 0 }}
      transition={{ duration: 1.1, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="lp-hand" aria-hidden="true" />
      <div className="lp-phone" aria-hidden="true">
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">
          <div className="lp-bokeh lp-bokeh-1" />
          <div className="lp-bokeh lp-bokeh-2" />
          <div className="lp-bokeh lp-bokeh-3" />

          <div className="lp-screen-top">
            <span className="lp-mini-mark" />
            <span>ARGraphics · Your spot</span>
          </div>

          <motion.div
            className="lp-price-chip"
            initial={reduce ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4, duration: 0.5 }}
          >
            <span className="lp-chip-dot" />
            Tuesday birria tower
          </motion.div>

          {/* Outer wrapper handles the drop-in; the inner element keeps its CSS float. */}
          <motion.div
            style={{ position: 'absolute', inset: 0, transformOrigin: '50% 40%' }}
            initial={reduce ? false : { opacity: 0, scale: 0.2, y: -60 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ ...SPRING, delay: 1.0 }}
          >
            <div className="lp-ar-object">
              <span className="lp-tower lp-tower-1" />
              <span className="lp-tower lp-tower-2" />
              <span className="lp-tower lp-tower-3" />
              <span className="lp-tower-glow" />
            </div>
          </motion.div>

          <div className="lp-table" />
          <motion.div
            className="lp-anchor"
            initial={reduce ? false : { opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...SPRING, delay: 0.85 }}
          >
            <span className="lp-anchor-ring" />
            <span className="lp-anchor-dot" />
          </motion.div>

          <motion.div
            className="lp-sheet"
            initial={reduce ? false : { opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 1.7 }}
          >
            <span className="lp-sheet-handle" />
            <span className="lp-badge lp-badge-offer">Tonight only</span>
            <p className="lp-sheet-title">Free agua fresca with any birria tower</p>
            <p className="lp-sheet-sub">Show this to your server. One per table.</p>
            <motion.span
              className="lp-sheet-claim"
              animate={reduce ? undefined : { scale: [1, 1.04, 1] }}
              transition={{ delay: 2.6, duration: 1.6, repeat: Infinity, repeatDelay: 2.4 }}
            >
              Claim
            </motion.span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const PAINS = [
  {
    title: 'Wednesday is quiet. Again.',
    body: 'The kitchen is ready. The bar is stocked. Half the room is empty by eight.',
  },
  {
    title: 'You paid for ads. Who came?',
    body: 'Yelp ads, boosted posts, a loyalty app. Not one of them can name a single guest they brought in.',
  },
  {
    title: 'The chain down the street has a budget.',
    body: 'You have a great room and regulars who love you. You need a reason for new people to walk in.',
  },
];

const STEPS = [
  {
    icon: Sparkles,
    title: 'We build the AR display',
    body: 'Tell us your special, your offer, or your art. We turn it into something guests can see in your room.',
  },
  {
    icon: QrCode,
    title: 'You place the codes',
    body: 'Print-ready QR codes for tables, windows, menus and posters. Stick them up. That is the setup.',
  },
  {
    icon: ScanLine,
    title: 'Guests scan. You count walk-ins.',
    body: 'One scan with the ARGraphics app and the room comes alive. Every scan and claimed offer shows up on your dashboard.',
  },
];

const DISPLAY_TYPES = [
  {
    icon: Box,
    title: '3D menu item',
    body: 'Your signature dish floats over the table, big enough to make the next table order one.',
    where: 'Table',
  },
  {
    icon: Tag,
    title: 'Promo offer',
    body: 'A deal guests claim right at the table. Your server confirms it with a code.',
    where: 'Table · Menu',
    offer: true,
  },
  {
    icon: ImageIcon,
    title: 'Virtual art piece',
    body: 'A mural on the blank wall by the bathrooms. A local artist’s piece that only lives in your room.',
    where: 'Wall',
  },
  {
    icon: CalendarDays,
    title: 'Event teaser',
    body: 'Trivia night, a DJ set, a tasting. Guests scan your window and see what is coming.',
    where: 'Window · Poster',
  },
];

const PIECES = [
  { title: 'Low Tide Neon', place: 'Back wall · taqueria', tall: true, hue: 'a' },
  { title: 'Second Shift', place: 'Bar mirror · cocktail bar', tall: false, hue: 'b' },
  { title: 'Abuela’s Garden', place: 'Patio fence · café', tall: false, hue: 'c' },
  { title: 'Last Call Bloom', place: 'Hallway · wine bar', tall: true, hue: 'd' },
];

const FUNNEL = [
  {
    icon: ScanLine,
    label: 'Scans',
    body: 'Every time a phone opens one of your codes in the ARGraphics app.',
  },
  {
    icon: Users,
    label: 'Unique visitors',
    body: 'Scans rolled up to people, so one guest scanning five times counts once.',
  },
  {
    icon: Footprints,
    label: 'Walk-ins and redemptions',
    body: 'Offers claimed at the table and confirmed by your staff with a code. A claimed offer is a guest in a seat.',
  },
];

const TILES = [
  { label: 'Scans this week', value: 412 },
  { label: 'Unique visitors', value: 268 },
  { label: 'Offers redeemed', value: 57, offer: true },
];

const FAQS = [
  {
    q: 'What do my guests need?',
    a: 'An iPhone and the free ARGraphics app. They scan your code with it and the display opens right where they are sitting. One scan, and they are in.',
  },
  {
    q: 'Do my staff need training?',
    a: 'No. If a guest claims an offer, they show your server a confirmation screen with a code and a live clock. Your server looks at it and says yes. That is the whole job.',
  },
  {
    q: 'Does this touch my POS?',
    a: 'No. Nothing connects to your register, your reservations or your menu system. ARGraphics runs alongside what you already use.',
  },
  {
    q: 'How do you count walk-ins?',
    a: 'We count claimed offers. A guest claims an offer at the table, staff confirm it with a code, and it lands on your dashboard. We do not guess, and we do not count ad impressions as guests.',
  },
  {
    q: 'I’m an artist. Who owns my work?',
    a: 'You do. Your piece stays yours. Venues host it in AR for as long as you both agree, and your name stays on it every time someone sees it.',
  },
];

/* Illustrative heatmap values (0..1), deterministic so it renders the same every time. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = ['5p', '6p', '7p', '8p', '9p', '10p', '11p'];
function heat(d: number, h: number) {
  const weekend = d >= 4 ? 0.35 : d === 2 ? 0.2 : 0.05;
  const peak = 1 - Math.abs(h - 3) / 4;
  const wobble = ((d * 7 + h * 3) % 5) / 20;
  return Math.max(0.05, Math.min(1, weekend + peak * 0.55 + wobble));
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const base = useId().replace(/:/g, '');
  const panelId = `faq-panel-${base}`;
  const buttonId = `faq-button-${base}`;
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
          <motion.span
            style={{ display: 'inline-flex' }}
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
          >
            <ChevronDown size={20} aria-hidden="true" className="lp-faq-chevron" />
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            className="lp-faq-panel-motion"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div id={panelId} role="region" aria-labelledby={buttonId} className="lp-faq-panel">
              <p>{a}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections with their own scroll behaviour                            */
/* ------------------------------------------------------------------ */

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const visualY = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const still = useMotionValue(0);
  const one = useMotionValue(1);

  return (
    <section ref={ref} className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-hero-bg" aria-hidden="true" />
      <div className="lp-container lp-hero-grid">
        <motion.div className="lp-hero-copy" style={{ y: reduce ? still : copyY, opacity: reduce ? one : copyOpacity }}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Eyebrow>For independent bars, restaurants and local artists</Eyebrow>
          </motion.div>
          <h1 id="hero-title" className="lp-h1">
            <SplitWords text="Empty on Wednesday? Give them a reason to" delay={0.15} />{' '}
            <motion.span
              className="lp-gradient-text lp-word"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7, rotate: -4 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
              transition={{ ...SPRING, delay: 0.75 }}
            >
              walk in.
            </motion.span>
          </h1>
          <motion.p
            className="lp-hero-sub"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.9 }}
          >
            ARGraphics puts something in your room that only exists in your room. A 3D special over the table. A mural
            on a blank wall. An offer guests claim in their seat. And you see every guest it brings in.
          </motion.p>
          <motion.div
            className="lp-hero-actions"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.05 }}
          >
            <Magnetic>
              <Link href="/register" className="lp-btn lp-btn-hero">
                Become a partner
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Magnetic>
            <Magnetic strength={0.2}>
              <a href="#how" className="lp-btn lp-btn-ghost">
                See how it works
              </a>
            </Magnetic>
          </motion.div>
          <motion.p
            className="lp-hero-note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.3 }}
          >
            Free pilot for founding venues and artists.
          </motion.p>
        </motion.div>
        <HeroPhone drift={reduce ? still : visualY} />
      </div>
      <motion.a
        href="#how"
        className="lp-scroll-cue"
        aria-label="Scroll to how it works"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2 }}
      >
        <motion.span
          style={{ display: 'inline-flex' }}
          animate={reduce ? undefined : { y: [0, 5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </motion.span>
      </motion.a>
    </section>
  );
}

function ArtistsSection() {
  const ref = useRef<HTMLElement>(null);
  const progress = useSectionProgress(ref);
  const slow = useDrift(progress, 18);
  const fast = useDrift(progress, -34);

  return (
    <section ref={ref} id="artists" className="lp-section lp-artists" aria-labelledby="artists-title">
      <div className="lp-container lp-artists-grid">
        <Reveal className="lp-artists-copy">
          <span className="lp-badge lp-badge-spotlight">
            <Palette size={14} aria-hidden="true" />
            Artist spotlight
          </span>
          <h2 id="artists-title" className="lp-h2">
            Your work, on a wall that only exists <span className="lp-gradient-text">if you show up.</span>
          </h2>
          <p className="lp-lede">
            Local venues host your piece in AR. It lives on their wall, and only there. People have to come in to see
            it.
          </p>
          <Stagger as="ul" className="lp-checks" gap={0.12}>
            <StaggerItem as="li">Venues host your work. You keep it.</StaggerItem>
            <StaggerItem as="li">See how many people came to see your piece.</StaggerItem>
            <StaggerItem as="li">
              “Find other ARGraphics spots nearby” sends guests down the block to the next venue, and the next piece.
            </StaggerItem>
          </Stagger>
          <Magnetic strength={0.2}>
            <Link href="/register" className="lp-btn lp-btn-primary">
              Show your work with ARGraphics
            </Link>
          </Magnetic>
        </Reveal>
        <Stagger as="ul" className="lp-pieces" ariaLabel="Example AR art pieces" gap={0.12}>
          {PIECES.map((p, i) => (
            <motion.li
              key={p.title}
              className={`lp-piece lp-piece-${p.hue}${p.tall ? ' is-tall' : ''}`}
              style={{ y: i % 2 === 0 ? slow : fast }}
              variants={{
                hidden: { opacity: 0, scale: 0.9, rotate: i % 2 === 0 ? -3 : 3 },
                show: { opacity: 1, scale: 1, rotate: 0, transition: { ...SPRING } },
              }}
              whileHover={{ scale: 1.03, rotate: -0.6 }}
            >
              <div className="lp-piece-art" aria-hidden="true" />
              <div className="lp-piece-meta">
                <h3 className="lp-piece-title">{p.title}</h3>
                <p className="lp-piece-place">
                  <MapPin size={12} aria-hidden="true" />
                  {p.place}
                </p>
              </div>
            </motion.li>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useEffect(() => scrollY.on('change', (y) => setScrolled(y > 24)), [scrollY]);

  return (
    <nav className={`lp-nav${scrolled ? ' is-scrolled' : ''}`} aria-label="Main">
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

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  const reduce = useReducedMotion();

  return (
    <div className="landing-root">
      <a href="#main" className="lp-skip">
        Skip to main content
      </a>

      <Nav />

      <main id="main" tabIndex={-1}>
        <Hero />

        {/* PAIN ------------------------------------------------------ */}
        <section className="lp-section" aria-labelledby="pain-title">
          <div className="lp-container">
            <SectionHead id="pain-title" eyebrow="Sound familiar?" title="Slow nights are not a menu problem." />
            <Stagger as="ul" className="lp-pain-grid">
              {PAINS.map((p) => (
                <StaggerItem key={p.title} as="li">
                  <TiltCard className="lp-card lp-pain-card">
                    <h3 className="lp-h3">{p.title}</h3>
                    <p>{p.body}</p>
                  </TiltCard>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* HOW IT WORKS ---------------------------------------------- */}
        <section id="how" className="lp-section lp-section-tint" aria-labelledby="how-title">
          <div className="lp-container">
            <SectionHead
              id="how-title"
              eyebrow="How it works"
              title="Three steps. No training meeting."
              lede="You run the room. We handle the AR."
            />
            <Stagger as="ol" className="lp-steps" gap={0.18}>
              <GrowBar className="lp-steps-line" delay={0.2} />
              {STEPS.map((s, i) => (
                <StaggerItem key={s.title} as="li" className="lp-card lp-step">
                  <motion.span
                    className="lp-step-num"
                    aria-hidden="true"
                    initial={reduce ? false : { opacity: 0, scale: 1.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ ...SPRING, delay: 0.3 + i * 0.18 }}
                  >
                    {i + 1}
                  </motion.span>
                  <s.icon size={24} aria-hidden="true" className="lp-step-icon" />
                  <h3 className="lp-h3">{s.title}</h3>
                  <p>{s.body}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* FOR VENUES ------------------------------------------------ */}
        <section id="venues" className="lp-section" aria-labelledby="venues-title">
          <div className="lp-container">
            <SectionHead
              id="venues-title"
              eyebrow="For venues"
              title="Bars, restaurants, the taco spot with the line out the door."
              lede="Pick what guests see and where they find it. Four kinds of displays, placed wherever people already look."
            />
            <Stagger as="ul" className="lp-types">
              {DISPLAY_TYPES.map((t) => (
                <StaggerItem key={t.title} as="li">
                  <TiltCard className={`lp-card lp-type${t.offer ? ' is-offer' : ''}`} max={5}>
                    <span className="lp-type-icon">
                      <t.icon size={22} aria-hidden="true" />
                    </span>
                    <h3 className="lp-h3">{t.title}</h3>
                    <p>{t.body}</p>
                    <p className="lp-type-where">
                      <MapPin size={14} aria-hidden="true" />
                      <span className="lp-sr">Placement: </span>
                      {t.where}
                    </p>
                  </TiltCard>
                </StaggerItem>
              ))}
            </Stagger>
            <Stagger className="lp-placements" ariaLabel="Where codes go" gap={0.07}>
              {[
                { icon: Store, label: 'Tables' },
                { icon: ImageIcon, label: 'Walls' },
                { icon: Eye, label: 'Windows' },
                { icon: Megaphone, label: 'Posters' },
              ].map((p) => (
                <StaggerItem key={p.label} as="span" className="lp-placement">
                  <p.icon size={16} aria-hidden="true" />
                  {p.label}
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        <ArtistsSection />

        {/* PROOF ----------------------------------------------------- */}
        <section id="proof" className="lp-section lp-section-tint" aria-labelledby="proof-title">
          <div className="lp-container">
            <SectionHead
              id="proof-title"
              eyebrow="The proof"
              title="“Is this putting bodies in seats?”"
              lede="Here is exactly how we count. Every claimed offer is a guest in a seat."
            />
            <div className="lp-proof-grid">
              <Stagger as="ol" className="lp-funnel" gap={0.15}>
                {FUNNEL.map((f, i) => (
                  <StaggerItem
                    key={f.label}
                    as="li"
                    className="lp-funnel-step"
                    style={{ '--w': `${100 - i * 18}%` } as CSSProperties}
                  >
                    <GrowBar className="lp-funnel-bar" delay={0.2 + i * 0.15} />
                    <div className="lp-funnel-body">
                      <f.icon size={20} aria-hidden="true" className="lp-funnel-icon" />
                      <div>
                        <h3 className="lp-h4">{f.label}</h3>
                        <p>{f.body}</p>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>

              <Reveal as="figure" className="lp-dash" delay={0.15} y={40}>
                <figcaption id="dash-caption" className="lp-dash-label">
                  Example dashboard · illustrative numbers, not customer results
                </figcaption>
                <div className="lp-dash-tiles">
                  {TILES.map((t) => (
                    <div key={t.label} className={`lp-tile${t.offer ? ' is-offer' : ''}`}>
                      <span className="lp-tile-label">{t.label}</span>
                      <span className="lp-tile-num">
                        <CountUp value={t.value} />
                      </span>
                    </div>
                  ))}
                </div>
                <div className="lp-heat">
                  <p className="lp-heat-title">Scans by day and hour</p>
                  <div className="lp-heat-grid" role="presentation" aria-hidden="true">
                    <span />
                    {HOURS.map((h) => (
                      <span key={h} className="lp-heat-hour">
                        {h}
                      </span>
                    ))}
                    {DAYS.map((d, di) => (
                      <div key={d} className="lp-heat-row">
                        <span className="lp-heat-day">{d}</span>
                        {HOURS.map((h, hi) => (
                          <motion.span
                            key={h}
                            className="lp-heat-cell"
                            style={{ '--v': heat(di, hi).toFixed(2) } as CSSProperties}
                            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.45, delay: 0.3 + (di + hi) * 0.05, ease: [0.22, 1, 0.36, 1] }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="lp-heat-legend" aria-hidden="true">
                    <span>Fewer</span>
                    <span className="lp-heat-scale" />
                    <span>More</span>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* FAQ ------------------------------------------------------- */}
        <section className="lp-section" aria-labelledby="faq-title">
          <div className="lp-container lp-faq-wrap">
            <SectionHead id="faq-title" eyebrow="Questions" title="Straight answers." />
            <Stagger className="lp-faq" gap={0.07}>
              {FAQS.map((f) => (
                <StaggerItem key={f.q}>
                  <FaqItem q={f.q} a={f.a} />
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* FINAL CTA ------------------------------------------------- */}
        <section className="lp-section lp-final" aria-labelledby="final-title">
          <div className="lp-container">
            <motion.div
              className="lp-final-card"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 30 }}
              whileInView={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -15% 0px' }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="lp-final-glow" aria-hidden="true" />
              <h2 id="final-title" className="lp-h2">
                <SplitWords text="Make next Wednesday worth walking in for." step={0.05} />
              </h2>
              <p className="lp-lede">Free pilot for founding venues and artists. We build your first display with you.</p>
              <div className="lp-hero-actions lp-final-actions">
                <Magnetic>
                  <Link href="/register" className="lp-btn lp-btn-hero">
                    Become a partner
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </Magnetic>
                <Magnetic strength={0.2}>
                  <a href="mailto:hello@argraphics.app" className="lp-btn lp-btn-ghost">
                    Talk to us
                  </a>
                </Magnetic>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

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
          <p className="lp-footer-copy">© 2026 ARGraphics</p>
        </div>
      </footer>
    </div>
  );
}
