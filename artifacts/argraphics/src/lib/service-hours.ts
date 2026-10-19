/**
 * Service hours as "HH:MM" wall-clock strings in the venue's timezone. The server is the
 * source of truth (`/live` says whether the room is open); this mirrors it so the page
 * can decide before the first poll and while offline.
 */
export const DEFAULT_OPEN = '17:00';
export const DEFAULT_CLOSE = '03:00';
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isHHMM(value: string | null | undefined): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

export function minutesOf(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/** Minutes past midnight right now in a timezone (falls back to the browser's). */
export function localMinutes(now: Date, timeZone?: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return (get('hour') % 24) * 60 + get('minute');
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** True while inside service hours; a close at or before the open means it runs past midnight. */
export function isServiceTime(now: Date, open: string | null | undefined, close: string | null | undefined, timeZone?: string) {
  const start = minutesOf(isHHMM(open) ? open : DEFAULT_OPEN);
  const end = minutesOf(isHHMM(close) ? close : DEFAULT_CLOSE);
  const current = localMinutes(now, timeZone);
  if (end <= start) return current >= start || current < end;
  return current >= start && current < end;
}

/** "17:00" → "5:00 pm", for copy like "on until 3:00 am". */
export function formatHHMM(value: string | null | undefined, fallback = DEFAULT_OPEN) {
  const safe = isHHMM(value) ? value : fallback;
  const [hour, minute] = safe.split(':').map(Number);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}
