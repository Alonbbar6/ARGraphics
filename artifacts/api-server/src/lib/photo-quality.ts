import sharp from "sharp";

/**
 * Free, local checks on a drink photo before any cutout or paid 3D build. They catch the
 * two failures that cannot be fixed later: a soft, out-of-focus photo and a photo taken in
 * the dark. Thresholds are deliberately lenient; the goal is to stop the clear misses,
 * not to argue with a decent phone photo.
 */

export type PhotoIssue = {
  code: "blurry" | "dark";
  message: string;
};

/** Mean of the strongest 0.25% of edge gradients (0–510 scale) below this reads as soft focus. */
export const MIN_EDGE_CONTRAST = 32;
/** Mean luminance (0–255) below this, with almost no bright pixels, reads as underexposed. */
export const MIN_MEAN_LUMINANCE = 35;

export async function assessPhotoQuality(png: Buffer): Promise<PhotoIssue[]> {
  const { data, info } = await sharp(png)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const total = width * height;
  if (!total) return [];

  // Exposure.
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < total; i++) {
    const v = data[i];
    sum += v;
    if (v > 200) bright++;
  }
  const mean = sum / total;

  // Edge contrast: a sharp photo has at least a few hard edges, a blurred one has none.
  // Only the strongest quarter-percent counts, so a plain scene with one crisp subject passes.
  const histogram = new Uint32Array(511);
  let edges = 0;
  for (let y = 0; y < height - 1; y++) {
    const row = y * width;
    for (let x = 0; x < width - 1; x++) {
      const i = row + x;
      const magnitude = Math.abs(data[i + 1] - data[i]) + Math.abs(data[i + width] - data[i]);
      histogram[magnitude]++;
      edges++;
    }
  }
  const top = Math.max(1, Math.floor(edges * 0.0025));
  let counted = 0;
  let weighted = 0;
  for (let m = 510; m >= 0 && counted < top; m--) {
    const take = Math.min(histogram[m], top - counted);
    weighted += take * m;
    counted += take;
  }
  const edgeContrast = counted ? weighted / counted : 0;

  const issues: PhotoIssue[] = [];
  if (edgeContrast < MIN_EDGE_CONTRAST) {
    issues.push({
      code: "blurry",
      message: "This photo looks out of focus. Hold the phone still, tap the drink to focus, and take it again.",
    });
  }
  if (mean < MIN_MEAN_LUMINANCE && bright / total < 0.01) {
    issues.push({
      code: "dark",
      message: "This photo is too dark to build from. Move the drink under a light or turn on the flash, then take it again.",
    });
  }
  return issues;
}
