import { createHash, createHmac, randomInt } from "node:crypto";

export type TrafficRange = "week" | "month" | "season";

export const RANGE_DAYS: Record<TrafficRange, number> = { week: 7, month: 30, season: 90 };
export const DEFAULT_TIMEZONE = "America/New_York";
/** How long a claimed offer stays valid for staff to honour it. */
export const CLAIM_VALID_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(value: string | null | undefined): string {
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23", weekday: "short",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Calendar day (YYYY-MM-DD), Monday-first weekday index and hour in the partner's timezone. */
export function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hour: Number(parts.hour) % 24,
  };
}

export function rangeBounds(range: TrafficRange, now: Date) {
  const span = RANGE_DAYS[range] * DAY_MS;
  return { from: new Date(now.getTime() - span), to: now, previousFrom: new Date(now.getTime() - 2 * span) };
}

export type ScanRow = { createdAt: Date; visitorHash: string; displayId: string | null; qrCodeId: string | null };
export type RedemptionRow = { claimedAt: Date; displayId: string | null; qrCodeId: string | null };

export function totals(scans: ScanRow[], redemptions: RedemptionRow[], timeZone: string) {
  const daysByVisitor = new Map<string, Set<string>>();
  for (const scan of scans) {
    const days = daysByVisitor.get(scan.visitorHash) ?? new Set<string>();
    days.add(localParts(scan.createdAt, timeZone).day);
    daysByVisitor.set(scan.visitorHash, days);
  }
  let repeatVisitors = 0;
  for (const days of daysByVisitor.values()) if (days.size >= 2) repeatVisitors += 1;
  return {
    scans: scans.length,
    uniqueVisitors: daysByVisitor.size,
    repeatVisitors,
    redemptions: redemptions.length,
  };
}

/** One entry per local calendar day touched by [from, to], oldest first. */
export function dailySeries(scans: ScanRow[], redemptions: RedemptionRow[], from: Date, to: Date, timeZone: string) {
  const days = new Map<string, { date: string; scans: number; redemptions: number }>();
  for (let time = from.getTime(); time <= to.getTime(); time += DAY_MS) {
    const day = localParts(new Date(time), timeZone).day;
    if (!days.has(day)) days.set(day, { date: day, scans: 0, redemptions: 0 });
  }
  const lastDay = localParts(to, timeZone).day;
  if (!days.has(lastDay)) days.set(lastDay, { date: lastDay, scans: 0, redemptions: 0 });
  for (const scan of scans) {
    const entry = days.get(localParts(scan.createdAt, timeZone).day);
    if (entry) entry.scans += 1;
  }
  for (const redemption of redemptions) {
    const entry = days.get(localParts(redemption.claimedAt, timeZone).day);
    if (entry) entry.redemptions += 1;
  }
  return [...days.values()];
}

/** Seven Monday-first rows of 24 hourly scan counts. */
export function heatmap(scans: ScanRow[], timeZone: string) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const scan of scans) {
    const { weekday, hour } = localParts(scan.createdAt, timeZone);
    if (weekday >= 0) grid[weekday][hour] += 1;
  }
  return grid;
}

export function countBy<T>(rows: T[], key: (row: T) => string | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Keyed hash so stored rows never hold the app's raw install ID. */
export function visitorHash(visitorId: string): string {
  const secret = process.env.SESSION_SECRET;
  return secret
    ? createHmac("sha256", secret).update(`visitor:${visitorId}`).digest("hex")
    : createHash("sha256").update(`visitor:${visitorId}`).digest("hex");
}

// No 0/O, 1/I/L: codes are read aloud and typed from print.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function newQrCode(length = 8): string {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** Short code staff can read off the guest's screen, e.g. BX-4821. */
export function newConfirmationCode(): string {
  const letters = LETTERS[randomInt(LETTERS.length)] + LETTERS[randomInt(LETTERS.length)];
  return `${letters}-${String(randomInt(10_000)).padStart(4, "0")}`;
}

/** Great-circle distance in meters. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function priceLabel(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
