import { describe, expect, it } from 'vitest';
import {
  formatDelta, heatmapColor, heatmapSummary, hourLong, hourShort, inviteVenueMailto, isoToLocalInput,
  localInputToIso, previousLabel, share, shortDate, shortDay, topDisplay, upcomingEvents,
} from './traffic';

describe('formatDelta', () => {
  it('reports growth and decline as whole percents', () => {
    expect(formatDelta(123, 100)).toEqual({ direction: 'up', text: '23% up vs last week', percent: 23 });
    expect(formatDelta(50, 100, 'last month')).toEqual({ direction: 'down', text: '50% down vs last month', percent: -50 });
  });
  it('handles empty and new periods without dividing by zero', () => {
    expect(formatDelta(0, 0).text).toBe('Nothing yet');
    expect(formatDelta(5, 0)).toEqual({ direction: 'up', text: 'New since last week', percent: null });
    expect(formatDelta(7, 7).direction).toBe('flat');
    expect(formatDelta(1000, 999).direction).toBe('flat');
    expect(formatDelta(Number.NaN, 3).direction).toBe('down');
  });
  it('labels each range', () => {
    expect(previousLabel('season')).toBe('last season');
    expect(previousLabel('week')).toBe('last week');
  });
});

describe('heatmap', () => {
  it('runs Indigo → Violet → Coral and leaves empty hours neutral', () => {
    expect(heatmapColor(0, 10)).toBeNull();
    expect(heatmapColor(5, 0)).toBeNull();
    expect(heatmapColor(5, 10)).toBe('#6D28D9');
    expect(heatmapColor(10, 10)).toBe('#F43F5E');
    expect(heatmapColor(50, 10)).toBe('#F43F5E');
    expect(heatmapColor(0.0001, 10)).toBe('#2A1B5E');
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
