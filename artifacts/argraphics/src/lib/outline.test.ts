import { describe, expect, it } from 'vitest';
import { encodeOutline, encodeParts, MAX_SENT_POINTS, outlineArea, outlineUsable, thinOutline, type OutlinePoint } from './outline';

const square: OutlinePoint[] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];

describe('traced outline', () => {
  it('measures the enclosed area whichever way it was drawn', () => {
    expect(outlineArea(square)).toBeCloseTo(0.36);
    expect(outlineArea([...square].reverse())).toBeCloseTo(0.36);
  });
  it('refuses a scribble or a tap', () => {
    expect(outlineUsable(square)).toBe(true);
    expect(outlineUsable(square.slice(0, 2))).toBe(false);
    expect(outlineUsable([[0.5, 0.5], [0.51, 0.5], [0.5, 0.51]])).toBe(false);
  });
  it('thins a long trace evenly and leaves a short one alone', () => {
    const long = Array.from({ length: 1000 }, (_, i): OutlinePoint => [Math.cos(i / 159), Math.sin(i / 159)]);
    expect(thinOutline(long)).toHaveLength(MAX_SENT_POINTS);
    expect(thinOutline(long)[0]).toBe(long[0]);
    expect(thinOutline(square)).toBe(square);
  });
  it('encodes compactly, keeping points on the photo', () => {
    expect(encodeOutline([[0.123456, 0.5], [1.2, -0.1], [0.5, 0.25]])).toBe('0.1235,0.5;1,0;0.5,0.25');
  });
  it('encodes the traced parts as JSON and drops loops that are not usable', () => {
    expect(encodeParts({})).toBeUndefined();
    expect(encodeParts({ liquid: square.slice(0, 2), garnish: [[[0.5, 0.5], [0.51, 0.5], [0.5, 0.51]]] })).toBeUndefined();
    expect(JSON.parse(encodeParts({ liquid: square, garnish: [square, square.slice(0, 2)] })!)).toEqual({ liquid: square, garnish: [square] });
    expect(JSON.parse(encodeParts({ garnish: Array.from({ length: 8 }, () => square) })!).garnish).toHaveLength(6);
  });
});
