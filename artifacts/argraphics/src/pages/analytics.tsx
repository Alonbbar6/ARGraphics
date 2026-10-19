import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { getGetAnalyticsQueryKey, useGetAnalytics, useListRedemptions } from '@workspace/api-client-react';
import { BarChart3, DoorOpen, Repeat, ScanLine, Ticket, Users } from 'lucide-react';
import { EmptyState, ErrorPanel, PageHeader, SegmentedControl, Skeleton, StatTile } from '@/components/partner-ui';
import { ScanHeatmap, ScansChart } from '@/components/traffic-charts';
import { placementLabel, typeLabel } from '@/lib/display-draft';
import { DAY_NAMES, formatCount, formatDelta, heatmapSummary, hourLong, previousLabel, RANGE_OPTIONS, share, type AnalyticsRangeKey } from '@/lib/traffic';

export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRangeKey>('week');
  const params = { range };
  const analytics = useGetAnalytics(params, { query: { queryKey: getGetAnalyticsQueryKey(params), placeholderData: (previous) => previous } });
  const redemptions = useListRedemptions();
  const data = analytics.data;
  const against = previousLabel(range);
  const summary = data ? heatmapSummary(data.heatmap) : null;
  // A busiest hour or quietest day from a handful of scans would be noise, not a pattern.
  const enoughForPatterns = (data?.totals.scans ?? 0) >= 20;
  // Deltas only mean something when the previous period had any activity to compare against.
  const previousHadData = (data?.previous.scans ?? 0) > 0 || (data?.previous.redemptions ?? 0) > 0;
  const delta = (current: number, previous: number) => formatDelta(current, previous, against, previousHadData);

  return (
    <div className="rise">
      <PageHeader
        title="Is it putting people in seats?"
        lede={data ? `${rangeTitle(range)} · times in ${data.timezone}` : rangeTitle(range)}
        actions={<SegmentedControl label="Time range" className="w-full lg:w-auto" value={range} onChange={setRange} options={RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} />}
      />

      {analytics.isLoading && !data ? (
        <div className="space-y-4" aria-label="Loading analytics">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-36" />)}</div>
          <Skeleton className="h-64" />
        </div>
      ) : analytics.isError || !data ? (
        <ErrorPanel title="The numbers are taking a breather." onRetry={() => void analytics.refetch()}>We couldn’t load your scans and redemptions just now. Your displays are still working.</ErrorPanel>
      ) : (
        <div className={analytics.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatTile index={0} emphasis icon={DoorOpen} label="Redemptions (offers claimed)" value={data.totals.redemptions} delta={delta(data.totals.redemptions, data.previous.redemptions)} testId="value-walkins" />
            <StatTile index={1} icon={Users} label="Unique visitors" value={data.totals.uniqueVisitors} delta={delta(data.totals.uniqueVisitors, data.previous.uniqueVisitors)} />
            <StatTile index={2} icon={Repeat} label="Came back again" value={data.totals.repeatVisitors} delta={delta(data.totals.repeatVisitors, data.previous.repeatVisitors)} note={data.totals.uniqueVisitors ? `${share(data.totals.repeatVisitors, data.totals.uniqueVisitors)}% of visitors` : undefined} />
            <StatTile index={3} icon={ScanLine} label="Scans" value={data.totals.scans} delta={delta(data.totals.scans, data.previous.scans)} />
          </div>

          {data.totals.scans === 0 && data.byQrCode.length === 0 ? (
            <div className="mt-5">
              <EmptyState icon={BarChart3} title="The room’s just warming up." action={<Link href="/qr-codes" className="pa-btn pa-btn-primary">Print your codes</Link>}>
                Once guests start scanning, you’ll see which nights fill up, which tables scan most and how many people walk in for an offer.
              </EmptyState>
            </div>
          ) : (
            <>
              <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Panel title="From scan to seat" subtitle={rangeTitle(range)}>
                  <Funnel scans={data.totals.scans} visitors={data.totals.uniqueVisitors} repeat={data.totals.repeatVisitors} walkIns={data.totals.redemptions} />
                </Panel>
                <Panel title="When scans happen" subtitle={!enoughForPatterns ? 'Patterns show up after about 20 scans' : summary?.peak ? `Busiest: ${DAY_NAMES[summary.peak.day]} around ${hourLong(summary.peak.hour)}` : 'No scans yet'}>
                  <ScanHeatmap heatmap={data.heatmap} compact />
                  {enoughForPatterns && summary?.quietDay !== null && summary?.quietDay !== undefined && <p className="mt-3 text-xs text-muted-foreground">{DAY_NAMES[summary.quietDay]} is your quietest day. That’s the night for an offer.</p>}
                </Panel>
              </section>

              <Panel className="mt-4" title="Scans over time" subtitle="Scans and redemptions per day">
                <ScansChart series={data.series} />
              </Panel>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <Panel title="By display" subtitle="Which displays bring people in">
                  <Breakdown
                    rows={data.byDisplay.map((row) => ({ key: row.displayId, name: row.title, detail: `${typeLabel(row.type)} · ${placementLabel(row.placement)}`, scans: row.scans, walkIns: row.redemptions }))}
                    empty="No display has been scanned in this range."
                    nameHeader="Display"
                  />
                </Panel>
                <Panel title="By spot" subtitle="Which tables and windows get scanned">
                  <Breakdown
                    rows={data.byQrCode.map((row) => ({ key: row.qrCodeId, name: row.label, scans: row.scans, walkIns: row.redemptions }))}
                    empty="No spot has been scanned in this range."
                    nameHeader="Spot"
                  />
                </Panel>
              </div>
            </>
          )}

          <Panel className="mt-4" title="Recent redemptions" subtitle="Offers customers claimed and showed at the counter">
            {redemptions.isLoading ? <Skeleton className="h-24" /> : redemptions.isError ? (
              <p className="text-sm text-muted-foreground">Couldn’t load recent claims. <button type="button" className="font-semibold text-primary underline" onClick={() => void redemptions.refetch()}>Try again</button></p>
            ) : !redemptions.data?.length ? (
              <p className="text-sm text-muted-foreground">No offers claimed yet. When a guest claims one, staff see a code like <span className="font-mono">K7M2</span> and it shows up here.</p>
            ) : (
              <ul className="divide-y divide-border">
                {redemptions.data.slice(0, 15).map((claim) => (
                  <li key={claim.id} className="flex min-h-14 items-center gap-3 py-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-muted text-muted-foreground" aria-hidden="true"><Ticket size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{claim.offerTitle}</span>
                      <span className="block truncate text-xs text-muted-foreground">{claim.displayTitle}{claim.spotLabel ? ` · ${claim.spotLabel}` : ''} · {new Date(claim.claimedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-muted px-2 py-1 font-mono text-xs font-semibold tracking-wider" aria-label={`Confirmation code ${claim.confirmationCode}`}>{claim.confirmationCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function rangeTitle(range: AnalyticsRangeKey) {
  return range === 'week' ? 'Last 7 days' : range === 'month' ? 'Last 30 days' : 'This season';
}

function Panel({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`owner-stat p-4 sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Funnel({ scans, visitors, repeat, walkIns }: { scans: number; visitors: number; repeat: number; walkIns: number }) {
  const rows = [
    { label: 'Scanned a code', value: scans },
    { label: 'Unique visitors', value: visitors },
    { label: 'Came back again', value: repeat },
    { label: 'Walked in for an offer', value: walkIns, hot: true },
  ];
  const max = Math.max(1, scans);
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1.5 flex items-center justify-between text-sm"><span>{row.label}</span><span className={`font-semibold tabular-nums ${row.hot ? 'pa-accent-text' : ''}`}>{formatCount(row.value)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full owner-bar-fill ${row.hot ? 'is-accent' : ''}`} style={{ width: `${row.value > 0 ? Math.max(3, (row.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

type Row = { key: string; name: string; detail?: string; scans: number; walkIns: number };

/** A table on desktop; stat cards with a “See table” disclosure on mobile. */
function Breakdown({ rows, empty, nameHeader }: { rows: Row[]; empty: string; nameHeader: string }) {
  const sorted = [...rows].sort((a, b) => b.walkIns - a.walkIns || b.scans - a.scans);
  if (!sorted.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const table = (
    <table className="w-full text-left text-sm">
      <thead><tr className="text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">{nameHeader}</th><th scope="col" className="py-2 pr-3 text-right font-medium">Scans</th><th scope="col" className="py-2 pr-3 text-right font-medium">Redemptions</th><th scope="col" className="py-2 text-right font-medium">Walk-in rate</th></tr></thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.key} className="border-t border-border">
            <th scope="row" className="py-2.5 pr-3 font-medium"><span className="block truncate">{row.name}</span>{row.detail && <span className="block text-xs font-normal text-muted-foreground">{row.detail}</span>}</th>
            <td className="py-2.5 pr-3 text-right tabular-nums">{formatCount(row.scans)}</td>
            <td className="py-2.5 pr-3 text-right tabular-nums">{formatCount(row.walkIns)}</td>
            <td className="py-2.5 text-right tabular-nums text-muted-foreground">{row.scans ? `${share(row.walkIns, row.scans)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="hidden md:block">{table}</div>
      <div className="md:hidden">
        <ul className="grid gap-2">
          {sorted.slice(0, 4).map((row) => (
            <li key={row.key} className="rounded-xl bg-muted/50 p-3">
              <p className="truncate text-sm font-semibold">{row.name}</p>
              {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <div><dt className="text-[11px] text-muted-foreground">Scans</dt><dd className="text-xl font-light tabular-nums">{formatCount(row.scans)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Redemptions</dt><dd className="text-xl font-light tabular-nums">{formatCount(row.walkIns)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">See table{sorted.length > 4 ? ` (all ${sorted.length})` : ''}</summary>
          <div className="overflow-x-auto">{table}</div>
        </details>
      </div>
    </>
  );
}
