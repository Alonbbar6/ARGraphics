import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { FrameLoader } from '@/lib/frame-loader';
import {
  containRect,
  coverRect,
  frameUrl,
  pickFrameSet,
  progressToIndex,
  resolveFromManifest,
  type FrameManifest,
  type FrameSet,
} from '@/lib/frame-sequence';
import { gsap, isMobileViewport, prefersReducedMotion, registerGsap } from '../lib/gsap';

export type ScrollCanvasStatus = 'loading' | 'ready' | 'missing' | 'error';

export type ScrollCanvasHandle = {
  /** Show the frame for scroll progress 0..1. Cheap; call it from a scrub callback. */
  seek: (progress: number) => void;
  /** Number of frames in the chosen set, 0 until the manifest loads. */
  frameCount: () => number;
};

type Props = {
  /** URL of the sequence manifest, e.g. `${import.meta.env.BASE_URL}sequences/hero/manifest.json`. */
  manifestUrl: string;
  /** What the sequence shows, for assistive tech. */
  alt: string;
  fit?: 'cover' | 'contain';
  /** Vertical focus for `cover`, 0 = top, 1 = bottom. */
  focusY?: number;
  /** Play `manifest.intro` once after the first batch decodes, if the visitor has not scrolled. */
  intro?: boolean;
  /** Start fetching only when the canvas is near the viewport. */
  lazy?: boolean;
  className?: string;
  style?: CSSProperties;
  onStatus?: (status: ScrollCanvasStatus) => void;
  /** Overlay content rendered above the canvas, inside the same box. */
  children?: ReactNode;
};

function maxResidentFor(set: FrameSet) {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (isMobileViewport()) return mem !== undefined && mem < 4 ? 24 : 40;
  if (mem !== undefined && mem >= 8) return set.count;
  return 60;
}

/**
 * A canvas that shows one frame of a pre-rendered image sequence for a given progress.
 * The parent owns the scroll mapping and calls `seek(progress)`; this component owns
 * loading, decoding, memory and drawing. Nothing here reads layout during a scrub.
 */
