import { useRef } from 'react';
import { SplitReveal } from '../components/SplitReveal';
import { Chapter } from '../components/ui';
import { EMPTY_BAR_PHOTO, PAINS } from '../data';
import { setVars, smooth, span, useScrub } from '../lib/scroll';
import { useReducedMotion } from '../lib/useGsap';

const N = PAINS.length;

/**
 * Chapter 2. The room goes quiet. Three pains slide across the screen while the light
 * dims and a number on each panel drops to where it really lands on a Wednesday.
 */
export function ProblemChapter() {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const statRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const reduce = useReducedMotion();

  useScrub(
    trackRef,
    (p) => {
      // Hold at the first panel briefly, then travel, then hold at the last.
      const travel = smooth(span(p, 0.08, 0.92)) * (N - 1);
      const vars: Record<string, number> = {
        '--rail-x': -travel,
        '--dim': 0.1 + 0.5 * smooth(span(p, 0, 0.9)),
      };
      PAINS.forEach((pain, i) => {
        const dist = Math.abs(travel - i); // 0 when this panel is centred
        const focus = 1 - Math.min(1, dist);
        vars[`--panel-${i}`] = focus;
        const t = smooth(span(1 - dist, 0.3, 1));
        const v = Math.round(pain.stat.from + (pain.stat.to - pain.stat.from) * t);
        const el = statRefs.current[i];
        if (el) el.textContent = v.toLocaleString();
      });
      setVars(stageRef.current, vars);
    },
    { enabled: !reduce },
  );

  return (
    <section ref={trackRef} id="problem" className="lp-track lp-problem-track" aria-labelledby="problem-title">
      <div ref={stageRef} className="lp-stage lp-problem">
        <img className="lp-problem-bg" src={EMPTY_BAR_PHOTO} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        <div className="lp-problem-dim" aria-hidden="true" />
        <div className="lp-container lp-problem-head">
          <Chapter n="02">The problem</Chapter>
          <SplitReveal as="h2" id="problem-title" className="lp-h2" playOn={reduce ? 'mount' : 'scroll'}>
            Slow nights are not a menu problem.
          </SplitReveal>
        </div>

        <ul className="lp-rail" aria-label="What a slow night costs">
          {PAINS.map((pain, i) => (
            <li key={pain.title} className="lp-panel" style={{ ['--i' as string]: i }}>
              <div className="lp-container lp-panel-inner">
                <p className="lp-panel-n" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h3 className="lp-panel-title">{pain.title}</h3>
                <p className="lp-panel-body">{pain.body}</p>
                <p className="lp-panel-stat">
                  <span className="lp-panel-num" ref={(el) => void (statRefs.current[i] = el)}>
                    {reduce ? pain.stat.to.toLocaleString() : pain.stat.from.toLocaleString()}
                  </span>
                  <span className="lp-panel-stat-label">{pain.stat.label}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>

        <ol className="lp-rail-dots" aria-hidden="true">
          {PAINS.map((pain, i) => (
            <li key={pain.title} style={{ ['--i' as string]: i }} />
          ))}
        </ol>
      </div>
    </section>
  );
}
