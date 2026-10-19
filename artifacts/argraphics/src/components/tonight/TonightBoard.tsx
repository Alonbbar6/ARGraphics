import { createElement, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Display, LiveBoard, LiveEvent } from '@workspace/api-client-react';
import { useCountUp } from '@/components/partner-ui';
import { RoomFloor, type RoomCounts } from '@/components/room/RoomFloor';
import type { Pulse } from '@/hooks/use-live-board';
import { ensureModelViewer } from '@/lib/model-viewer';
import type { Point } from '@/lib/room-layout';
import { formatHHMM } from '@/lib/service-hours';
import { countLabel, formatCount, plural } from '@/lib/traffic';
import { TYPE_ICONS } from '@/components/display-parts';

type Props = {
  venueName: string;
  displays: Display[];
  board: LiveBoard | null;
  pulses: Pulse[];
  onMove: (id: string, point: Point | null) => void;
  onLeave: () => void;
};

function relative(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function BigNumber({ value, label, accent, testId }: { value: number; label: string; accent?: boolean; testId: string }) {
  const shown = useCountUp(value, 700);
  return (
    <div>
      <p className={`tonight-number tabular-nums ${accent ? 'pa-accent-text' : ''}`} data-testid={testId}>{formatCount(Math.round(shown))}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The live board: big numbers, the room, and whatever is winning right now. Made for a
 * phone propped behind the bar or a screen on the wall, so everything reads from a
 * few feet away and nothing needs a click.
 */
export function TonightBoard({ venueName, displays, board, pulses, onMove, onLeave }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // While forced on outside hours, show the most recent window so the board is never empty.
  const window = board?.tonight ?? board?.lastNight ?? null;
  const windowLabel = board?.tonight ? `since ${formatHHMM(board.serviceOpen)}` : board?.lastNight ? 'last night' : 'tonight';
  const counts = useMemo<RoomCounts>(() => new Map((window?.byDisplay ?? []).map((entry) => [entry.displayId, { scans: entry.scans, redemptions: entry.redemptions }])), [window]);
  const leader = useMemo(() => {
    const best = window?.byDisplay[0];
    const display = best ? displays.find((item) => item.id === best.displayId) : undefined;
    return display ? { display, scans: best!.scans } : null;
  }, [window, displays]);
  const glb = leader?.display.drink?.modelGlbUrl ?? leader?.display.artwork?.modelGlbUrl ?? null;
  const image = leader?.display.mediaUrl ?? leader?.display.drink?.thumbnailUrl ?? null;
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => {
    if (!glb) return;
    let alive = true;
    void ensureModelViewer().then(() => { if (alive) setModelReady(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, [glb]);

  const events: LiveEvent[] = (board?.events ?? []).slice(0, 12);

  return (
    <div className="tonight" data-testid="tonight-board">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{venueName}</p>
          <h1 className="serif text-[2.25rem] leading-[1.05] md:text-5xl">Tonight</h1>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className="room-live-dot" aria-hidden="true" /> Live · {windowLabel}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-label="Tonight so far" className="owner-stat flex flex-col justify-between gap-6 p-5">
          <BigNumber value={window?.scans ?? 0} label={plural(window?.scans ?? 0, 'scan')} testId="tonight-scans" />
          <BigNumber value={window?.redemptions ?? 0} label={plural(window?.redemptions ?? 0, 'walk-in')} accent testId="tonight-walkins" />
          <BigNumber value={window?.visitors ?? 0} label="people" testId="tonight-people" />
        </section>

        <section aria-label="The room">
          <RoomFloor displays={displays} counts={counts} countsLabel={board?.tonight ? 'tonight' : 'last night'} pulses={pulses} onMove={onMove} />
        </section>

        <section aria-label="Winning right now" className="owner-stat flex min-h-[320px] flex-col p-5">
          <p className="text-sm font-semibold">Winning right now</p>
          {leader ? (
            <>
              <div className="tonight-hero mt-3 grid h-44 place-items-center overflow-hidden rounded-xl bg-muted">
                {glb && modelReady ? createElement('model-viewer', {
                  src: glb, alt: '', 'auto-rotate': '', 'rotation-per-second': '24deg', 'environment-image': 'neutral', 'shadow-intensity': '0.5',
                  'interaction-prompt': 'none', 'disable-zoom': '', 'aria-hidden': 'true', style: { width: '100%', height: '100%' },
                }) : image ? <img src={image} alt="" className="h-full w-full object-contain p-3" /> : (
                  createElement(TYPE_ICONS[leader.display.type], { size: 56, strokeWidth: 1.25, className: 'text-muted-foreground', 'aria-hidden': 'true' })
                )}
              </div>
              <h2 className="mt-3 truncate text-lg font-semibold">
                <Link href={`/displays/${leader.display.id}`} className="hover:underline">{leader.display.title}</Link>
              </h2>
              <p className="text-sm text-muted-foreground">{countLabel(leader.scans, 'scan')} {windowLabel}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">The first scan tonight puts a drink here.</p>
          )}
          <ul className="mt-4 space-y-1 border-t border-border pt-3" aria-label="Latest scans">
            {events.length === 0 && <li className="text-sm text-muted-foreground">Quiet so far.</li>}
            {events.map((event) => (
              <li key={event.id} className="tonight-row flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {event.kind === 'redemption' && <span className="pa-accent-text font-semibold">Walk-in · </span>}
                  {event.spotLabel ?? 'Somewhere'}{event.displayTitle ? <span className="text-muted-foreground"> · {event.displayTitle}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relative(event.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-6 text-center">
        <button type="button" onClick={onLeave} className="min-h-11 text-sm text-muted-foreground hover:text-foreground" data-testid="button-leave-tonight">Back to the day view</button>
      </p>
    </div>
  );
}
