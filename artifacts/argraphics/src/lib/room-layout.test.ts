import { describe, expect, it } from 'vitest';
import { clampPosition, defaultPositions, fromPlate, haloOpacity, isDrag, markerRadius, toPlate, ZONES } from './room-layout';

const display = (id: string, placement: 'table' | 'wall' | 'window' | 'poster', createdAt: string, floorX: number | null = null, floorY: number | null = null) =>
  ({ id, placement, createdAt, floorX, floorY });

describe('room layout', () => {
  it('keeps saved spots and deals the rest into their placement zone', () => {
    const positions = defaultPositions([
      display('saved', 'table', '2026-01-01', 0.5, 0.5),
      display('t1', 'table', '2026-01-02'),
      display('w1', 'wall', '2026-01-03'),
    ]);
    expect(positions.get('saved')).toEqual({ x: 0.5, y: 0.5 });
    const t1 = toPlate(positions.get('t1')!);
    expect(t1.x).toBeGreaterThan(ZONES.table.x);
    expect(t1.x).toBeLessThan(ZONES.table.x + ZONES.table.w);
    expect(t1.y).toBeGreaterThan(ZONES.table.y);
    const w1 = toPlate(positions.get('w1')!);
    expect(w1.y).toBeLessThan(ZONES.wall.y + ZONES.wall.h);
  });

  it('is deterministic by creation order and wraps to a new row after the zone is full', () => {
    const many = Array.from({ length: 6 }, (_, index) => display(`t${index}`, 'table', `2026-01-0${index + 1}`));
    const first = defaultPositions(many);
    const again = defaultPositions([...many].reverse());
    many.forEach((item) => expect(again.get(item.id)).toEqual(first.get(item.id)));
    const row1 = toPlate(first.get('t0')!).y;
    const row2 = toPlate(first.get('t4')!).y;
    expect(row2).toBeGreaterThan(row1);
    expect(toPlate(first.get('t0')!).x).toBeLessThan(toPlate(first.get('t1')!).x);
  });

  it('clamps to the plate with a margin and converts both ways', () => {
    expect(clampPosition({ x: -1, y: 2 })).toEqual({ x: 0.03, y: 0.97 });
    expect(fromPlate(toPlate({ x: 0.25, y: 0.5 }))).toEqual({ x: 0.25, y: 0.5 });
  });

  it('grows the marker on narrow screens and scales the halo with activity', () => {
    expect(markerRadius(1000)).toBe(26);
    expect(markerRadius(390)).toBe(56);
    expect(markerRadius(0)).toBe(26);
    expect(haloOpacity(0)).toBeCloseTo(0.035);
    expect(haloOpacity(20)).toBeCloseTo(0.255);
    expect(haloOpacity(99)).toBeCloseTo(0.255);
  });

  it('separates a tap from a drag', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });
});
