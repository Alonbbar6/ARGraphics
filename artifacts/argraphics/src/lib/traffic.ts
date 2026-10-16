/**
 * Small, pure helpers behind the partner dashboard numbers: deltas, counts with
 * the right plural, the neutral heatmap scale, hour/day labels and display summaries.
 */

export type AnalyticsRangeKey = 'week' | 'month' | 'season';

export const RANGE_OPTIONS: { value: AnalyticsRangeKey; label: string; previous: string }[] = [
  { value: 'week', label: 'This week', previous: 'last week' },
  { value: 'month', label: 'Month', previous: 'last month' },
  { value: 'season', label: 'Season', previous: 'last season' },
];

export function previousLabel(range: AnalyticsRangeKey) {
  return RANGE_OPTIONS.find((option) => option.value === range)?.previous ?? 'last week';
}

export type Delta = { direction: 'up' | 'down' | 'flat'; text: string; percent: number | null };

/**
 * Change versus the previous period, written the way an owner would say it.
 * Null when there is nothing honest to compare against: the previous period had
 * no data at all (`previousHadData` false), or neither period has any of this metric.
 */
export function formatDelta(current: number, previous: number, against = 'last week', previousHadData = previous > 0): Delta | null {
  if (!previousHadData) return null;
  const cur = Number.isFinite(current) ? current : 0;
  const prev = Number.isFinite(previous) ? previous : 0;
  if (cur === 0 && prev === 0) return null;
  if (cur === prev) return { direction: 'flat', text: `Same as ${against}`, percent: 0 };
  if (prev <= 0) return { direction: 'up', text: `New since ${against}`, percent: null };
  const percent = Math.round(((cur - prev) / prev) * 100);
  if (percent === 0) return { direction: 'flat', text: `About the same as ${against}`, percent: 0 };
  return {
    direction: percent > 0 ? 'up' : 'down',
    text: `${Math.abs(percent)}% ${percent > 0 ? 'up' : 'down'} vs ${against}`,
    percent,
  };
}

export function formatCount(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

/** The noun that goes with a count: plural(1, 'scan') → "scan", plural(2, 'walk-in') → "walk-ins". */
export function plural(count: number, one: string, many = `${one}s`) {
  return Math.round(Number.isFinite(count) ? count : 0) === 1 ? one : many;
}

/** A count with its noun: countLabel(1, 'scan') → "1 scan", countLabel(1200, 'walk-in') → "1,200 walk-ins". */
export function countLabel(count: number, one: string, many?: string) {
  return `${formatCount(count)} ${plural(count, one, many)}`;
}

/** Share of a total as a whole percent, 0 when there is nothing to divide. */
export function share(part: number, total: number) {
  if (!total || !Number.isFinite(part) || !Number.isFinite(total)) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Heatmap tint: the foreground color at rising opacity, from faint (quiet) to
 * solid (packed), so it reads in light and dark without spending the accent.
 * Returns null for an empty hour so the cell can use the neutral surface.
 */
export function heatmapColor(value: number, max: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) return null;
  const t = Math.min(1, value / max);
  return `hsl(var(--foreground) / ${(0.15 + t * 0.75).toFixed(2)})`;
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 0 → "12a", 13 → "1p". */
export function hourShort(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
}

/** 0 → "12 AM", 21 → "9 PM". */
export function hourLong(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Busiest single hour and quietest day of a Monday-first 7×24 grid. */
export function heatmapSummary(heatmap: number[][]) {
  let peak: { day: number; hour: number; scans: number } | null = null;
  const dayTotals = DAY_NAMES.map((_, day) => (heatmap[day] ?? []).reduce((sum, value) => sum + (Number(value) || 0), 0));
  heatmap.slice(0, 7).forEach((row, day) => row.slice(0, 24).forEach((value, hour) => {
    if (value > 0 && (!peak || value > peak.scans)) peak = { day, hour, scans: value };
  }));
  const max = Math.max(0, ...heatmap.slice(0, 7).flatMap((row) => row.slice(0, 24)));
  const total = dayTotals.reduce((sum, value) => sum + value, 0);
  const quietDay = total > 0 ? dayTotals.indexOf(Math.min(...dayTotals)) : null;
  return { peak: peak as { day: number; hour: number; scans: number } | null, max, total, dayTotals, quietDay };
}

/** Today's calendar day as "2026-10-14" in the venue's timezone, to match the daily series. */
export function dayKey(date: Date, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

/** "2026-10-14" → "Wed" (parsed as a calendar day, never shifted by timezone). */
export function shortDay(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/** "2026-10-14" → "Oct 14". */
export function shortDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function greeting(date: Date) {
  const hour = date.getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

type DisplayLike = {
  type: string;
  status: string;
  eventStartsAt: string | null;
  scansThisWeek: number;
  redemptionsThisWeek: number;
};

/** Event teasers still ahead of us, soonest first. */
export function upcomingEvents<T extends DisplayLike>(displays: T[], now = new Date()) {
  return displays
    .filter((display) => display.type === 'event_teaser' && display.status !== 'paused' && display.eventStartsAt && new Date(display.eventStartsAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.eventStartsAt!).getTime() - new Date(b.eventStartsAt!).getTime());
}

/** The display bringing the most people in: walk-ins first, scans break ties. Null until anyone has scanned. */
export function topDisplay<T extends DisplayLike>(displays: T[]) {
  const ranked = displays
    .filter((display) => display.scansThisWeek > 0 || display.redemptionsThisWeek > 0)
    .sort((a, b) => b.redemptionsThisWeek - a.redemptionsThisWeek || b.scansThisWeek - a.scansThisWeek);
  return ranked[0] ?? null;
}

/** Converts an ISO timestamp to the value a datetime-local input expects, in local time. */
export function isoToLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a datetime-local value (local time) to ISO, or null when blank or invalid. */
export function localInputToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A prefilled "Invite a venue" email for artists. */
export function inviteVenueMailto(artistName: string, slug: string, origin: string) {
  const link = `${origin.replace(/\/$/, '')}/register?ref=${encodeURIComponent(slug)}`;
  const subject = `Want my art on your walls, in AR?`;
  const body = [
    'Hi there,',
    '',
    `I'm ${artistName || 'a local artist'}. I put my work on ARGraphics, where guests scan a code at your place and see a piece that only exists in your room.`,
    '',
    "It's a reason for people to come by on the slow nights, and you can see exactly how many scans and walk-ins it brings.",
    '',
    `If you want to try it, set up your spot here: ${link}`,
    '',
    'Thanks,',
    artistName || '',
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AR';
}
