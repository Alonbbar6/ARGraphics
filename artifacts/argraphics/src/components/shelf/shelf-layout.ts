/**
 * Pure layout math for the shelf. No three.js here so it can be unit tested in node.
 *
 * The idea is borrowed from the A24 disc gallery: a single fractional "active index"
 * drives everything. Each item's offset from that index (negative = left, positive = right)
 * puts it on a fan around the camera, and the velocity of the index leans the whole fan.
 */
import type { ShelfConfig } from './shelf-config';

export type Pose = {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
  visible: boolean;
};

/** Group-level animation state shared by every item. */
export type FanState = {
  /** 0..1 scale of the non-active items (intro and flight animate this). */
  others: number;
  /** Scale multiplier of the active item (1 at rest, flightBoost while leaving). */
  active: number;
  /** True while items are arriving (intro) rather than leaving (flight). */
  inbound: boolean;
};

export const REST_FAN: FanState = { others: 1, active: 1, inbound: false };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Lean of the fan for a given index velocity: sign-preserving square root, clamped. */
export function leanFor(velocity: number, cfg: ShelfConfig) {
  return clamp(Math.sign(velocity) * Math.sqrt(Math.abs(velocity)) * cfg.flowLean, -cfg.flowLeanMax, cfg.flowLeanMax);
}

function easeOutBack(t: number) {
  const c = 1.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/**
 * Stagger a 0..1 group progress per item: items further from the active one start later,
 * so a fan "arrives" or "leaves" from the centre outwards.
 */
export function staggered(progress: number, distance: number, stagger: number, maxDistance: number) {
  const s = clamp(stagger, 0, 0.9);
  const d = Math.min(distance, maxDistance) / maxDistance;
  const start = d * s;
  const span = Math.max(0.1, 1 - s);
  return clamp((progress - start) / span, 0, 1);
}

export function layoutItem(offset: number, velocity: number, fan: FanState, cfg: ShelfConfig): Pose {
  const active = Math.abs(offset) < 0.5;
  const distance = Math.abs(offset);
  const angle = offset * cfg.anglePerItem;
  const lean = leanFor(velocity, cfg);
  const dip = Math.min(cfg.flowDipMax, Math.abs(velocity) * cfg.flowDip);

  let x = Math.sin(angle) * cfg.hGap * 2.4;
  let y = (active ? cfg.activeLift : 0) - dip * (active ? 0.7 : 1);
  let z = -cfg.depthGap * 2.4 * (1 - Math.cos(angle)) - distance * cfg.depthPerItem;

  const rotX = 0;
  const rotY = -angle + lean * (active ? 1 : 1.12);
  const rotZ = -lean * cfg.flowBank * (active ? 0.7 : 1);

  // Items shrink with distance from the front, never below the inactive floor.
  const base = active ? 1 : Math.max(cfg.inactiveScale, 1 - distance * (1 - cfg.inactiveScale) * cfg.scaleFalloff);

  let scale: number;
  let visible = true;
  if (active) {
    scale = base * fan.active;
  } else {
    const stagger = fan.inbound ? cfg.introStagger : cfg.flightStagger;
    const maxDistance = Math.max(1, fan.inbound ? cfg.introStaggerMax : cfg.flightStaggerMax);
    const p = staggered(Math.min(1, fan.others), distance, stagger, maxDistance);
    const s = (fan.inbound ? easeOutBack(p) : p * (2 - p)) + Math.max(0, fan.others - 1);
    visible = s > (fan.inbound ? cfg.introPopScale : cfg.flightPopScale);
    scale = base * s;
    const gone = 1 - Math.min(1, s);
    if (gone > 1e-4) z -= gone * (fan.inbound ? cfg.introRecede : cfg.flightRecede);
  }

  if (!Number.isFinite(scale) || scale <= 0.001) visible = false;
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  z = Number.isFinite(z) ? z : 0;

  return { x, y, z, rotX, rotY, rotZ, scale: Math.max(0, scale), visible };
}

/** Which indices should have a live slot for a fractional active index. */
export function liveRange(active: number, count: number, radius: number) {
  if (count <= 0) return { from: 0, to: -1 };
  const reach = radius + 1;
  return {
    from: Math.max(0, Math.ceil(active - reach)),
    to: Math.min(count - 1, Math.floor(active + reach)),
  };
}

/** Load order for a target index: the target first, then neighbours alternating outward. */
export function loadOrder(target: number, count: number, radius: number) {
  const out: number[] = [];
  for (let d = 0; d <= radius; d += 1) {
    const left = target - d;
    const right = target + d;
    if (left >= 0 && left < count) out.push(left);
    if (d && right >= 0 && right < count) out.push(right);
  }
  return out;
}
