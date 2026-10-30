import { describe, expect, it } from 'vitest';
import { decodePickId, encodePickId, insideLoop, loopBounds, pickedIds, type Point } from './lasso';

const square: Point[] = [[2, 2], [8, 2], [8, 8], [2, 8]];

describe('touch-up lasso', () => {
  it('tells inside from outside', () => {
    expect(insideLoop(5, 5, square)).toBe(true);
    expect(insideLoop(1, 5, square)).toBe(false);
    expect(insideLoop(9, 9, square)).toBe(false);
  });
  it('bounds a loop within the view', () => {
    expect(loopBounds([[-3, 1.2], [4.5, 20]], 10, 10)).toEqual({ x0: 0, y0: 1, x1: 5, y1: 9 });
  });
  it('round-trips triangle ids through colours, keeping 0 for the background', () => {
    for (const id of [0, 1, 255, 256, 70000, 16_000_000]) {
      const [r, g, b] = encodePickId(id).map((v) => Math.round(v * 255));
      expect(decodePickId(r, g, b)).toBe(id);
    }
    expect(decodePickId(0, 0, 0)).toBe(-1);
  });
  it('collects the ids painted inside the loop only', () => {
    const bounds = { x0: 2, y0: 2, x1: 8, y1: 8 };
    const width = 7;
    const pixels = new Uint8Array(width * 7 * 4);
    const paint = (x: number, y: number, id: number) => {
      const [r, g, b] = encodePickId(id).map((v) => Math.round(v * 255));
      pixels.set([r, g, b, 255], ((y - 2) * width + (x - 2)) * 4);
    };
    paint(4, 4, 7);
    paint(5, 5, 7);
    paint(6, 3, 12);
    paint(8, 8, 99); // the far corner pixel's centre lies outside the loop
    expect([...pickedIds(pixels, bounds, square)].sort()).toEqual([12, 7]);
  });
});
