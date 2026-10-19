import { useRef, useState } from 'react';
import { ScrollCanvas, type ScrollCanvasHandle, type ScrollCanvasStatus } from '../components/ScrollCanvas';
import { SplitReveal } from '../components/SplitReveal';
import { Chapter } from '../components/ui';
import { HERO, PHONE_SEQUENCE, STEPS } from '../data';
import { setVars, smooth, span, useScrub } from '../lib/scroll';
import { useReducedMotion } from '../lib/useGsap';

/** Beat boundaries in chapter progress. */
const BEATS: Array<[number, number]> = [
  [0.0, 0.34],
  [0.34, 0.68],
  [0.68, 1.0],
];

/**
 * Chapter 3. Three beats on one stage: the code sits on the table, the phone comes up and
 * finds it, and the special appears in the phone with the offer the guest can claim.
 */
export function HowChapter() {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<ScrollCanvasHandle>(null);
  const reduce = useReducedMotion();
  const [seqStatus, setSeqStatus] = useState<ScrollCanvasStatus>('loading');

  useScrub(
    trackRef,
    (p) => {
      const vars: Record<string, number> = {};
      // Which step copy is on screen: a plateau around each beat's centre.
      BEATS.forEach(([a, b], i) => {
        const c = (a + b) / 2;
        const half = (b - a) / 2;
        // 0 at the beat's centre, 1 at its edge. The first beat is already on screen at
        // p = 0 and the last one stays until the chapter ends.
        const raw = i === 0 ? Math.max(0, p - c) : i === BEATS.length - 1 ? Math.max(0, c - p) : Math.abs(p - c);
        const d = raw / half;
        vars[`--step-${i}`] = 1 - smooth(span(d, 0.55, 1));
        vars[`--dot-${i}`] = d < 1 ? 1 : 0;
      });
      // Beat 1: the QR card draws itself.
      vars['--draw'] = smooth(span(p, 0.04, 0.28));
      // Beat 2: phone rises, scan line sweeps, corners lock.
      vars['--phone-y'] = (1 - smooth(span(p, 0.3, 0.46))) * 70;
      vars['--phone-o'] = smooth(span(p, 0.3, 0.4));
      vars['--scan'] = span(p, 0.44, 0.6);
      vars['--lock'] = smooth(span(p, 0.58, 0.66));
      // Beat 3: the special appears, the anchor ring settles, the sheet slides up.
      const appear = smooth(span(p, 0.68, 0.8));
      vars['--appear'] = appear;
      vars['--sheet-y'] = (1 - smooth(span(p, 0.8, 0.9))) * 110;
      vars['--sheet-o'] = smooth(span(p, 0.8, 0.88));
      vars['--walkin'] = smooth(span(p, 0.9, 0.97));
      vars['--table-dim'] = 0.4 * smooth(span(p, 0.3, 0.5));
      setVars(stageRef.current, vars);
      // The in-phone sequence scrubs over the last beat only.
      canvasRef.current?.seek(span(p, 0.68, 0.98));
    },
    { enabled: !reduce },
  );

  const hasSeq = seqStatus === 'ready' || seqStatus === 'loading';

  return (
    <section ref={trackRef} id="how" className="lp-track lp-how-track" aria-labelledby="how-title">
      <div ref={stageRef} className="lp-stage lp-how">
        <div className="lp-container lp-how-grid">
          <div className="lp-how-copy">
            <Chapter n="03">How it works</Chapter>
            <SplitReveal as="h2" id="how-title" className="lp-h2" playOn={reduce ? 'mount' : 'scroll'}>
              Three steps. No training meeting.
            </SplitReveal>
            <p className="lp-lede">You run the room. We handle the AR.</p>

            <ol className="lp-steps" aria-label="The three steps">
              {STEPS.map((step, i) => (
                <li key={step.title} className="lp-step" style={{ ['--i' as string]: i }}>
                  <span className="lp-step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="lp-h3">
                      <step.icon size={18} aria-hidden="true" className="lp-step-icon" />
                      {step.title}
                    </h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <ol className="lp-beat-dots" aria-hidden="true">
              {STEPS.map((step, i) => (
                <li key={step.title} style={{ ['--i' as string]: i }} />
              ))}
            </ol>
          </div>

          {/* The scene: a table, a code, a phone, a special. */}
          <div className="lp-scene" aria-hidden="true">
            <div className="lp-scene-table" />

            {/* Beat 1: the QR card on the table. Strokes draw with --draw. */}
            <div className="lp-qr-card">
              <svg className="lp-qr" viewBox="0 0 64 64" fill="none">
                <g className="lp-qr-eyes" stroke="currentColor" strokeWidth="4" pathLength="1">
                  <rect x="6" y="6" width="18" height="18" rx="3" />
                  <rect x="40" y="6" width="18" height="18" rx="3" />
                  <rect x="6" y="40" width="18" height="18" rx="3" />
                </g>
                <g className="lp-qr-bits" fill="currentColor">
                  {QR_BITS.map(([x, y], i) => (
                    <rect key={i} x={x} y={y} width="4" height="4" style={{ ['--k' as string]: i / QR_BITS.length }} />
                  ))}
                </g>
              </svg>
              <span className="lp-qr-label">Scan for tonight’s special</span>
            </div>

            {/* Beat 2 and 3: the phone. */}
            <div className="lp-phone">
              <div className="lp-phone-notch" />
              <div className="lp-phone-screen">
                <div className="lp-screen-top">
                  <span className="lp-mini-mark" />
                  <span>ARGraphics · Your spot</span>
                </div>
                <div className="lp-viewfinder">
                  <span className="lp-corner tl" />
                  <span className="lp-corner tr" />
                  <span className="lp-corner bl" />
                  <span className="lp-corner br" />
                  <span className="lp-scanline" />
                  <div className="lp-vf-qr" />
                </div>
                <div className="lp-ar">
                  <span className="lp-anchor" />
                  <div className="lp-ar-object">
                    <ScrollCanvas
                      ref={canvasRef}
                      manifestUrl={PHONE_SEQUENCE}
                      alt=""
                      fit="contain"
                      lazy
                      className="lp-phone-seq"
                      onStatus={setSeqStatus}
                    />
                    {!hasSeq ? <span className="lp-ar-glow" /> : null}
                  </div>
                  <div className="lp-price-chip">
                    <span className="lp-dot" />
                    {HERO.special}
                  </div>
                </div>
                <div className="lp-sheet">
                  <span className="lp-sheet-handle" />
                  <span className="lp-tag lp-tag-accent">Tonight only</span>
                  <p className="lp-sheet-title">{HERO.offer}</p>
                  <p className="lp-sheet-sub">Show this to your server. One per table.</p>
                  <span className="lp-sheet-claim">Claim</span>
                </div>
              </div>
            </div>

            <div className="lp-walkin">
              <span className="lp-dot" />
              Redeemed
              <strong>+1</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* A deterministic scatter of data modules so the code looks like a code. */
const QR_BITS: Array<[number, number]> = (() => {
  const bits: Array<[number, number]> = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let y = 4; y < 60; y += 6) {
    for (let x = 4; x < 60; x += 6) {
      const inEye = (x < 28 && y < 28) || (x > 36 && y < 28) || (x < 28 && y > 36);
      if (inEye) continue;
      if (rnd() > 0.45) bits.push([x, y]);
    }
  }
  return bits;
})();
