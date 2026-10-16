import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { ArrowDownRight, ArrowUpRight, Check, ImagePlus, LoaderCircle, Minus, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCount, type Delta } from '@/lib/traffic';
import './partner.css';

/* ------------------------------------------------------------------ motion */

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Counts a numeral up on load (about 800ms); with reduced motion it simply shows the value. */
export function useCountUp(target: number, duration = 800) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(origin + (target - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);
  return value;
}

/* ----------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'hero' | 'ghost' | 'destructive' | 'quiet';

export function buttonClass(variant: ButtonVariant = 'primary', size: 'md' | 'sm' | 'icon' = 'md', className?: string) {
  return cn('pa-btn', `pa-btn-${variant}`, size === 'sm' ? 'pa-btn-sm' : size === 'icon' ? 'pa-btn-icon' : '', className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'md' | 'sm' | 'icon';
  loading?: boolean;
  loadingText?: string;
  icon?: LucideIcon;
};

export function Button({ variant = 'primary', size = 'md', loading, loadingText, icon: Icon, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : Icon ? <Icon size={17} aria-hidden="true" /> : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

/* ------------------------------------------------------------------ header */

/** Page title. Only Home uses the serif headline; every other page gets a plain sans title. */
export function PageHeader({ title, lede, actions, serif = false }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode; serif?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className={serif ? 'serif text-[2.25rem] leading-[1.1] md:text-5xl' : 'pa-title'}>{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{lede}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- stat tile */

export function DeltaLine({ delta }: { delta: Delta }) {
  const Icon = delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <p className={cn('pa-delta mt-1.5 flex items-center gap-1 text-xs', `is-${delta.direction}`)}>
      <Icon size={13} aria-hidden="true" />
      <span>{delta.text}</span>
    </p>
  );
}

export function StatTile({ icon: Icon, label, value, suffix, delta, note, testId, emphasis, index = 0 }: {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
  delta?: Delta | null;
  note?: string;
  testId?: string;
  emphasis?: boolean;
  index?: number;
}) {
  const shown = useCountUp(value);
  return (
    <section className={cn('owner-stat pa-card-in p-4 sm:p-5', emphasis && 'pa-stat-emphasis')} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="owner-chip-icon" aria-hidden="true"><Icon size={14} /></span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <p className="pa-numeral mt-3 tabular-nums" data-testid={testId} aria-label={`${formatCount(value)}${suffix ? ` ${suffix}` : ''}`}>
        <span aria-hidden="true">{formatCount(shown)}</span>
        {suffix && <span className="ml-1.5 text-sm font-normal text-muted-foreground" aria-hidden="true">{suffix}</span>}
      </p>
      {delta && <DeltaLine delta={delta} />}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ badges */

export function Badge({ tone = 'neutral', children, className }: { tone?: 'live' | 'draft' | 'paused' | 'offer' | 'featured' | 'neutral' | 'violet'; children: ReactNode; className?: string }) {
  return <span className={cn('pa-badge', `pa-badge-${tone}`, className)}>{tone === 'live' && <span className="owner-live-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />}{children}</span>;
}

export function StatusBadge({ status }: { status: 'draft' | 'live' | 'paused' }) {
  return <Badge tone={status}>{status === 'live' ? 'Live' : status === 'paused' ? 'Paused' : 'Draft'}</Badge>;
}

/* ------------------------------------------------------ skeleton and empty */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('pa-skeleton', className)} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground" aria-hidden="true"><Icon size={24} /></span>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </section>
  );
}

export function ErrorPanel({ title = 'We couldn’t load this just now.', onRetry, children }: { title?: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <section role="alert" className="rounded-2xl border border-border bg-card p-6 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children ?? 'Check your connection and try again. Nothing you saved is lost.'}</p>
      {onRetry && <Button variant="ghost" className="mt-4" onClick={onRetry}>Try again</Button>}
    </section>
  );
}

/* ----------------------------------------------------- segmented control */

export function SegmentedControl<T extends string>({ value, onChange, options, label, className, size = 'md' }: {
  value: T;
  onChange: (value: NoInfer<T>) => void;
  options: { value: NoInfer<T>; label: ReactNode; icon?: LucideIcon }[];
  label: string;
  className?: string;
  size?: 'md' | 'sm';
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (step: number) => {
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`${groupId}-${next.value}`)?.focus());
  };
  const groupId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  // Segments are sized by their labels, so the thumb follows the active one's real box.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const place = () => {
      const active = group.querySelectorAll<HTMLElement>('.pa-segment')[index];
      if (!active) return;
      group.style.setProperty('--thumb-left', `${active.offsetLeft}px`);
      group.style.setProperty('--thumb-width', `${active.offsetWidth}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(group);
    return () => observer.disconnect();
  }, [index, options.length]);
  return (
    <div ref={groupRef} role="radiogroup" aria-label={label} className={cn('pa-segmented', size === 'sm' && 'is-sm', className)}>
      <span className="pa-segmented-thumb" aria-hidden="true" />
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => {
        const checked = optionValue === value;
        return (
          <button
            key={optionValue}
            id={`${groupId}-${optionValue}`}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(optionValue)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1); }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
            }}
            className={cn('pa-segment', checked && 'is-active')}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            <span>{optionLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- step indicator */

export function StepIndicator({ steps, current, onStep, maxReachable }: { steps: string[]; current: number; onStep?: (index: number) => void; maxReachable?: number }) {
  return (
    <nav aria-label="Progress" className="mb-6">
      <p className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {current + 1} of {steps.length}</span>
        <span className="font-semibold text-foreground">{steps[current]}</span>
      </p>
      <ol className="pa-steps" style={{ ['--count' as string]: steps.length }}>
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          const reachable = onStep && index <= (maxReachable ?? current);
          return (
            <li key={step} className={cn('pa-step', `is-${state}`)}>
              <button type="button" disabled={!reachable} onClick={() => onStep?.(index)} aria-current={state === 'current' ? 'step' : undefined} className="pa-step-button">
                <span className="pa-step-bar" aria-hidden="true" />
                <span className="pa-step-label">
                  {state === 'done' && <Check size={12} aria-hidden="true" />}
                  {step}
                  <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* --------------------------------------------------------------- dropzone */

export function Dropzone({ onFile, accept = 'image/png,image/jpeg,image/webp', title, hint, busy, previewUrl, onClear }: {
  onFile: (file: File) => void;
  accept?: string;
  title: string;
  hint: string;
  busy?: boolean;
  previewUrl?: string | null;
  onClear?: () => void;
}) {
  const [over, setOver] = useState(false);
  const inputId = useId();
  return (
    <div
      className={cn('pa-dropzone', over && 'is-over', previewUrl && 'has-preview')}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      {previewUrl ? (
        <div className="flex items-center gap-4">
          <img src={previewUrl} alt="Chosen image" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1 text-left">
            <p className="text-sm font-semibold">{busy ? 'Uploading…' : 'Looks good.'}</p>
            <p className="text-xs text-muted-foreground">{busy ? 'Hang on while we save it.' : 'This is what guests will see in the room.'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label htmlFor={inputId} className={buttonClass('ghost', 'sm')}>Replace</label>
              {onClear && <Button variant="quiet" size="sm" onClick={onClear} icon={X}>Remove</Button>}
            </div>
          </div>
        </div>
      ) : (
        <label htmlFor={inputId} className="flex cursor-pointer flex-col items-center gap-2 py-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full border border-border bg-muted text-muted-foreground" aria-hidden="true">
            {busy ? <LoaderCircle size={20} className="animate-spin" /> : <ImagePlus size={20} />}
          </span>
          <span className="text-sm font-semibold">{title}</span>
          <span className="max-w-xs text-xs text-muted-foreground">{hint}</span>
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------- confirm dialog */

export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, onConfirm, busy, tone = 'destructive' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  tone?: 'destructive' | 'primary';
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="pa-dialog-overlay" />
        <AlertDialogPrimitive.Content className="pa-dialog">
          <AlertDialogPrimitive.Title className="text-xl font-semibold tracking-tight">{title}</AlertDialogPrimitive.Title>
          {children && <AlertDialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground">{children}</AlertDialogPrimitive.Description>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel className={buttonClass('ghost')}>Keep it</AlertDialogPrimitive.Cancel>
            <Button variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/* ---------------------------------------------------- phone preview frame */

export function PhoneFrame({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <figure className="mx-auto w-full max-w-[300px]">
      <div className="pa-phone-glow">
        <div className="pa-phone">
          <div className="pa-phone-notch" aria-hidden="true" />
          <div className="pa-phone-screen">{children}</div>
        </div>
      </div>
      {caption && <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ field */

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && !error && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}

export const inputClass = 'pa-input';
