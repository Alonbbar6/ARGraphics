/**
 * The floor plan the Home page draws: a 1000 x 600 plate with a bar counter, a wall
 * band, a window band, a table field and the entrance. Positions travel as 0..1 pairs
 * (what the API stores); the plate units are only for drawing.
 */
export const FLOOR = { w: 1000, h: 600 } as const;

export type FloorPlacement = 'table' | 'wall' | 'window' | 'poster';
export type Zone = { x: number; y: number; w: number; h: number; columns: number };
export type Point = { x: number; y: number };

export const ZONES: Record<FloorPlacement, Zone> = {
  wall: { x: 180, y: 40, w: 400, h: 72, columns: 5 },
  window: { x: 40, y: 170, w: 72, h: 350, columns: 1 },
  table: { x: 180, y: 170, w: 700, h: 350, columns: 4 },
  poster: { x: 740, y: 400, w: 200, h: 100, columns: 2 },
};

/** Decoration only: the counter guests lean on, and the door they come in by. */
export const BAR_COUNTER = { x: 620, y: 48, w: 320, h: 72 } as const;
export const ENTRANCE: Point = { x: 940, y: 575 };

const MARGIN = 0.03;

export type Placeable = {
  id: string;
  placement: FloorPlacement;
  createdAt: string;
  floorX: number | null;
  floorY: number | null;
};

/** Keep a marker inside the plate, with a little breathing room at the edges. */
export function clampPosition(point: Point): Point {
  const clamp = (value: number) => Math.min(1 - MARGIN, Math.max(MARGIN, value));
  return { x: clamp(point.x), y: clamp(point.y) };
}

export function toPlate(point: Point): Point {
  return { x: point.x * FLOOR.w, y: point.y * FLOOR.h };
}

export function fromPlate(point: Point): Point {
  return { x: point.x / FLOOR.w, y: point.y / FLOOR.h };
}

/**
 * Where each display sits: its saved spot, or a deterministic seat in the zone that
 * matches its placement, dealt in creation order so the room looks sensible before
 * anyone has dragged anything.
 */
export function defaultPositions<T extends Placeable>(displays: T[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const unplaced: Record<FloorPlacement, T[]> = { table: [], wall: [], window: [], poster: [] };
  const ordered = [...displays].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const display of ordered) {
    if (display.floorX !== null && display.floorY !== null) {
      positions.set(display.id, clampPosition({ x: display.floorX, y: display.floorY }));
    } else {
      (unplaced[display.placement] ?? unplaced.table).push(display);
    }
  }
  for (const placement of Object.keys(unplaced) as FloorPlacement[]) {
    const zone = ZONES[placement];
    const items = unplaced[placement];
    if (items.length === 0) continue;
    const columns = Math.min(zone.columns, items.length);
    const rows = Math.ceil(items.length / columns);
    items.forEach((display, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(display.id, clampPosition(fromPlate({
        x: zone.x + ((column + 0.5) * zone.w) / columns,
        y: zone.y + ((row + 0.5) * zone.h) / rows,
      })));
    });
  }
  return positions;
}

/** Marker radius in plate units: 26 on a desktop, growing so the touch target stays ~44px. */
export function markerRadius(containerWidthPx: number) {
  if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) return 26;
  return Math.max(26, Math.round((22 * FLOOR.w) / containerWidthPx));
}

/** How strongly a marker glows for its activity: quiet at 0, saturating at 20 scans. */
export function haloOpacity(scans: number) {
  return 0.035 + (Math.min(Math.max(scans, 0), 20) / 20) * 0.22;
}

/** Whether a pointer moved enough to count as a drag rather than a tap. */
export function isDrag(start: Point, end: Point, thresholdPx = 4) {
  return Math.hypot(end.x - start.x, end.y - start.y) >= thresholdPx;
}
