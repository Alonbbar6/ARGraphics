import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assessPhotoQuality } from "../src/lib/photo-quality";

/** A drink-shaped block on a plain table, as a phone would shoot it. */
const photo = (background: string, subject: { r: number; g: number; b: number }) =>
  sharp({ create: { width: 640, height: 640, channels: 3, background } })
    .composite([{ input: { create: { width: 220, height: 300, channels: 4, background: { ...subject, alpha: 1 } } }, left: 210, top: 200 }]);

describe("photo quality checks", () => {
  it("passes a sharp, well-lit photo", async () => {
    expect(await assessPhotoQuality(await photo("white", { r: 190, g: 30, b: 40 }).png().toBuffer())).toEqual([]);
  });
  it("flags an out-of-focus photo", async () => {
    const rendered = await photo("white", { r: 190, g: 30, b: 40 }).png().toBuffer();
    const blurred = await sharp(rendered).blur(12).png().toBuffer();
    const issues = await assessPhotoQuality(blurred);
    expect(issues.map((i) => i.code)).toEqual(["blurry"]);
    expect(issues[0].message).toMatch(/focus/);
  });
  it("flags a photo taken in the dark", async () => {
    const dark = await photo("#0a0a0a", { r: 28, g: 8, b: 10 }).png().toBuffer();
    const issues = await assessPhotoQuality(dark);
    expect(issues.map((i) => i.code)).toContain("dark");
  });
  it("treats transparency as a white table, not darkness", async () => {
    const cutout = await sharp({ create: { width: 480, height: 480, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 120, height: 160, channels: 4, background: { r: 200, g: 40, b: 30, alpha: 1 } } }, left: 180, top: 160 }])
      .png().toBuffer();
    expect(await assessPhotoQuality(cutout)).toEqual([]);
  });
});
