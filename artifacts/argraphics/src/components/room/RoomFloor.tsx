import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'wouter';
import { Plus } from 'lucide-react';
import type { Display } from '@workspace/api-client-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { TYPE_ICONS } from '@/components/display-parts';
import { buttonClass } from '@/components/partner-ui';
import { placementLabel, typeLabel } from '@/lib/display-draft';
import { formatCount, plural } from '@/lib/traffic';
import {
  BAR_COUNTER, ENTRANCE, FLOOR, ZONES, clampPosition, defaultPositions, fromPlate, haloOpacity, isDrag, markerRadius, toPlate, type Point,
} from '@/lib/room-layout';
import { EASE_OUT, gsap, prefersReducedMotion } from '@/lib/motion';
import type { Pulse } from '@/hooks/use-live-board';

export type RoomDisplay = Pick<Display, 'id' | 'title' | 'type' | 'placement' | 'status' | 'mediaUrl' | 'drink' | 'floorX' | 'floorY' | 'createdAt' | 'scansThisWeek' | 'redemptionsThisWeek'>;
export type RoomCount = { scans: number; redemptions: number };
export type RoomCounts = Map<string, RoomCount>;

type Props = {
  displays: RoomDisplay[];
  /** Activity per display (tonight, or this week when the room is closed). */
  counts?: RoomCounts;
  countsLabel?: string;
  /** New scans and claims to ripple, each exactly once. */
  pulses?: Pulse[];
  onMove?: (id: string, point: Point | null) => void;
  className?: string;
};

const NUDGE = 0.02;
const NO_COUNT: RoomCount = { scans: 0, redemptions: 0 };

/**
 * The venue, drawn: a counter, a wall, a window, the tables and the door, with every
 * display sitting where it really is. Drag a marker to move it, tap it for details.
 * Scans ripple out of the spot they happened at.
 */
