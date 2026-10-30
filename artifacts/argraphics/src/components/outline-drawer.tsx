import { useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Eraser, Scissors, Wand2 } from 'lucide-react';
import { outlineUsable, type OutlinePoint, type Parts } from '@/lib/outline';

/** Ignore pointer jitter smaller than this (a fraction of the photo) while tracing. */
const MIN_STEP = 0.004;

/**
 * The tracing steps. The item outline is what the cutout keeps. For a drink in clear glass,
 * two more loops tell the 3D build which parts are the drink and the garnish, so the glass
 * can be made see-through around them and the garnish is never mistaken for glass.
 */
type Step = 'item' | 'liquid' | 'garnish';
const STEPS: Record<Step, { title: string; hint: string; colour: string }> = {
  item: { title: 'Outline the item', hint: 'glass, garnish, straw and base. Anything outside your line is treated as background.', colour: 'hsl(var(--primary))' },
  liquid: { title: 'Trace the drink', hint: 'just the liquid, right up to the glass edge and across the top of the ice. The glass above it will be see-through in 3D.', colour: '#38bdf8' },
  garnish: { title: 'Trace the garnish', hint: 'lemon, orange wheel, herbs or straw, one loop each. Skip this if there is none.', colour: '#fb923c' },
};

/**
 * Lets the owner trace around the item on their photo with a finger or mouse. The trace closes
 * itself when the finger lifts. Points are fractions of the displayed photo, which the browser
 * shows upright, matching the server's EXIF-rotated copy. With `labelParts`, the item outline
 * is followed by the drink and garnish loops.
 */
