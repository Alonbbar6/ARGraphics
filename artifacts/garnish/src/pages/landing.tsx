import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
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
    <header className="lp-section-head">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="lp-h2">
        {title}
      </h2>
      {lede ? <p className="lp-lede">{lede}</p> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero visual: phone in hand, 3D special over a table, offer sheet    */
/* ------------------------------------------------------------------ */

function HeroPhone() {
  return (
    <div
      className="lp-hero-visual"
      role="img"
      aria-label="A phone running the ARGraphics app: a glowing 3D birria tower floats over a restaurant table, with an offer card reading 'Free agua fresca with any birria tower.'"
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

          <div className="lp-price-chip">
            <span className="lp-chip-dot" />
            Tuesday birria tower
          </div>

          <div className="lp-ar-object">
            <span className="lp-tower lp-tower-1" />
            <span className="lp-tower lp-tower-2" />
            <span className="lp-tower lp-tower-3" />
            <span className="lp-tower-glow" />
          </div>

          <div className="lp-table" />
          <div className="lp-anchor">
            <span className="lp-anchor-ring" />
            <span className="lp-anchor-dot" />
          </div>

          <div className="lp-sheet">
            <span className="lp-sheet-handle" />
            <span className="lp-badge lp-badge-offer">Tonight only</span>
            <p className="lp-sheet-title">Free agua fresca with any birria tower</p>
            <p className="lp-sheet-sub">Show this to your server. One per table.</p>
            <span className="lp-sheet-claim">Claim</span>
          </div>
        </div>
      </div>
    </div>
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
          <ChevronDown size={20} aria-hidden="true" className="lp-faq-chevron" />
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={buttonId} className="lp-faq-panel" hidden={!open}>
        <p>{a}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  return (
    <div className="landing-root">
      <a href="#main" className="lp-skip">
        Skip to main content
      </a>

      <nav className="lp-nav" aria-label="Main">
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

      <main id="main" tabIndex={-1}>
        {/* HERO ------------------------------------------------------ */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-bg" aria-hidden="true" />
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <Eyebrow>For independent bars, restaurants and local artists</Eyebrow>
              <h1 id="hero-title" className="lp-h1">
                Empty on Wednesday? Give them a reason to <span className="lp-gradient-text">walk in.</span>
              </h1>
              <p className="lp-hero-sub">
                ARGraphics puts something in your room that only exists in your room. A 3D special over the table. A
                mural on a blank wall. An offer guests claim in their seat. And you see every guest it brings in.
              </p>
              <div className="lp-hero-actions">
                <Link href="/register" className="lp-btn lp-btn-hero">
                  Become a partner
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a href="#how" className="lp-btn lp-btn-ghost">
                  See how it works
                </a>
              </div>
              <p className="lp-hero-note">Free pilot for founding venues and artists.</p>
            </div>
            <HeroPhone />
          </div>
        </section>

        {/* PAIN ------------------------------------------------------ */}
        <section className="lp-section" aria-labelledby="pain-title">
          <div className="lp-container">
            <SectionHead id="pain-title" eyebrow="Sound familiar?" title="Slow nights are not a menu problem." />
            <ul className="lp-pain-grid">
              {PAINS.map((p) => (
                <li key={p.title} className="lp-card lp-pain-card">
                  <h3 className="lp-h3">{p.title}</h3>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>
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
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="lp-card lp-step">
                  <span className="lp-step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <s.icon size={24} aria-hidden="true" className="lp-step-icon" />
                  <h3 className="lp-h3">{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
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
            <ul className="lp-types">
              {DISPLAY_TYPES.map((t) => (
                <li key={t.title} className={`lp-card lp-type${t.offer ? ' is-offer' : ''}`}>
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
                </li>
              ))}
            </ul>
            <div className="lp-placements" aria-label="Where codes go">
              {[
                { icon: Store, label: 'Tables' },
                { icon: ImageIcon, label: 'Walls' },
                { icon: Eye, label: 'Windows' },
                { icon: Megaphone, label: 'Posters' },
              ].map((p) => (
                <span key={p.label} className="lp-placement">
                  <p.icon size={16} aria-hidden="true" />
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* FOR ARTISTS ----------------------------------------------- */}
        <section id="artists" className="lp-section lp-artists" aria-labelledby="artists-title">
          <div className="lp-container lp-artists-grid">
            <div className="lp-artists-copy">
              <span className="lp-badge lp-badge-spotlight">
                <Palette size={14} aria-hidden="true" />
                Artist spotlight
              </span>
              <h2 id="artists-title" className="lp-h2">
                Your work, on a wall that only exists <span className="lp-gradient-text">if you show up.</span>
              </h2>
              <p className="lp-lede">
                Local venues host your piece in AR. It lives on their wall, and only there. People have to come in to
                see it.
              </p>
              <ul className="lp-checks">
                <li>Venues host your work. You keep it.</li>
                <li>See how many people came to see your piece.</li>
                <li>
                  “Find other ARGraphics spots nearby” sends guests down the block to the next venue, and the next
                  piece.
                </li>
              </ul>
              <Link href="/register" className="lp-btn lp-btn-primary">
                Show your work with ARGraphics
              </Link>
            </div>
            <ul className="lp-pieces" aria-label="Example AR art pieces">
              {PIECES.map((p) => (
                <li key={p.title} className={`lp-piece lp-piece-${p.hue}${p.tall ? ' is-tall' : ''}`}>
                  <div className="lp-piece-art" aria-hidden="true" />
                  <div className="lp-piece-meta">
                    <h3 className="lp-piece-title">{p.title}</h3>
                    <p className="lp-piece-place">
                      <MapPin size={12} aria-hidden="true" />
                      {p.place}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

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
              <ol className="lp-funnel">
                {FUNNEL.map((f, i) => (
                  <li key={f.label} className="lp-funnel-step" style={{ '--w': `${100 - i * 18}%` } as CSSProperties}>
                    <span className="lp-funnel-bar" aria-hidden="true" />
                    <div className="lp-funnel-body">
                      <f.icon size={20} aria-hidden="true" className="lp-funnel-icon" />
                      <div>
                        <h3 className="lp-h4">{f.label}</h3>
                        <p>{f.body}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <figure className="lp-dash" aria-labelledby="dash-caption">
                <figcaption id="dash-caption" className="lp-dash-label">
                  Example dashboard · illustrative numbers, not customer results
                </figcaption>
                <div className="lp-dash-tiles">
                  <div className="lp-tile">
                    <span className="lp-tile-label">Scans this week</span>
                    <span className="lp-tile-num">412</span>
                  </div>
                  <div className="lp-tile">
                    <span className="lp-tile-label">Unique visitors</span>
                    <span className="lp-tile-num">268</span>
                  </div>
                  <div className="lp-tile is-offer">
                    <span className="lp-tile-label">Offers redeemed</span>
                    <span className="lp-tile-num">57</span>
                  </div>
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
                          <span
                            key={h}
                            className="lp-heat-cell"
                            style={{ '--v': heat(di, hi).toFixed(2) } as CSSProperties}
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
              </figure>
            </div>
          </div>
        </section>

        {/* FAQ ------------------------------------------------------- */}
        <section className="lp-section" aria-labelledby="faq-title">
          <div className="lp-container lp-faq-wrap">
            <SectionHead id="faq-title" eyebrow="Questions" title="Straight answers." />
            <div className="lp-faq">
              {FAQS.map((f) => (
                <FaqItem key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA ------------------------------------------------- */}
        <section className="lp-section lp-final" aria-labelledby="final-title">
          <div className="lp-container">
            <div className="lp-final-card">
              <div className="lp-final-glow" aria-hidden="true" />
              <h2 id="final-title" className="lp-h2">
                Make next Wednesday worth walking in for.
              </h2>
              <p className="lp-lede">Free pilot for founding venues and artists. We build your first display with you.</p>
              <div className="lp-hero-actions lp-final-actions">
                <Link href="/register" className="lp-btn lp-btn-hero">
                  Become a partner
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a href="mailto:hello@argraphics.app" className="lp-btn lp-btn-ghost">
                  Talk to us
                </a>
              </div>
            </div>
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