export function RoomFloor({ displays, counts, countsLabel = 'tonight', pulses = [], onMove, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rippleLayer = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [drag, setDrag] = useState<{ id: string; point: Point } | null>(null);
  const [nudged, setNudged] = useState<Map<string, Point>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);
  const dragStart = useRef<{ id: string; client: Point; offset: Point } | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledPulses = useRef(new Set<string>());

  const radius = markerRadius(width);
  const saved = useMemo(() => defaultPositions(displays), [displays]);
  const positions = useMemo(() => {
    const map = new Map<string, Point>();
    displays.forEach((display) => {
      const base = nudged.get(display.id) ?? saved.get(display.id) ?? { x: 0.5, y: 0.5 };
      map.set(display.id, drag?.id === display.id ? drag.point : toPlate(base));
    });
    return map;
  }, [displays, saved, nudged, drag]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setWidth(wrap.clientWidth || 1000);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Markers settle into the room when it first appears.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || displays.length === 0 || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('.room-marker-body', { opacity: 0, scale: 0.85, transformOrigin: '50% 50%', duration: 0.35, stagger: 0.03, ease: EASE_OUT, clearProps: 'transform,opacity' });
    }, svg);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displays.length === 0]);

  // Each new scan ripples out of its spot; a claim rings twice in the accent colour.
  useEffect(() => {
    const layer = rippleLayer.current;
    const svg = svgRef.current;
    if (!layer || !svg) return;
    for (const pulse of pulses) {
      if (handledPulses.current.has(pulse.id)) continue;
      handledPulses.current.add(pulse.id);
      const chip = svg.querySelector<SVGGElement>(`[data-chip="${CSS.escape(pulse.displayId ?? '')}"]`);
      if (chip && !prefersReducedMotion()) {
        gsap.fromTo(chip, { scale: 1 }, { scale: 1.3, transformOrigin: '50% 50%', duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out' });
      }
      if (prefersReducedMotion()) continue;
      const at = (pulse.displayId && positions.get(pulse.displayId)) || ENTRANCE;
      const rings = pulse.kind === 'redemption' ? 2 : 1;
      for (let ring = 0; ring < rings; ring += 1) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(at.x));
        circle.setAttribute('cy', String(at.y));
        circle.setAttribute('r', String(radius * 0.8));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', pulse.kind === 'redemption' ? 'hsl(var(--primary))' : 'hsl(var(--foreground))');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('pointer-events', 'none');
        layer.appendChild(circle);
        gsap.fromTo(circle, { attr: { r: radius * 0.8 }, opacity: 0.6 }, {
          attr: { r: radius * 3.6 }, opacity: 0, duration: 1.2, delay: ring * 0.25, ease: 'power2.out',
          onComplete: () => circle.remove(),
        });
      }
    }
  }, [pulses, positions, radius]);

  const platePoint = (event: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const matrix = svg.getScreenCTM()?.inverse();
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const mapped = matrix ? point.matrixTransform(matrix) : point;
    return { x: mapped.x, y: mapped.y };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const current = positions.get(id)!;
    const at = platePoint(event);
    dragStart.current = { id, client: { x: event.clientX, y: event.clientY }, offset: { x: at.x - current.x, y: at.y - current.y } };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, point: current });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const at = platePoint(event);
    const clamped = toPlate(clampPosition(fromPlate({ x: at.x - start.offset.x, y: at.y - start.offset.y })));
    setDrag({ id: start.id, point: clamped });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGGElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!isDrag(start.client, { x: event.clientX, y: event.clientY })) {
      setDrag(null);
      setOpenId(start.id);
      return;
    }
    const point = positions.get(start.id)!;
    setDrag(null);
    setNudged((current) => { const next = new Map(current); next.delete(start.id); return next; });
    onMove?.(start.id, clampPosition(fromPlate(point)));
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    const step: Record<string, Point> = { ArrowLeft: { x: -NUDGE, y: 0 }, ArrowRight: { x: NUDGE, y: 0 }, ArrowUp: { x: 0, y: -NUDGE }, ArrowDown: { x: 0, y: NUDGE } };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpenId(id);
      return;
    }
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    const from = fromPlate(positions.get(id)!);
    const next = clampPosition({ x: from.x + delta.x, y: from.y + delta.y });
    setNudged((current) => new Map(current).set(id, next));
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => {
      setNudged((current) => { const copy = new Map(current); copy.delete(id); return copy; });
      onMove?.(id, next);
    }, 400);
  };

  const open = openId ? displays.find((display) => display.id === openId) ?? null : null;
  const openAt = open ? positions.get(open.id)! : null;
  const stroke = 'hsl(var(--border))';
  const dim = 'hsl(var(--muted-foreground))';

  return (
    <div ref={wrapRef} className={`room relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-card ${className ?? ''}`}>
      <svg ref={svgRef} viewBox={`0 0 ${FLOOR.w} ${FLOOR.h}`} className="block h-auto w-full select-none" role="group" aria-label="Your room: where each display sits">
        <defs>
          <pattern id="room-dots" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="1.2" fill={stroke} />
          </pattern>
        </defs>
        <rect width={FLOOR.w} height={FLOOR.h} fill="url(#room-dots)" opacity="0.55" />

        {/* Wall */}
        <rect x={ZONES.wall.x} y={ZONES.wall.y} width={ZONES.wall.w} height={ZONES.wall.h} rx="10" fill="hsl(var(--muted))" fillOpacity="0.5" stroke={stroke} />
        <text x={ZONES.wall.x + 14} y={ZONES.wall.y + 24} className="room-label" fontSize="13" fill={dim}>Wall</text>

        {/* Bar counter with stools */}
        <rect x={BAR_COUNTER.x} y={BAR_COUNTER.y} width={BAR_COUNTER.w} height={BAR_COUNTER.h} rx="36" fill="hsl(var(--muted))" stroke={stroke} />
        <text x={BAR_COUNTER.x + BAR_COUNTER.w / 2} y={BAR_COUNTER.y + BAR_COUNTER.h / 2 + 5} textAnchor="middle" className="room-label" fontSize="13" fill={dim}>Bar</text>
        {[0, 1, 2, 3, 4].map((stool) => (
          <circle key={stool} cx={BAR_COUNTER.x + 50 + stool * 55} cy={BAR_COUNTER.y + BAR_COUNTER.h + 22} r="9" fill="none" stroke={stroke} />
        ))}

        {/* Window */}
        <rect x={ZONES.window.x} y={ZONES.window.y} width={ZONES.window.w} height={ZONES.window.h} rx="10" fill="none" stroke={stroke} />
        {[1, 2, 3, 4].map((mullion) => (
          <line key={mullion} x1={ZONES.window.x} x2={ZONES.window.x + ZONES.window.w} y1={ZONES.window.y + (ZONES.window.h / 5) * mullion} y2={ZONES.window.y + (ZONES.window.h / 5) * mullion} stroke={stroke} />
        ))}
        <text transform={`translate(${ZONES.window.x - 12} ${ZONES.window.y + ZONES.window.h / 2}) rotate(-90)`} textAnchor="middle" className="room-label" fontSize="13" fill={dim}>Window</text>

        {/* Tables */}
        <rect x={ZONES.table.x} y={ZONES.table.y} width={ZONES.table.w} height={ZONES.table.h} rx="14" fill="none" stroke={stroke} strokeDasharray="6 8" />
        <text x={ZONES.table.x + 14} y={ZONES.table.y + 24} className="room-label" fontSize="13" fill={dim}>Tables</text>

        {/* By the door, and the door */}
        <rect x={ZONES.poster.x} y={ZONES.poster.y} width={ZONES.poster.w} height={ZONES.poster.h} rx="12" fill="none" stroke={stroke} strokeDasharray="6 8" />
        <path d={`M ${ENTRANCE.x - 70} ${FLOOR.h} A 70 70 0 0 1 ${ENTRANCE.x} ${FLOOR.h - 70}`} fill="none" stroke={stroke} strokeWidth="2" />
        <line x1={ENTRANCE.x} y1={FLOOR.h - 70} x2={ENTRANCE.x} y2={FLOOR.h} stroke={stroke} strokeWidth="3" />
        <text x={ENTRANCE.x - 14} y={FLOOR.h - 12} textAnchor="end" className="room-label" fontSize="13" fill={dim}>Entrance</text>

        <g ref={rippleLayer} aria-hidden="true" />

        {displays.map((display) => {
          const at = positions.get(display.id)!;
          const count = counts?.get(display.id) ?? NO_COUNT;
          const image = display.mediaUrl || display.drink?.thumbnailUrl || null;
          const Icon = TYPE_ICONS[display.type];
          const dragging = drag?.id === display.id;
          return (
            <g
              key={display.id}
              transform={`translate(${at.x} ${at.y})`}
              className="room-marker"
              data-display-id={display.id}
              role="button"
              tabIndex={0}
              aria-label={`${display.title}, ${placementLabel(display.placement)}${count.scans ? `, ${plural(count.scans, 'scan')} ${countsLabel}` : ''}. Drag or use arrow keys to move, Enter for details.`}
              onPointerDown={(event) => onPointerDown(event, display.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
              onKeyDown={(event) => onKeyDown(event, display.id)}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            >
              <g className="room-marker-body" opacity={display.status === 'draft' ? 0.45 : 1}>
                <circle r={radius * 1.75} fill="hsl(var(--foreground))" opacity={haloOpacity(count.scans)} className="room-halo" />
                <circle r={radius + (dragging ? 3 : 0)} fill="hsl(var(--muted))" stroke="hsl(var(--foreground))" strokeWidth={display.status === 'live' ? 2 : 1.5} strokeDasharray={display.status === 'paused' ? '6 5' : undefined} className="room-ring" />
                <clipPath id={`room-clip-${display.id}`}><circle r={radius - 2} /></clipPath>
                {image ? (
                  <image href={image} x={-radius} y={-radius} width={radius * 2} height={radius * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#room-clip-${display.id})`} />
                ) : (
                  <Icon x={-radius * 0.42} y={-radius * 0.42} width={radius * 0.84} height={radius * 0.84} color="hsl(var(--muted-foreground))" strokeWidth={1.75} aria-hidden="true" />
                )}
                {count.scans > 0 && (
                  <g transform={`translate(${radius * 0.72} ${-radius * 0.72})`} data-chip={display.id}>
                    <rect x={-14} y={-11} width={28} height={22} rx={11} fill={count.redemptions > 0 ? 'hsl(var(--primary))' : 'hsl(var(--card))'} stroke={count.redemptions > 0 ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'} />
                    <text y={4} textAnchor="middle" fontSize="12" fontWeight="600" fill={count.redemptions > 0 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))'}>{formatCount(count.scans)}</text>
                  </g>
                )}
                <text y={radius + 18} textAnchor="middle" className="room-label" fontSize="14" fontWeight="500" fill="hsl(var(--foreground))">{display.title}</text>
              </g>
            </g>
          );
        })}
      </svg>

      {displays.length === 0 && (
        <div className="absolute inset-0 grid place-items-center">
          <Link href="/displays/new" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" /> Put your first display in the room</Link>
        </div>
      )}

      <Popover open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }}>
        <PopoverAnchor asChild>
          <span className="pointer-events-none absolute h-px w-px" style={{ left: `${((openAt?.x ?? 0) / FLOOR.w) * 100}%`, top: `${((openAt?.y ?? 0) / FLOOR.h) * 100}%` }} />
        </PopoverAnchor>
        {open && (
          <PopoverContent side="top" sideOffset={radius * (width / FLOOR.w) + 8} onFocusOutside={(event) => event.preventDefault()} onOpenAutoFocus={(event) => event.preventDefault()} className="w-64 rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl">
            <p className="text-xs text-muted-foreground">{typeLabel(open.type)} · {placementLabel(open.placement)}</p>
            <h3 className="mt-0.5 truncate text-base font-semibold">{open.title}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {countsLabel === 'tonight' ? (
                <div><dt className="text-xs text-muted-foreground">Scans tonight</dt><dd className="text-2xl font-light tabular-nums">{formatCount(counts?.get(open.id)?.scans ?? 0)}</dd></div>
              ) : (
                <div><dt className="text-xs text-muted-foreground">Walk-ins this week</dt><dd className="text-2xl font-light tabular-nums pa-accent-text">{formatCount(open.redemptionsThisWeek)}</dd></div>
              )}
              <div><dt className="text-xs text-muted-foreground">Scans this week</dt><dd className="text-2xl font-light tabular-nums">{formatCount(open.scansThisWeek)}</dd></div>
            </dl>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Link href={`/displays/${open.id}`} className={buttonClass('ghost', 'sm')}>Edit display</Link>
              {(open.floorX !== null || open.floorY !== null) && onMove && (
                <button type="button" className="min-h-9 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setOpenId(null); onMove(open.id, null); }}>Reset spot</button>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}