export function OutlineDrawer({ src, subject, labelParts = false, onUse, onSkip, onBack }: {
  src: string;
  subject: string;
  labelParts?: boolean;
  onUse: (outline: OutlinePoint[], parts?: Parts) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>('item');
  const [item, setItem] = useState<OutlinePoint[]>([]);
  const [liquid, setLiquid] = useState<OutlinePoint[]>([]);
  const [garnish, setGarnish] = useState<OutlinePoint[][]>([]);
  const [points, setPoints] = useState<OutlinePoint[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const pointFrom = (event: PointerEvent<HTMLDivElement>): OutlinePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    setPoints([pointFrom(event)]);
  };
  const extend = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const next = pointFrom(event);
    setPoints((current) => {
      const last = current[current.length - 1];
      return last && Math.hypot(next[0] - last[0], next[1] - last[1]) < MIN_STEP ? current : [...current, next];
    });
  };
  const finish = () => {
    if (!drawing) return;
    setDrawing(false);
    setPoints((current) => {
      if (!outlineUsable(current)) return [];
      // Garnish loops stack up: each closed loop is kept and the next can start right away.
      if (step === 'garnish') {
        setGarnish((loops) => [...loops, current]);
        return [];
      }
      return current;
    });
  };

  const usable = !drawing && outlineUsable(points);
  const pathOf = (loop: OutlinePoint[]) => loop.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  const path = pathOf(points);
  const parts = (): Parts | undefined => (liquid.length || garnish.length ? { liquid: liquid.length ? liquid : undefined, garnish: garnish.length ? garnish : undefined } : undefined);

  const next = () => {
    if (step === 'item') {
      setItem(points);
      if (!labelParts) { onUse(points); return; }
      setPoints([]);
      setStep('liquid');
    } else if (step === 'liquid') {
      setLiquid(usable ? points : []);
      setPoints([]);
      setStep('garnish');
    } else {
      onUse(item, parts());
    }
  };
  const back = () => {
    if (step === 'item') { onBack(); return; }
    setPoints([]);
    if (step === 'liquid') { setStep('item'); setPoints(item); }
    else { setStep('liquid'); setPoints(liquid); }
  };
  const clear = () => {
    setPoints([]);
    if (step === 'garnish') setGarnish([]);
  };

  const { title, hint, colour } = STEPS[step];
  const stepNumber = step === 'item' ? 1 : step === 'liquid' ? 2 : 3;
  const canContinue = step === 'garnish' ? !drawing : usable;
  const status = drawing ? 'Keep going all the way around…'
    : step === 'garnish' ? (garnish.length ? `${garnish.length} garnish loop${garnish.length > 1 ? 's' : ''}. Trace another, or continue.` : 'Trace each garnish, or continue without.')
      : usable ? 'Looks good. Not quite right? Just draw it again.' : 'Press and drag around it. Lift to close the loop.';

  return (
    <div className="rounded-[1.5rem] border border-border bg-background p-4 sm:p-5" data-testid="panel-outline-drawer" data-step={step}>
      <p className="text-xs font-bold uppercase tracking-[.17em] text-primary">{labelParts ? `Step ${stepNumber} of 3 · ` : ''}{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">Trace {step === 'item' ? `around ${subject}` : step === 'liquid' ? 'the drink' : 'the garnish'} with your finger or mouse: {hint}</p>
      <div className="mt-4 grid place-items-center rounded-2xl bg-muted p-2">
        <div className="relative inline-block max-w-full select-none">
          <img src={src} alt={`Photo of ${subject} to outline`} onLoad={() => setLoaded(true)} draggable={false} className="block max-h-[58dvh] max-w-full rounded-xl" />
          {loaded && (
            <div
              className="absolute inset-0 cursor-crosshair touch-none"
              onPointerDown={start}
              onPointerMove={extend}
              onPointerUp={finish}
              onPointerCancel={finish}
              role="application"
              aria-label={`Trace ${step === 'item' ? `around ${subject}` : step === 'liquid' ? 'the drink' : 'the garnish'}`}
              data-testid="surface-outline"
            >
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden="true">
                {step === 'item' && usable && <path d={`M0 0H1V1H0Z ${path}Z`} fillRule="evenodd" fill="rgb(0 0 0 / .55)" />}
                {step !== 'item' && item.length > 1 && <path d={`M0 0H1V1H0Z ${pathOf(item)}Z`} fillRule="evenodd" fill="rgb(0 0 0 / .55)" />}
                {step === 'garnish' && liquid.length > 1 && <path d={`${pathOf(liquid)}Z`} fill="rgb(56 189 248 / .3)" stroke={STEPS.liquid.colour} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                {step === 'garnish' && garnish.map((loop, index) => <path key={index} d={`${pathOf(loop)}Z`} fill="rgb(251 146 60 / .35)" stroke={STEPS.garnish.colour} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
                {points.length > 1 && <path d={drawing ? path : `${path}Z`} fill="none" stroke="white" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
                {points.length > 1 && <path d={drawing ? path : `${path}Z`} fill="none" stroke={colour} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
              </svg>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground" role="status">{status}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {step === 'garnish' || (step === 'liquid' && labelParts) ? (
          <button type="button" onClick={next} disabled={!canContinue} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-use-outline">
            {step === 'garnish' ? <><Scissors size={17} /> Cut it out</> : <>Next: the garnish <ArrowRight size={17} /></>}
          </button>
        ) : (
          <button type="button" onClick={next} disabled={!usable} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-use-outline">
            {labelParts ? <>Next: the drink <ArrowRight size={17} /></> : <><Scissors size={17} /> Cut out what I outlined</>}
          </button>
        )}
        {step === 'item' && <button type="button" onClick={onSkip} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-skip-outline"><Wand2 size={16} /> Find it automatically</button>}
        {step === 'liquid' && <button type="button" onClick={() => { setLiquid([]); setPoints([]); setStep('garnish'); }} className="flex min-h-12 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-skip-liquid">Skip</button>}
      </div>
      <div className="mt-2 flex justify-between">
        <button type="button" onClick={back} className="flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-outline-back"><ArrowLeft size={15} /> Back</button>
        {(points.length > 0 || (step === 'garnish' && garnish.length > 0)) && <button type="button" onClick={clear} className="flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-clear-outline"><Eraser size={15} /> Clear</button>}
      </div>
    </div>
  );
}