export const ScrollCanvas = forwardRef<ScrollCanvasHandle, Props>(function ScrollCanvas(
  { manifestUrl, alt, fit = 'cover', focusY = 0.5, intro = false, lazy = false, className, style, onStatus, children },
  ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ScrollCanvasStatus>('loading');
  const [poster, setPoster] = useState<string | null>(null);
  const [near, setNear] = useState(!lazy);

  // Mutable drawing state, kept out of React so scrubbing never re-renders.
  const state = useRef({
    loader: null as FrameLoader | null,
    set: null as FrameSet | null,
    manifest: null as FrameManifest | null,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    lastDrawn: -1,
    pending: -1,
    raf: 0,
    userScrolled: false,
    introTween: null as gsap.core.Tween | null,
  });

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  // Draw the requested frame (or the nearest decoded one), at most once per animation frame.
  const draw = () => {
    const s = state.current;
    s.raf = 0;
    const canvas = canvasRef.current;
    const loader = s.loader;
    const set = s.set;
    if (!canvas || !loader || !set || s.pending < 0) return;
    const found = loader.nearest(s.pending);
    if (!found) return;
    if (found.index === s.lastDrawn) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = fit === 'cover' ? coverRect(set.width, set.height, s.cssW, s.cssH, focusY) : containRect(set.width, set.height, s.cssW, s.cssH, focusY);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.cssW, s.cssH);
    ctx.drawImage(found.image, rect.dx, rect.dy, rect.dw, rect.dh);
    s.lastDrawn = found.index;
  };

  const requestDraw = (index: number) => {
    const s = state.current;
    s.pending = index;
    s.loader?.want(index);
    if (!s.raf) s.raf = requestAnimationFrame(draw);
  };

  useImperativeHandle(
    ref,
    () => ({
      seek: (progress: number) => {
        const s = state.current;
        const set = s.set;
        if (!set) return;
        if (progress > 0.002 && !s.userScrolled) {
          s.userScrolled = true;
          s.introTween?.kill();
          s.introTween = null;
        }
        if (s.introTween) return; // the intro is still playing from frame 0
        requestDraw(progressToIndex(progress, set.count));
      },
      frameCount: () => state.current.set?.count ?? 0,
    }),
    [],
  );

  // Lazy start: begin fetching when the box is within one viewport of the screen.
  useEffect(() => {
    if (!lazy || near) return;
    const box = boxRef.current;
    if (!box) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '100% 0px' },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [lazy, near]);

  // Size the canvas to its box, in device pixels (capped), and redraw after a resize.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const s = state.current;
      const entry = entries[0];
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (!w || !h) return;
      const cap = isMobileViewport() ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, cap);
      s.cssW = w;
      s.cssH = h;
      s.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      s.lastDrawn = -1;
      if (s.pending >= 0 && !s.raf) s.raf = requestAnimationFrame(draw);
    });
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the manifest, pick a set, start the loader, play the intro.
  useEffect(() => {
    if (!near) return;
    const s = state.current;
    const controller = new AbortController();
    let loader: FrameLoader | null = null;
    registerGsap();

    (async () => {
      let manifest: FrameManifest;
      try {
        const res = await fetch(manifestUrl, { signal: controller.signal });
        // A dev server answers missing files with the SPA's index.html, so check the type too.
        const type = res.headers.get('content-type') ?? '';
        if (res.status === 404 || (res.ok && !type.includes('json'))) {
          setStatus('missing');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        manifest = (await res.json()) as FrameManifest;
      } catch (err) {
        if (controller.signal.aborted) return;
        if (import.meta.env.DEV) console.warn('[scroll-canvas] manifest', manifestUrl, err);
        setStatus('error');
        return;
      }

      const set = pickFrameSet(manifest, window.innerWidth, window.innerHeight);
      s.manifest = manifest;
      s.set = set;
      setPoster(resolveFromManifest(manifestUrl, manifest.poster));

      // Reduced motion: the poster is the whole experience. Do not fetch 100 frames.
      if (prefersReducedMotion()) {
        setStatus('ready');
        return;
      }

      const urls = Array.from({ length: set.count }, (_, i) => frameUrl(manifestUrl, set, i));
      let firstBatch = true;
      loader = new FrameLoader(urls, {
        maxResident: maxResidentFor(set),
        onDecoded: () => {
          if (s.pending >= 0 && !s.raf) s.raf = requestAnimationFrame(draw);
        },
        onBatch: () => {
          if (!firstBatch) return;
          firstBatch = false;
          setStatus('ready');
          if (s.pending < 0) requestDraw(0);
          if (intro && manifest.intro && !s.userScrolled) {
            const proxy = { frame: 0 };
            s.introTween = gsap.to(proxy, {
              frame: Math.min(manifest.intro.endFrame, set.count - 1),
              duration: manifest.intro.durationMs / 1000,
              ease: 'power2.out',
              onUpdate: () => requestDraw(Math.round(proxy.frame)),
              onComplete: () => {
                s.introTween = null;
              },
            });
          }
        },
      });
      s.loader = loader;
      void loader.load();
    })();

    return () => {
      controller.abort();
      s.introTween?.kill();
      s.introTween = null;
      loader?.dispose();
      if (s.loader === loader) s.loader = null;
      s.set = null;
      s.lastDrawn = -1;
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl, near, intro]);

  return (
    <div ref={boxRef} className={`lp-seq is-${status}${className ? ` ${className}` : ''}`} style={style} role="img" aria-label={alt}>
      <canvas ref={canvasRef} className="lp-seq-canvas" aria-hidden="true" />
      {poster ? <img className="lp-seq-poster" src={poster} alt="" aria-hidden="true" decoding="async" /> : null}
      {children}
    </div>
  );
});
