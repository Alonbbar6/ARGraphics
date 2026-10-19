import { useRef, type CSSProperties } from 'react';
import { SplitReveal } from '../components/SplitReveal';
import { Chapter } from '../components/ui';
import { DAYS, FUNNEL, HOURS, heat } from '../data';
import { setVars, smooth, span, useScrub } from '../lib/scroll';
import { useReducedMotion } from '../lib/useGsap';

/**
 * Chapter 5. The question every owner asks. The funnel fills top to bottom, the numbers
 * climb, and the week's heatmap lights up hour by hour, until the only rose number on
 * the screen is walk-ins.
 */
export function ProofChapter() {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const numRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const reduce = useReducedMotion();

  useScrub(
    trackRef,
    (p) => {
      const vars: Record<string, number> = {};
      FUNNEL.forEach((row, i) => {
        const a = 0.08 + i * 0.2;
        const t = smooth(span(p, a, a + 0.22));
        vars[`--bar-${i}`] = t;
        const el = numRefs.current[i];
        if (el) el.textContent = Math.round(row.value * t).toLocaleString();
      });
      vars['--hp'] = span(p, 0.2, 0.9); // heatmap bloom
      vars['--dash-y'] = (1 - smooth(span(p, 0, 0.18))) * 40;
      vars['--dash-o'] = smooth(span(p, 0, 0.14));
      setVars(stageRef.current, vars);
    },
    { enabled: !reduce },
  );

  return (
    <section ref={trackRef} id="proof" className="lp-track lp-proof-track" aria-labelledby="proof-title">
      <div ref={stageRef} className="lp-stage lp-proof">
        <div className="lp-container lp-proof-grid">
          <div className="lp-proof-copy">
            <Chapter n="05">The proof</Chapter>
            <SplitReveal as="h2" id="proof-title" className="lp-h2" playOn={reduce ? 'mount' : 'scroll'}>
              “Is this putting bodies in seats?”
            </SplitReveal>
            <p className="lp-lede">Here is exactly how we count. Every claimed offer is a customer who showed up.</p>
            <p className="lp-sample-note">Sample week below. These are illustrative numbers, not a customer’s results.</p>

            <ol className="lp-funnel" aria-label="How a scan becomes a walk-in">
              {FUNNEL.map((row, i) => (
                <li key={row.label} className={`lp-funnel-row${row.accent ? ' is-accent' : ''}`} style={{ ['--i' as string]: i, ['--w' as string]: `${100 - i * 22}%` } as CSSProperties}>
                  <div className="lp-funnel-bar" aria-hidden="true" />
                  <div className="lp-funnel-body">
                    <row.icon size={18} aria-hidden="true" className="lp-funnel-icon" />
                    <div>
                      <h3 className="lp-h4">
                        {row.label}
                        <span className="lp-funnel-num">
                          <span ref={(el) => void (numRefs.current[i] = el)}>{reduce ? row.value.toLocaleString() : '0'}</span>
                        </span>
                      </h3>
                      <p>{row.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <figure className="lp-dash" aria-describedby="dash-caption">
            <figcaption id="dash-caption" className="lp-dash-label">
              Example dashboard · illustrative numbers, not customer results
            </figcaption>
            <div className="lp-dash-tiles">
              {FUNNEL.map((row) => (
                <div key={row.label} className={`lp-tile${row.accent ? ' is-accent' : ''}`}>
                  <span className="lp-tile-label">{row.label === 'Scans' ? 'Scans this week' : row.label}</span>
                  <span className="lp-tile-num">{row.value.toLocaleString()}</span>
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
                      <span
                        key={h}
                        className="lp-heat-cell"
                        style={{ ['--v' as string]: heat(di, hi).toFixed(2), ['--t' as string]: ((hi + di * 0.35) / (HOURS.length + 2)).toFixed(3) } as CSSProperties}
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
  );
}
