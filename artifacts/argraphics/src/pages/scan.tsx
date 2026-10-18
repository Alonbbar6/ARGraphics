import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Apple, Box, Check, Loader2, ScanLine } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { ensureModelViewer } from '@/lib/model-viewer';
import '@/components/partner.css';

/** Set VITE_APP_STORE_URL once the iOS app is published; until then the link stays hidden. */
export const APP_STORE_URL: string | null = ((import.meta.env.VITE_APP_STORE_URL as string | undefined) || '').trim() || null;

/** Height used when the venue hasn't set one, matching the iOS app (ModelPreparation.itemHeight). */
const DEFAULT_HEIGHT_CM = 16;
const ACCENT = 'bg-[hsl(347_77%_46%)] hover:bg-[hsl(347_77%_40%)] text-white';

export type Display = {
  id: string;
  type: 'menu_item' | 'promo_offer' | 'art_piece' | 'event_teaser';
  placement: string;
  title: string;
  description: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  modelUsdzUrl: string | null;
  modelGlbUrl: string | null;
  modelHeightCm?: number | null;
  price: string | null;
  offer: { title: string; details: string; endsAt: string | null } | null;
  eventStartsAt: string | null;
  artist: { name: string; slug: string | null; bio: string | null } | null;
};
export type ScanResult = {
  venue: { slug: string; name: string; neighborhood: string | null };
  spot: { label: string; placement: string };
  display: Display | null;
  displays: Display[];
};
type Claim = { confirmationCode: string; offerTitle: string; spotLabel: string | null; claimedAt: string; expiresAt: string };

/* ------------------------------------------------------------- guest API */

const VISITOR_KEY = 'argraphics-visitor-id';

/** Anonymous per-browser ID so the venue can count unique guests and limit claims. */
export function visitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved) return saved;
  } catch { /* storage blocked: a per-visit ID still works */ }
  // getRandomValues works on plain-http wifi addresses, where randomUUID does not.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { localStorage.setItem(VISITOR_KEY, id); } catch { /* ignore */ }
  return id;
}

/** Same guest routes as the iOS app; the browser marks these requests same-origin. */
export async function guestGet<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error((data as { error?: string }).error ?? 'Something went wrong.'), { status: response.status });
  return data as T;
}

export async function guestPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error((data as { error?: string }).error ?? 'Something went wrong.'), { status: response.status });
  return data as T;
}

/* ------------------------------------------------------------------ page */

/**
 * Public page for /s/:code, what printed codes open with the phone's own camera.
 * Web AR: no app needed. iPhone Safari places 3D in Apple's AR Quick Look, Android
 * Chrome in WebXR or Scene Viewer, both at the venue's real-world size.
 */
