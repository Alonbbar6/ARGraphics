import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useGetAnalytics, useGetSession, useListDisplays } from '@workspace/api-client-react';
import { ArrowRight, DoorOpen, Plus, Repeat, ScanLine, Users } from 'lucide-react';
import { buttonClass, ErrorPanel, PageHeader, Skeleton, StatTile, StatusBadge, Badge } from '@/components/partner-ui';
import { DisplayThumb } from '@/components/display-parts';
import { formatEventDate, placementLabel, typeLabel } from '@/lib/display-draft';
import { countLabel, dayKey, formatCount, formatDelta, greeting, plural, topDisplay, upcomingEvents } from '@/lib/traffic';

export function HomePage() {
  const session = useGetSession();
  const analytics = useGetAnalytics({ range: 'week' });
  const displays = useListDisplays();

  const now = new Date();
  const firstName = (session.data?.userName || '').split(' ')[0];
  const totals = analytics.data?.totals;
  const previous = analytics.data?.previous;
  // Deltas only mean something when last week had any activity to compare against.
  const lastWeekHadData = (previous?.scans ?? 0) > 0 || (previous?.redemptions ?? 0) > 0;
  const today = analytics.data?.series.find((day) => day.date === dayKey(now, analytics.data?.timezone));
  const list = displays.data ?? [];
  const top = topDisplay(list);
  const nextEvent = upcomingEvents(list, now)[0] ?? null;
  const live = list.filter((display) => display.status === 'live');

  const hero = (
    <Link href="/displays/new" className={buttonClass('hero', 'md', 'w-full md:w-auto')} data-testid="button-create-display">
      <Plus size={17} aria-hidden="true" /> Create AR display
    </Link>
  );

  return (
    <div className="rise">
      <PageHeader
        serif
        title={<>{greeting(now)}{firstName ? `, ${firstName}` : ''}</>}
        lede={<>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.{totals ? <> {walkInLine(totals.redemptions, totals.scans)}</> : null}</>}
        actions={<div className="hidden md:block">{hero}</div>}
      />

      {analytics.isLoading ? (
        <div className="grid gap-4" aria-label="Loading today’s and this week’s numbers">
          <Skeleton className="h-20" />
          <Skeleton className="h-36" />
        </div>
      ) : analytics.isError || !totals || !previous ? (
        <ErrorPanel title="This week’s numbers aren’t in yet." onRetry={() => void analytics.refetch()}>
          We couldn’t reach your scan counts. Your displays are still live for guests.
        </ErrorPanel>
      ) : (
        <div className="grid gap-4">
          <section aria-labelledby="today-heading" className="owner-stat pa-card-in flex flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-5">
            <h2 id="today-heading" className="w-full text-sm font-semibold sm:w-auto sm:min-w-24">Today</h2>
            <dl className="flex gap-8">
              <div className="flex items-baseline gap-2">
                <dt className="order-2 text-sm text-muted-foreground">{plural(today?.redemptions ?? 0, 'walk-in')}</dt>
                <dd className="order-1 text-3xl font-light tabular-nums pa-accent-text" data-testid="value-today-walkins">{formatCount(today?.redemptions ?? 0)}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="order-2 text-sm text-muted-foreground">{plural(today?.scans ?? 0, 'scan')}</dt>
                <dd className="order-1 text-3xl font-light tabular-nums" data-testid="value-today-scans">{formatCount(today?.scans ?? 0)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="week-heading">
            <div className="mb-2 flex items-end justify-between">
              <h2 id="week-heading" className="text-sm font-semibold">This week</h2>
              <Link href="/analytics" className="flex min-h-9 items-center gap-1 text-xs font-semibold text-primary">Is it working? <ArrowRight size={13} aria-hidden="true" /></Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatTile index={0} emphasis icon={DoorOpen} label="Walk-ins from AR" value={totals.redemptions} delta={formatDelta(totals.redemptions, previous.redemptions, 'last week', lastWeekHadData)} testId="value-home-walkins" />
              <StatTile index={1} icon={Users} label="Unique visitors" value={totals.uniqueVisitors} delta={formatDelta(totals.uniqueVisitors, previous.uniqueVisitors, 'last week', lastWeekHadData)} testId="value-home-visitors" />
              <StatTile index={2} icon={ScanLine} label="Scans" value={totals.scans} delta={formatDelta(totals.scans, previous.scans, 'last week', lastWeekHadData)} testId="value-home-scans" />
              <StatTile index={3} icon={Repeat} label="Came back again" value={totals.repeatVisitors} delta={formatDelta(totals.repeatVisitors, previous.repeatVisitors, 'last week', lastWeekHadData)} testId="value-home-repeat" />
            </div>
          </section>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card labelledBy="top-display-heading" delay={240}>
          {displays.isLoading ? <Skeleton className="h-40" /> : top ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <DisplayThumb display={top} addImageHref={`/displays/${top.id}`} className="h-40 shrink-0 rounded-xl sm:h-auto sm:min-h-40 sm:w-40" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2"><StatusBadge status={top.status} /><Badge tone="featured">Top performer</Badge></div>
                <h2 id="top-display-heading" className="mt-2 truncate text-lg font-semibold" data-testid="text-top-display">
                  <Link href={`/displays/${top.id}`} className="hover:underline">{top.title}</Link>
                </h2>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-muted-foreground">{plural(top.redemptionsThisWeek, 'Walk-in')}</dt><dd className="pa-numeral pa-accent-text !text-3xl tabular-nums">{formatCount(top.redemptionsThisWeek)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{plural(top.scansThisWeek, 'Scan')}</dt><dd className="pa-numeral !text-3xl tabular-nums">{formatCount(top.scansThisWeek)}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">{typeLabel(top.type)} · {placementLabel(top.placement)} · this week</p>
              </div>
            </div>
          ) : (
            <>
              <h2 id="top-display-heading" className="text-base font-semibold">Top performer</h2>
              <p className="mt-1 text-sm text-muted-foreground">{live.length ? 'Waiting on the first scan. Make sure the codes are out on the tables.' : 'Put one display live and the one that brings people in shows up here.'}</p>
              <Link href={live.length ? '/qr-codes' : '/displays/new'} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">{live.length ? 'Print QR codes' : 'Make your first display'} <ArrowRight size={14} aria-hidden="true" /></Link>
            </>
          )}
        </Card>

        <Card labelledBy="events-heading" delay={300}>
          <div className="mb-3 flex items-center justify-between">
            <h2 id="events-heading" className="text-base font-semibold">Coming up</h2>
            <Link href="/displays/new?type=event_teaser" className="flex min-h-11 items-center text-xs font-semibold text-primary">Tease an event</Link>
          </div>
          {displays.isLoading ? <Skeleton className="h-16" /> : !nextEvent ? (
            <p className="text-sm text-muted-foreground">No events on the calendar. A trivia night or a pop-up gives regulars a reason to bring friends.</p>
          ) : (
            <EventRow event={nextEvent} />
          )}
        </Card>
      </div>

      <div className="pa-mobile-hero md:hidden">{hero}</div>
    </div>
  );
}

function Card({ labelledBy, delay, children }: { labelledBy: string; delay: number; children: ReactNode }) {
  return (
    <section className="owner-stat pa-card-in p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

function EventRow({ event }: { event: { id: string; title: string; eventStartsAt: string | null; scansThisWeek: number } }) {
  // The event's scheduled start, never when the display was created.
  const date = new Date(event.eventStartsAt!);
  return (
    <Link href={`/displays/${event.id}`} className="flex min-h-12 items-center gap-3 rounded-xl hover:bg-muted/60">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-muted text-center">
        <span className="text-[10px] font-semibold uppercase leading-none text-muted-foreground">{date.toLocaleDateString('en-US', { weekday: 'short' })}<span className="block text-base leading-tight text-foreground">{date.getDate()}</span></span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{event.title}</span>
        <span className="block text-xs text-muted-foreground">{formatEventDate(event.eventStartsAt)} · {countLabel(event.scansThisWeek, 'scan')} so far</span>
      </span>
    </Link>
  );
}


function walkInLine(walkIns: number, scans: number) {
  if (walkIns > 0) return `${countLabel(walkIns, 'guest', 'people')} came in and claimed an AR offer this week. That’s people in seats, not impressions.`;
  if (scans > 0) return `${countLabel(scans, 'scan')} this week. Add an offer to see who walks in because of it.`;
  return 'Every number here is a person in your room, not an impression.';
}
