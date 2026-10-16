import { describe, expect, it } from 'vitest';
import {
  countLabel, dayKey, formatDelta, heatmapColor, heatmapSummary, hourLong, hourShort, inviteVenueMailto, isoToLocalInput,
  localInputToIso, plural, previousLabel, share, shortDate, shortDay, topDisplay, upcomingEvents,
} from './traffic';

describe('formatDelta', () => {
  it('reports growth and decline as whole percents', () => {
    expect(formatDelta(123, 100)).toEqual({ direction: 'up', text: '23% up vs last week', percent: 23 });
    expect(formatDelta(50, 100, 'last month')).toEqual({ direction: 'down', text: '50% down vs last month', percent: -50 });
  });
  it('shows nothing when last week had no data', () => {
    expect(formatDelta(0, 0)).toBeNull();
    expect(formatDelta(5, 0)).toBeNull();
    expect(formatDelta(5, 0, 'last week', false)).toBeNull();
    expect(formatDelta(5, 3, 'last week', false)).toBeNull();
  });
  it('handles metrics that are new in a period that had data, without dividing by zero', () => {
    expect(formatDelta(5, 0, 'last week', true)).toEqual({ direction: 'up', text: 'New since last week', percent: null });
    expect(formatDelta(0, 0, 'last week', true)).toBeNull();
    expect(formatDelta(7, 7)?.direction).toBe('flat');
    expect(formatDelta(1000, 999)?.direction).toBe('flat');
    expect(formatDelta(Number.NaN, 3)?.direction).toBe('down');
  });
  it('labels each range', () => {
    expect(previousLabel('season')).toBe('last season');
    expect(previousLabel('week')).toBe('last week');
  });
});

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(countLabel(1, 'scan')).toBe('1 scan');
    expect(countLabel(0, 'scan')).toBe('0 scans');
    expect(countLabel(1200, 'walk-in')).toBe('1,200 walk-ins');
    expect(plural(1, 'person', 'people')).toBe('person');
    expect(plural(3, 'person', 'people')).toBe('people');
  });
});

describe('dayKey', () => {
  it('reads the calendar day in the venue timezone', () => {
    const lateNightUtc = new Date('2026-10-17T02:30:00Z');
    expect(dayKey(lateNightUtc, 'America/New_York')).toBe('2026-10-16');
    expect(dayKey(lateNightUtc, 'UTC')).toBe('2026-10-17');
  });
});

describe('heatmap', () => {
  it('ramps the foreground from faint to solid and leaves empty hours neutral', () => {
    expect(heatmapColor(0, 10)).toBeNull();
    expect(heatmapColor(5, 0)).toBeNull();
    expect(heatmapColor(5, 10)).toBe('hsl(var(--foreground) / 0.53)');
    expect(heatmapColor(10, 10)).toBe('hsl(var(--foreground) / 0.90)');
    expect(heatmapColor(50, 10)).toBe('hsl(var(--foreground) / 0.90)');
    expect(heatmapColor(0.0001, 10)).toBe('hsl(var(--foreground) / 0.15)');
  });
  it('finds the peak hour and the quiet day', () => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(1));
    grid[4][21] = 40;
    grid[2] = Array(24).fill(0);
    const summary = heatmapSummary(grid);
    expect(summary.peak).toEqual({ day: 4, hour: 21, scans: 40 });
    expect(summary.max).toBe(40);
    expect(summary.quietDay).toBe(2);
    expect(heatmapSummary(Array.from({ length: 7 }, () => Array(24).fill(0)))).toMatchObject({ peak: null, quietDay: null, total: 0 });
  });
  it('labels hours', () => {
    expect([0, 9, 12, 21].map(hourShort)).toEqual(['12a', '9a', '12p', '9p']);
    expect(hourLong(0)).toBe('12 AM');
    expect(hourLong(17)).toBe('5 PM');
  });
});

describe('dates', () => {
  it('reads calendar days without timezone drift', () => {
    expect(shortDay('2026-10-14')).toBe('Wed');
    expect(shortDate('2026-10-14')).toBe('Oct 14');
    expect(shortDay('nope')).toBe('nope');
  });
  it('round-trips datetime-local values', () => {
    const iso = localInputToIso('2026-10-20T21:30');
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe('2026-10-20T21:30');
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('display summaries', () => {
  const base = { type: 'menu_item', status: 'live', eventStartsAt: null, scansThisWeek: 0, redemptionsThisWeek: 0 };
  it('picks the display with the most walk-ins', () => {
    const a = { ...base, id: 'a', scansThisWeek: 300, redemptionsThisWeek: 10 };
    const b = { ...base, id: 'b', scansThisWeek: 100, redemptionsThisWeek: 30 };
    expect(topDisplay([a, b])?.id).toBe('b');
    expect(topDisplay([base])).toBeNull();
  });
  it('lists upcoming events soonest first', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const later = { ...base, id: 'later', type: 'event_teaser', eventStartsAt: '2026-10-30T20:00:00Z' };
    const soon = { ...base, id: 'soon', type: 'event_teaser', eventStartsAt: '2026-10-16T20:00:00Z' };
    const past = { ...base, id: 'past', type: 'event_teaser', eventStartsAt: '2026-10-01T20:00:00Z' };
    const paused = { ...soon, id: 'paused', status: 'paused' };
    expect(upcomingEvents([later, past, soon, paused, base], now).map((d) => d.id)).toEqual(['soon', 'later']);
  });
  it('computes shares safely', () => {
    expect(share(1, 4)).toBe(25);
    expect(share(1, 0)).toBe(0);
  });
});

describe('inviteVenueMailto', () => {
  it('carries the referral link', () => {
    const href = inviteVenueMailto('Ana Ruiz', 'ana-ruiz', 'https://argraphics.app/');
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('https://argraphics.app/register?ref=ana-ruiz');
    expect(decodeURIComponent(href)).toContain('ARGraphics');
  });
});
