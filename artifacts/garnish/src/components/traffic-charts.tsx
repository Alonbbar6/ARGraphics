import { useState } from 'react';
import type { TrafficDay } from '@workspace/api-client-react';
import { DAY_NAMES, DAY_SHORT, formatCount, heatmapColor, hourLong, hourShort, shortDate, shortDay } from '@/lib/traffic';

/** Scans and walk-ins per day on one shared count axis (both are people). */
export function ScansChart({ series, height = 180 }: { series: TrafficDay[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = series.slice(-120);
  const max = Math.max(1, ...days.map((day) => Math.max(day.scans, day.redemptions)));
  const niceMax = niceCeiling(max);
  const width = 640;
  const plotTop = 8;
  const plotBottom = height - 22;
  const plotHeight = plotBottom - plotTop;
  const slot = width / Math.max(1, days.length);
  const barWidth = Math.max(2, Math.min(18, slot * 0.36));
  const gap = days.length > 40 ? 0 : 2;
  const y = (value: number) => plotBottom - (value / niceMax) * plotHeight;
  const labelEvery = days.length <= 8 ? 1 : days.length <= 31 ? 5 : 14;
  const active = hover !== null ? days[hover] : null;

  if (days.length === 0) return <p className="grid h-40 place-items-center text-sm text-muted-foreground">No scans in this range yet.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6D28D9] dark:bg-[#A855F7]" />Scans</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#F43F5E]" />Walk-ins (offers claimed)</span>
        <span className="ml-auto min-h-4 tabular-nums text-foreground" aria-live="polite">
          {active ? `${shortDay(active.date)} ${shortDate(active.date)}: ${formatCount(active.scans)} scans, ${formatCount(active.redemptions)} walk-ins` : ''}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Scans and walk-ins per day, ${shortDate(days[0].date)} to ${shortDate(days[days.length - 1].date)}. Highest day: ${formatCount(max)}.`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={0} x2={width} y1={y(niceMax * t)} y2={y(niceMax * t)} className="stroke-border" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
            {t > 0 && <text x={0} y={y(niceMax * t) - 4} className="fill-muted-foreground" fontSize={10}>{formatCount(niceMax * t)}</text>}
          </g>
        ))}
        {days.map((day, index) => {
          const cx = index * slot + slot / 2;
          const scanHeight = Math.max(day.scans > 0 ? 2 : 0, plotBottom - y(day.scans));
          const redemptionHeight = Math.max(day.redemptions > 0 ? 2 : 0, plotBottom - y(day.redemptions));
          return (
            <g key={day.date} onMouseEnter={() => setHover(index)}>
              <rect x={index * slot} y={plotTop} width={slot} height={plotHeight} fill="transparent" />
              {hover === index && <rect x={index * slot} y={plotTop} width={slot} height={plotHeight} className="fill-muted" opacity={0.6} />}
              <rect x={cx - barWidth - gap / 2} y={plotBottom - scanHeight} width={barWidth} height={scanHeight} rx={Math.min(4, barWidth / 2)} className="fill-[#6D28D9] dark:fill-[#A855F7]" />
              <rect x={cx + gap / 2} y={plotBottom - redemptionHeight} width={barWidth} height={redemptionHeight} rx={Math.min(4, barWidth / 2)} fill="#F43F5E" />
              {index % labelEvery === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>{days.length <= 8 ? shortDay(day.date) : shortDate(day.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-xs">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">See the numbers</summary>
        <div className="max-h-64 overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card"><tr><th className="px-3 py-2 font-medium">Day</th><th className="px-3 py-2 text-right font-medium">Scans</th><th className="px-3 py-2 text-right font-medium">Walk-ins</th></tr></thead>
            <tbody>{days.map((day) => <tr key={day.date} className="border-t border-border"><td className="px-3 py-1.5">{shortDay(day.date)} {shortDate(day.date)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatCount(day.scans)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatCount(day.redemptions)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function niceCeiling(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

/** Day-of-week × hour grid tinted Indigo (quiet) → Coral (packed). */
export function ScanHeatmap({ heatmap, compact = false }: { heatmap: number[][]; compact?: boolean }) {
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const rows = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => Number(heatmap[day]?.[hour]) || 0));
  const max = Math.max(0, ...rows.flat());
  const hours = compact ? Array.from({ length: 12 }, (_, i) => i * 2) : Array.from({ length: 24 }, (_, i) => i);
  const value = (day: number, hour: number) => compact ? rows[day][hour] + rows[day][hour + 1] : rows[day][hour];
  const cellMax = compact ? Math.max(0, ...rows.flatMap((row) => hours.map((hour) => row[hour] + row[hour + 1]))) : max;
  const shown = hover ? `${DAY_NAMES[hover.day]} ${hourLong(hover.hour)}${compact ? `–${hourLong(hover.hour + 2)}` : ''}: ${formatCount(value(hover.day, hover.hour))} scans` : '';

  return (
    <div>
      <p className="mb-2 min-h-4 text-xs tabular-nums text-foreground" aria-live="polite">{shown}</p>
      <table className="pa-heat" onMouseLeave={() => setHover(null)}>
        <caption className="sr-only">Scans by day of week and hour. Darker indigo is quiet, coral is packed.</caption>
        <thead>
          <tr>
            <th scope="col" className="w-9"><span className="sr-only">Day</span></th>
            {hours.map((hour) => <th key={hour} scope="col" className="text-center">{hour % 6 === 0 ? hourShort(hour) : <span className="sr-only">{hourShort(hour)}</span>}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((_, day) => (
            <tr key={DAY_SHORT[day]}>
              <th scope="row" className="pr-1 text-left">{DAY_SHORT[day]}</th>
              {hours.map((hour) => {
                const count = value(day, hour);
                const color = heatmapColor(count, cellMax);
                return (
                  <td key={hour} style={color ? { background: color } : undefined} onMouseEnter={() => setHover({ day, hour })} title={`${DAY_NAMES[day]} ${hourLong(hour)}: ${count} scans`}>
                    <span className="sr-only">{DAY_NAMES[day]} {hourLong(hour)}: {count} scans</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden="true">
        Quiet
        <span className="h-2.5 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, #2A1B5E, #6D28D9, #F43F5E)' }} />
        Packed
      </div>
    </div>
  );
}
