import { describe, expect, it } from 'vitest';
import { SHELF_CONFIG } from './shelf-config';
import { layoutItem, leanFor, liveRange, loadOrder, REST_FAN, staggered } from './shelf-layout';

describe('layoutItem', () => {
  it('puts the active item front and centre at full scale', () => {
    const pose = layoutItem(0, 0, REST_FAN, SHELF_CONFIG);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.z).toBeCloseTo(0);
    expect(pose.y).toBeCloseTo(SHELF_CONFIG.activeLift);
    expect(pose.scale).toBe(1);
    expect(pose.visible).toBe(true);
  });

  it('fans neighbours out to the sides, back and smaller', () => {
    const right = layoutItem(1, 0, REST_FAN, SHELF_CONFIG);
    const left = layoutItem(-1, 0, REST_FAN, SHELF_CONFIG);
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeCloseTo(-right.x);
    expect(right.z).toBeLessThan(0);
    expect(right.scale).toBeLessThan(1);
    expect(right.scale).toBeGreaterThanOrEqual(SHELF_CONFIG.inactiveScale);
    expect(right.rotY).toBeCloseTo(-SHELF_CONFIG.anglePerItem);
  });

  it('never shrinks below the inactive floor however far out', () => {
    const far = layoutItem(6, 0, REST_FAN, SHELF_CONFIG);
    expect(far.scale).toBeCloseTo(SHELF_CONFIG.inactiveScale);
  });

  it('leans with velocity and clamps the lean', () => {
    expect(leanFor(0, SHELF_CONFIG)).toBe(0);
    expect(leanFor(4, SHELF_CONFIG)).toBeGreaterThan(0);
    expect(leanFor(-4, SHELF_CONFIG)).toBeLessThan(0);
    expect(leanFor(1e6, SHELF_CONFIG)).toBe(SHELF_CONFIG.flowLeanMax);
    const still = layoutItem(1, 0, REST_FAN, SHELF_CONFIG);
    const moving = layoutItem(1, 4, REST_FAN, SHELF_CONFIG);
    expect(moving.rotY).toBeGreaterThan(still.rotY);
    expect(moving.rotZ).toBeLessThan(0);
    expect(moving.y).toBeLessThan(still.y);
  });

  it('hides and recedes neighbours at the start of the intro, shows them at the end', () => {
    const start = layoutItem(1, 0, { others: 0, active: 1, inbound: true }, SHELF_CONFIG);
    const end = layoutItem(1, 0, { others: 1, active: 1, inbound: true }, SHELF_CONFIG);
    expect(start.visible).toBe(false);
    expect(end.visible).toBe(true);
    expect(start.z).toBeLessThan(end.z);
    expect(end.scale).toBeCloseTo(layoutItem(1, 0, REST_FAN, SHELF_CONFIG).scale, 3);
  });

  it('boosts the active item and drops the others during flight', () => {
    const fan = { others: 0, active: SHELF_CONFIG.flightBoost, inbound: false };
    expect(layoutItem(0, 0, fan, SHELF_CONFIG).scale).toBeCloseTo(SHELF_CONFIG.flightBoost);
    expect(layoutItem(1, 0, fan, SHELF_CONFIG).visible).toBe(false);
  });
});

describe('staggered', () => {
  it('starts later for items further out and still reaches 1', () => {
    expect(staggered(0.2, 0, 0.45, 4)).toBeGreaterThan(staggered(0.2, 4, 0.45, 4));
    expect(staggered(1, 4, 0.45, 4)).toBe(1);
    expect(staggered(0, 0, 0.45, 4)).toBe(0);
  });
});

describe('liveRange and loadOrder', () => {
  it('keeps radius + 1 slots on each side within bounds', () => {
    expect(liveRange(0, 6, 2)).toEqual({ from: 0, to: 3 });
    expect(liveRange(5, 6, 2)).toEqual({ from: 2, to: 5 });
    expect(liveRange(2.4, 6, 2)).toEqual({ from: 0, to: 5 });
    expect(liveRange(0, 0, 2)).toEqual({ from: 0, to: -1 });
  });

  it('loads the target first, then neighbours outward', () => {
    expect(loadOrder(2, 6, 2)).toEqual([2, 1, 3, 0, 4]);
    expect(loadOrder(0, 6, 2)).toEqual([0, 1, 2]);
  });
});
