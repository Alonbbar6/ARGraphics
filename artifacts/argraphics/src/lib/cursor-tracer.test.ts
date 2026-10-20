import { describe, expect, it } from 'vitest';
import { HEAD_WIDTH, PALETTE, POINT_LIFE, agePoints, paletteAt, ribbonWidths, type TracerPoint } from './cursor-tracer';

const hue = (color: string) => Number(color.match(/hsl\(([\d.]+)/)![1]);

describe('paletteAt', () => {
  it('starts on the rose accent and wraps around', () => {
    expect(hue(paletteAt(0))).toBeCloseTo(PALETTE[0][0], 0);
    expect(paletteAt(1)).toBe(paletteAt(0));
    expect(paletteAt(-0.25)).toBe(paletteAt(0.75));
  });

  it('lands on each stop and takes the short way round the hue wheel between them', () => {
    PALETTE.forEach(([h], index) => {
      expect(hue(paletteAt(index / PALETTE.length))).toBeCloseTo(h, 0);
    });
    // Between violet (265) and rose (347) the hue climbs, never drops through 0.
    const middle = hue(paletteAt((PALETTE.length - 0.5) / PALETTE.length));
    expect(middle).toBeGreaterThan(265);
    expect(middle).toBeLessThan(347);
  });
});

describe('ribbonWidths', () => {
  it('grows from a thin tail to the full head width', () => {
    const widths = ribbonWidths(12);
    expect(widths).toHaveLength(12);
    expect(widths[0]).toBeLessThan(1);
    expect(widths[11]).toBe(HEAD_WIDTH);
    for (let index = 1; index < widths.length; index++) expect(widths[index]).toBeGreaterThanOrEqual(widths[index - 1]);
  });

  it('handles tiny ribbons', () => {
    expect(ribbonWidths(0)).toEqual([]);
    expect(ribbonWidths(1)).toEqual([HEAD_WIDTH]);
  });
});

describe('agePoints', () => {
  it('drops points older than their life and keeps the order', () => {
    const points: TracerPoint[] = [
      { x: 0, y: 0, at: 0, tone: 0 },
      { x: 1, y: 1, at: 500, tone: 0.1 },
      { x: 2, y: 2, at: 900, tone: 0.2 },
    ];
    expect(agePoints(points, 1000).map((point) => point.x)).toEqual([1, 2]);
    expect(agePoints(points, 1000 + POINT_LIFE)).toEqual([]);
  });
});