export function ScanPage({ code }: { code: string }) {
  const safeCode = /^[a-z0-9]{6,16}$/.test(code.toLowerCase()) ? code.toLowerCase() : '';
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; result: ScanResult }>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = 'ARGraphics';
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    if (!safeCode) {
      setState({ kind: 'error', message: 'This isn’t an ARGraphics code.' });
      return;
    }
    let alive = true;
    guestPost<ScanResult>('scans', { code: safeCode, visitorId: visitorId() })
      .then((result) => {
        if (!alive) return;
        setState({ kind: 'ready', result });
        document.title = `${result.venue.name} · ARGraphics`;
      })
      .catch((error: Error & { status?: number }) => {
        if (alive) setState({ kind: 'error', message: error.status === 404 ? 'This code isn’t active anymore.' : 'We couldn’t load this spot. Check your connection and try again.' });
      });
    return () => { alive = false; };
  }, [safeCode]);

  const result = state.kind === 'ready' ? state.result : null;
  const selected = result ? result.displays.find((display) => display.id === selectedId) ?? result.display ?? result.displays[0] ?? null : null;

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] px-4 pb-16 pt-5 text-white">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-sm font-semibold">ARGraphics</span>
        </header>

        {state.kind === 'loading' && (
          <div className="grid min-h-[60dvh] place-items-center" role="status">
            <Loader2 className="animate-spin text-white/60" size={28} aria-label="Loading" />
          </div>
        )}

        {state.kind === 'error' && (
          <section className="rounded-2xl border border-white/10 bg-[#121212] p-6 text-center">
            <ScanLine className="mx-auto mb-3 text-white/50" size={28} aria-hidden="true" />
            <h1 className="text-xl font-semibold">{state.message}</h1>
            <p className="mt-2 text-sm text-white/60">Scan the code at your table again, or ask your server.</p>
          </section>
        )}

        {result && (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight" data-testid="text-venue-name">{result.venue.name}</h1>
            <p className="mt-1 text-sm text-white/60">{result.spot.label}{result.venue.neighborhood ? ` · ${result.venue.neighborhood}` : ''}</p>

            {selected ? <DisplayView key={selected.id} display={selected} code={safeCode} /> : (
              <p className="mt-6 rounded-2xl border border-white/10 bg-[#121212] p-5 text-sm text-white/70">Nothing is showing at this spot right now.</p>
            )}

            {result.displays.length > 1 && (
              <section className="mt-8">
                <h2 className="mb-3 text-sm font-medium text-white/60">Also here</h2>
                <ul className="space-y-2">
                  {result.displays.filter((display) => display.id !== selected?.id).map((display) => (
                    <li key={display.id}>
                      <button onClick={() => { setSelectedId(display.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/10 bg-[#121212] px-4 text-left hover:border-white/25">
                        <span className="flex-1"><span className="block text-xs text-white/50">{typeLabel(display)}</span><span className="block text-sm font-medium">{display.title}</span></span>
                        {display.modelGlbUrl && <Box size={16} className="text-white/50" aria-label="3D" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {APP_STORE_URL ? (
              <a href={APP_STORE_URL} className="mt-10 flex items-center justify-center gap-2 text-xs text-white/50 hover:text-white/80" data-testid="link-app-store">
                <Apple size={14} aria-hidden="true" /> Get the ARGraphics iPhone app for table-card AR
              </a>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

export function typeLabel(display: Display) {
  return { menu_item: 'On the menu', promo_offer: 'Offer', art_piece: 'Art', event_teaser: 'Coming up' }[display.type] ?? 'Tonight';
}

/** One item: 3D with "View in AR", or its picture, plus price, details and any offer. */
export function DisplayView({ display, code }: { display: Display; code: string | null }) {
  const image = display.mediaUrl ?? display.thumbnailUrl;
  return (
    <article className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#121212]">
      {display.modelGlbUrl ? (
        <ArModel
          glbUrl={display.modelGlbUrl}
          // A real, pre-sized USDZ for iPhone: Chrome on iOS cannot open the one built in the page.
          iosSrc={display.modelUsdzUrl ? `/api/v1/displays/${encodeURIComponent(display.id)}/model.usdz` : null}
          title={display.title}
          heightCm={display.modelHeightCm ?? DEFAULT_HEIGHT_CM}
        />
      ) : image ? (
        <img src={image} alt={display.title} className="max-h-[60dvh] w-full bg-black object-contain" />
      ) : null}
      <div className="p-5">
        <p className="text-xs text-white/50">{typeLabel(display)}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold">{display.title}</h2>
          {display.price && <span className="shrink-0 text-base font-semibold">{display.price}</span>}
        </div>
        {display.description && <p className="mt-2 text-sm leading-6 text-white/70">{display.description}</p>}
        {display.artist && <p className="mt-2 text-sm text-white/70">By {display.artist.name}</p>}
        {display.eventStartsAt && (
          <p className="mt-2 text-sm text-white/70">{new Date(display.eventStartsAt).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        )}
        {display.offer && <OfferClaim display={display} code={code} />}
      </div>
    </article>
  );
}

type ModelViewerElement = HTMLElement & {
  getDimensions?: () => { x: number; y: number; z: number };
  activateAR?: () => Promise<void>;
  canActivateAR?: boolean;
  scale?: string;
};

/** Authored model heights (metres) by URL, so a revisit can preset the scale. */
const measuredHeights = new Map<string, number>();

/**
 * Interactive 3D plus native AR. The model is scaled to the venue's real-world height
 * before AR starts (Meshy exports arrive oversized). No ios-src: model-viewer builds the
 * Quick Look file from this scaled scene, so iPhone AR uses the same size.
 *
 * The scale must be set before the model loads: model-viewer 4.x throws if `scale` changes
 * on a loaded model outside an AR session. So the first load only measures the model, then
 * a fresh element loads it again (from the HTTP cache) with the scale already applied.
 */
function ArModel({ glbUrl, iosSrc, title, heightCm }: { glbUrl: string; iosSrc: string | null; title: string; heightCm: number }) {
  const ref = useRef<ModelViewerElement | null>(null);
  const [ready, setReady] = useState(false);
  const [authoredHeight, setAuthoredHeight] = useState(() => measuredHeights.get(glbUrl) ?? null);
  const [loaded, setLoaded] = useState(false);
  const [canAR, setCanAR] = useState(false);
  const [arError, setArError] = useState('');
  const scale = authoredHeight ? heightCm / 100 / authoredHeight : null;

  useEffect(() => {
    let alive = true;
    void ensureModelViewer().then(() => { if (alive) setReady(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const attach = useCallback((element: ModelViewerElement | null) => {
    ref.current = element;
    if (!element) return;
    element.addEventListener('load', () => {
      if (!authoredHeight) {
        const height = element.getDimensions?.().y ?? 0;
        if (height > 0) {
          measuredHeights.set(glbUrl, height);
          setAuthoredHeight(height);
          return;
        }
      }
      setLoaded(true);
      setCanAR(Boolean(element.canActivateAR));
    }, { once: true });
    element.addEventListener('ar-status', (event) => {
      if ((event as CustomEvent<{ status: string }>).detail.status === 'failed') setArError('AR couldn’t start here. Try again in better light, or open this page in Safari or Chrome.');
    });
  }, [authoredHeight, glbUrl]);

  return (
    <div>
      <div className="relative h-80 bg-[#0A0A0A]">
        {ready ? createElement('model-viewer', {
          key: scale ? 'scaled' : 'measuring',
          ref: attach,
          src: glbUrl,
          ...(iosSrc ? { 'ios-src': iosSrc } : {}),
          ...(scale ? { scale: `${scale} ${scale} ${scale}` } : {}),
          alt: `3D model of ${title}`,
          'camera-controls': true,
          'auto-rotate': true,
          'touch-action': 'pan-y',
          ar: true,
          'ar-modes': 'webxr scene-viewer quick-look',
          'shadow-intensity': '1',
          'environment-image': 'neutral',
          style: { width: '100%', height: '100%', backgroundColor: 'transparent' },
        }) : null}
        {!loaded && <div className="absolute inset-0 grid place-items-center"><Loader2 className="animate-spin text-white/50" size={24} aria-label="Loading 3D model" /></div>}
      </div>
      <div className="border-t border-white/10 px-5 py-4">
        {canAR ? (
          <button onClick={() => { setArError(''); void ref.current?.activateAR?.(); }} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold ${ACCENT}`} data-testid="button-view-in-ar">
            <Box size={17} aria-hidden="true" /> View in AR on your table
          </button>
        ) : loaded ? (
          <p className="text-center text-xs text-white/50">Drag to turn it. Open this page on an iPhone or Android phone to place it on your table.</p>
        ) : null}
        {canAR && <p className="mt-2 text-center text-xs text-white/50">Shown about {Math.round(heightCm)} cm tall, its real size.</p>}
        {arError && <p role="alert" className="mt-2 text-center text-xs text-red-300">{arError}</p>}
      </div>
    </div>
  );
}

function OfferClaim({ display, code }: { display: Display; code: string | null }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'claimed'; claim: Claim } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.kind !== 'claimed') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const claim = async () => {
    setState({ kind: 'busy' });
    try {
      const claimed = await guestPost<Claim>(`displays/${encodeURIComponent(display.id)}/claims`, code ? { visitorId: visitorId(), code } : { visitorId: visitorId() });
      setNow(Date.now());
      setState({ kind: 'claimed', claim: claimed });
    } catch (error) {
      const status = (error as { status?: number }).status;
      setState({ kind: 'error', message: status === 410 ? 'This offer has ended.' : status === 404 ? 'This offer isn’t available right now.' : 'Couldn’t claim it. Try again.' });
    }
  };

  if (state.kind === 'claimed') {
    const left = Math.max(0, new Date(state.claim.expiresAt).getTime() - now);
    const minutes = Math.floor(left / 60_000);
    const seconds = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
    return (
      <div className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-center" data-testid="panel-claimed">
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-300"><Check size={14} aria-hidden="true" /> Show this to your server</p>
        <p className="mt-2 font-mono text-4xl font-bold tracking-wider">{state.claim.confirmationCode}</p>
        <p className="mt-2 text-sm text-white/80">{state.claim.offerTitle}</p>
        <p className="mt-3 text-sm font-medium">{left > 0 ? `Valid for ${minutes}:${seconds}` : 'Expired'}</p>
        {/* A live clock shows staff this isn't a screenshot. */}
        <p className="mt-1 font-mono text-xs text-white/50">{new Date(now).toLocaleTimeString()}</p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="rounded-xl border border-white/15 p-4">
        <p className="font-semibold">{display.offer!.title}</p>
        {display.offer!.details && <p className="mt-1 text-sm text-white/70">{display.offer!.details}</p>}
      </div>
      <button onClick={() => void claim()} disabled={state.kind === 'busy'} className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60 ${display.modelGlbUrl ? 'border border-white/20 hover:bg-white/5' : ACCENT}`} data-testid="button-claim-offer">
        {state.kind === 'busy' && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
        Claim offer
      </button>
      {state.kind === 'error' && <p role="alert" className="mt-2 text-sm text-red-300">{state.message}</p>}
    </div>
  );
}
