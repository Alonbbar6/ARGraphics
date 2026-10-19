/**
 * Reads enough of a binary glTF to judge whether a generated drink model is worth showing:
 * real geometry, a texture, and proportions that match the photo it came from. A model
 * that fails is marked failed instead of saved, so a customer never sees it.
 */

export type GlbSummary = {
  triangles: number;
  images: number;
  /** Axis-aligned extents of all positioned geometry, in model units. */
  extents: { x: number; y: number; z: number };
};

type GltfJson = {
  meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number>; indices?: number; mode?: number }> }>;
  accessors?: Array<{ count?: number; min?: number[]; max?: number[] }>;
  images?: unknown[];
};

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;

export function summarizeGlb(bytes: Buffer): GlbSummary {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== MAGIC || bytes.readUInt32LE(4) !== 2) {
    throw new Error("not a binary glTF 2.0 file");
  }
  const chunkLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== JSON_CHUNK || 20 + chunkLength > bytes.length) {
    throw new Error("glTF JSON chunk is missing or truncated");
  }
  const json = JSON.parse(bytes.subarray(20, 20 + chunkLength).toString("utf8")) as GltfJson;
  const accessors = json.accessors ?? [];

  let triangles = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      const position = primitive.attributes?.POSITION;
      const positions = position !== undefined ? accessors[position] : undefined;
      const count = primitive.indices !== undefined ? accessors[primitive.indices]?.count ?? 0 : positions?.count ?? 0;
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
      if (positions?.min && positions?.max) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], positions.min[axis] ?? Infinity);
          max[axis] = Math.max(max[axis], positions.max[axis] ?? -Infinity);
        }
      }
    }
  }
  const extent = (axis: number) => (Number.isFinite(min[axis]) && Number.isFinite(max[axis]) ? max[axis] - min[axis] : 0);
  return {
    triangles,
    images: (json.images ?? []).length,
    extents: { x: extent(0), y: extent(1), z: extent(2) },
  };
}

/** Fewer triangles than this is a placeholder, not a drink. */
export const MIN_TRIANGLES = 1000;

/**
 * Returns what is wrong with the model as a short phrase for a sentence like
 * "The 3D build <phrase>.", or null when it passes. `photoAspect` is the cutout's
 * height divided by its width, when known.
 */
export function judgeDrinkModel(summary: GlbSummary, photoAspect?: number): string | null {
  if (summary.triangles < MIN_TRIANGLES) return "came back with almost no detail";
  if (summary.images === 0) return "came back without a texture";
  const { x, y, z } = summary.extents;
  const footprint = Math.max(x, z);
  if (!(y > 0) || !(footprint > 0)) return "came back flat";
  if (photoAspect && photoAspect > 0) {
    // A model much taller than the cutout is a build gone wrong. A much flatter one is
    // usually fine: a plate or a pile of fries photographed from above shows its top
    // surface, so the cutout looks taller than the dish really is. Only a model that is
    // nearly a pancake next to its photo fails this way.
    const ratio = y / footprint / photoAspect;
    if (ratio < 0.2 || ratio > 2) return "does not match the photo's proportions";
  }
  return null;
}
