import { Link } from 'wouter';
import { useGetAnalytics, useGetPartnerProfile, useGetSession, useListDisplays } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, DoorOpen, Plus, Repeat, ScanLine, Sparkles, Users } from 'lucide-react';
import { buttonClass, EmptyState, ErrorPanel, PageHeader, Skeleton, StatTile, StatusBadge, Badge } from '@/components/partner-ui';
import { DisplayThumb } from '@/components/display-parts';
import { ScansChart } from '@/components/traffic-charts';
import { formatEventDate, placementLabel, typeLabel } from '@/lib/display-draft';
import { formatCount, formatDelta, greeting, topDisplay, upcomingEvents } from '@/lib/traffic';

export function HomePage() {
  const session = useGetSession();
  const profile = useGetPartnerProfile();
  const analytics = useGetAnalytics({ range: 'week' });
  const displays = useListDisplays();

  const now = new Date();
  const firstName = (session.data?.userName || '').split(' ')[0];
  const venueName = profile.data?.name || session.data?.barName || 'your spot';
  const totals = analytics.data?.totals;
  const previous = analytics.data?.previous;
  const list = displays.data ?? [];
  const top = topDisplay(list);
  const events = upcomingEvents(list, now).slice(0, 3);
  const live = list.filter((display) => display.status === 'live');

  const hero = (
    <Link href="/displays/new" className={buttonClass('hero', 'md', 'w-full md:w-auto')} data-testid="button-create-display">
      <Plus size={17} aria-hidden="true" /> Create AR display
    </Link>
  );

  return (
    <div className="rise">
      <PageHeader
        eyebrow={<>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · {venueName}</>}
        title={<>{greeting(now)}{firstName ? `, ${firstName}` : ''}</>}
        lede={totals ? walkInLine(totals.redemptions, totals.scans) : undefined}
        actions={<div className="hidden md:block">{hero}</div>}
      />

      {analytics.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Loading this week’s numbers">
          {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-36" />)}
        </div>
      ) : analytics.isError || !totals || !previous ? (
        <ErrorPanel title="This week’s numbers aren’t in yet." onRetry={() => void analytics.refetch()}>
          We couldn’t reach your scan counts. Your displays are still live for guests.
        </ErrorPanel>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatTile index={0} emphasis icon={DoorOpen} label="Walk-ins from AR" value={totals.redemptions} suffix="this week" delta={formatDelta(totals.redemptions, previous.redemptions)} testId="value-home-walkins" />
          <StatTile index={1} icon={Users} label="Unique visitors" value={totals.uniqueVisitors} delta={formatDelta(totals.uniqueVisitors, previous.uniqueVisitors)} testId="value-home-visitors" />
          <StatTile index={2} icon={ScanLine} label="Scans this week" value={totals.scans} delta={formatDelta(totals.scans, previous.scans)} testId="value-home-scans" />
          <StatTile index={3} icon={Repeat} label="Came back again" value={totals.repeatVisitors} delta={formatDelta(totals.repeatVisitors, previous.repeatVisitors)} testId="value-home-repeat" />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <section className="owner-stat pa-card-in p-5 sm:p-6" style={{ animationDelay: '240ms' }}>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div><h2 className="text-base font-semibold">Scans over time</h2><p className="text-xs text-muted-foreground">Last 7 days</p></div>
            <Link href="/analytics" className="flex min-h-11 items-center gap-1 text-xs font-semibold text-primary">Is it working? <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          {analytics.isLoading ? <Skeleton className="h-44" /> : <ScansChart series={analytics.data?.series ?? []} />}
        </section>

        <div className="grid content-start gap-4">
          <section className="owner-stat pa-card-in overflow-hidden" style={{ animationDelay: '300ms' }} aria-labelledby="top-display-heading">
            {displays.isLoading ? <Skeleton className="h-48 rounded-none" /> : top ? (
              <>
                <DisplayThumb type={top.type} src={top.mediaUrl || top.drink?.thumbnailUrl} className="h-32" />
                <div className="p-5">
                  <div className="flex flex-wrap gap-2"><StatusBadge status={top.status} /><Badge tone="featured">Top performer</Badge></div>
                  <h2 id="top-display-heading" className="mt-2 text-lg font-semibold" data-testid="text-top-display">{top.title}</h2>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <div><dt className="text-xs text-muted-foreground">Walk-ins</dt><dd className="pa-numeral !text-3xl tabular-nums">{formatCount(top.redemptionsThisWeek)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Scans</dt><dd className="pa-numeral !text-3xl tabular-nums">{formatCount(top.scansThisWeek)}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">{typeLabel(top.type)} · {placementLabel(top.placement)} · this week</p>
                </div>
              </>
            ) : (
              <div className="p-5">
                <h2 id="top-display-heading" className="text-base font-semibold">Top performer</h2>
                <p className="mt-1 text-sm text-muted-foreground">{live.length ? 'Waiting on the first scan. Make sure the codes are out on the tables.' : 'Put one display live and the one that brings people in shows up here.'}</p>
                <Link href={live.length ? '/qr-codes' : '/displays/new'} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">{live.length ? 'Print QR codes' : 'Make your first display'} <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
            )}
          </section>

          <section className="owner-stat pa-card-in p-5" style={{ animationDelay: '360ms' }} aria-labelledby="events-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="events-heading" className="text-base font-semibold">Coming up</h2>
              <Link href="/displays/new?type=event_teaser" className="flex min-h-11 items-center text-xs font-semibold text-primary">Tease an event</Link>
            </div>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events on the calendar. A trivia night or a pop-up gives regulars a reason to bring friends.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((event) => {
                  const date = new Date(event.eventStartsAt!);
                  return (
                    <li key={event.id}>
                      <Link href={`/displays/${event.id}`} className="flex min-h-12 items-center gap-3 rounded-xl hover:bg-muted/60">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#FB923C] text-center text-[#0B0B14]">
                          <span className="text-[10px] font-bold uppercase leading-none">{date.toLocaleDateString('en-US', { weekday: 'short' })}<span className="block text-base leading-tight">{date.getDate()}</span></span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{event.title}</span>
                          <span className="block text-xs text-muted-foreground">{formatEventDate(event.eventStartsAt)} · {formatCount(event.scansThisWeek)} scans so far</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="mt-6" aria-labelledby="live-heading">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="live-heading" className="text-base font-semibold">Bringing people in</h2>
          <Link href="/displays" className="flex min-h-11 items-center gap-1 text-xs font-semibold text-primary">All displays <ArrowRight size={13} aria-hidden="true" /></Link>
        </div>
        {displays.isLoading ? <Skeleton className="h-24" /> : displays.isError ? (
          <ErrorPanel onRetry={() => void displays.refetch()} />
        ) : live.length === 0 ? (
          <EmptyState icon={Sparkles} title="Nothing live yet.">
            Pick your slowest night. Put one dish, one offer or one piece of art on the table that people can only see in your room.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.slice(0, 6).map((display) => (
              <li key={display.id}>
                <Link href={`/displays/${display.id}`} className="pa-card flex min-h-20 items-center gap-3 p-3 hover:border-primary/50">
                  <DisplayThumb type={display.type} src={display.mediaUrl || display.drink?.thumbnailUrl} className="h-14 w-14 shrink-0 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{display.title}</span>
                    <span className="block text-xs text-muted-foreground">{formatCount(display.redemptionsThisWeek)} walk-ins · {placementLabel(display.placement)}</span>
                  </span>
                  <span className="text-right"><span className="block text-lg font-light tabular-nums">{formatCount(display.scansThisWeek)}</span><span className="block text-[11px] text-muted-foreground">scans</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pa-mobile-hero md:hidden">{hero}</div>
    </div>
  );
}

function walkInLine(walkIns: number, scans: number) {
  if (walkIns > 0) return `${formatCount(walkIns)} ${walkIns === 1 ? 'guest' : 'people'} came in and claimed an AR offer this week. That’s people in seats, not impressions.`;
  if (scans > 0) return `${formatCount(scans)} scans this week. Add an offer to see who walks in because of it.`;
  return 'Every number here is a person in your room, not an impression.';
}
