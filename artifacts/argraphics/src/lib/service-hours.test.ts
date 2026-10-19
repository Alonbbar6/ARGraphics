import { describe, expect, it } from 'vitest';
import { formatHHMM, isHHMM, isServiceTime, localMinutes } from './service-hours';

describe('service hours', () => {
  it('validates HH:MM', () => {
    expect(isHHMM('17:00')).toBe(true);
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('5pm')).toBe(false);
    expect(isHHMM(null)).toBe(false);
  });

  it('knows when a bar that closes after midnight is open, in the venue timezone', () => {
    const tz = 'America/New_York';
    const at = (iso: string) => new Date(iso);
    // 20:00 New York on Oct 13 2026 (EDT) = 00:00 UTC Oct 14.
    expect(isServiceTime(at('2026-10-14T00:00:00Z'), null, null, tz)).toBe(true);
    // 02:30 local: still open.
    expect(isServiceTime(at('2026-10-14T06:30:00Z'), '17:00', '03:00', tz)).toBe(true);
    // 03:00 local: closed.
    expect(isServiceTime(at('2026-10-14T07:00:00Z'), '17:00', '03:00', tz)).toBe(false);
    // Noon local: closed for a bar, open for a lunch spot.
    expect(isServiceTime(at('2026-10-14T16:00:00Z'), '17:00', '03:00', tz)).toBe(false);
    expect(isServiceTime(at('2026-10-14T16:00:00Z'), '09:00', '15:00', tz)).toBe(true);
    expect(localMinutes(at('2026-10-14T16:00:00Z'), tz)).toBe(12 * 60);
  });

  it('formats times for copy', () => {
    expect(formatHHMM('17:00')).toBe('5:00 pm');
    expect(formatHHMM('03:30')).toBe('3:30 am');
    expect(formatHHMM('00:00')).toBe('12:00 am');
    expect(formatHHMM('nope', '03:00')).toBe('3:00 am');
  });
});
