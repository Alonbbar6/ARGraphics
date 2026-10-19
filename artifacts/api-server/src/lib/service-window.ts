import { localTimeOn } from "./traffic";

export const DEFAULT_SERVICE_OPEN = "17:00";
export const DEFAULT_SERVICE_CLOSE = "03:00";
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isServiceTimeString(value: string) {
  return HHMM.test(value);
}

function parse(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

export type ServiceWindow = { from: Date; to: Date };

/**
 * Tonight's service window (if we are inside one) and the most recent completed one.
 * Close at or before open means the window runs past midnight, the usual case for a bar.
 */
export function serviceWindows(now: Date, serviceOpen: string | null, serviceClose: string | null, timeZone: string) {
  const open = parse(serviceOpen && HHMM.test(serviceOpen) ? serviceOpen : DEFAULT_SERVICE_OPEN);
  const close = parse(serviceClose && HHMM.test(serviceClose) ? serviceClose : DEFAULT_SERVICE_CLOSE);
  const crossesMidnight = close.hour * 60 + close.minute <= open.hour * 60 + open.minute;
  const windowOpening = (daysAhead: number): ServiceWindow => {
    const from = localTimeOn(daysAhead, open.hour, open.minute, timeZone, now);
    const to = localTimeOn(daysAhead + (crossesMidnight ? 1 : 0), close.hour, close.minute, timeZone, now);
    return { from, to };
  };
  // The window that opened today, yesterday and the day before cover every case.
  const candidates = [windowOpening(0), windowOpening(-1), windowOpening(-2)];
  const current = candidates.find((window) => now >= window.from && now < window.to) ?? null;
  const completed = candidates.filter((window) => window.to <= now).sort((a, b) => b.to.getTime() - a.to.getTime());
  return {
    open: current !== null,
    tonight: current,
    lastNight: completed[0] ?? null,
    serviceOpen: `${String(open.hour).padStart(2, "0")}:${String(open.minute).padStart(2, "0")}`,
    serviceClose: `${String(close.hour).padStart(2, "0")}:${String(close.minute).padStart(2, "0")}`,
  };
}
