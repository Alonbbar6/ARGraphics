import { describe, expect, it } from "vitest";
import { createTableCardPdf } from "./table-card-pdf";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

describe("table-card print PDF", () => {
  it.each([
    [10, 1200, 1800], // portrait
    [12.5, 1800, 1200], // landscape and fractional cm
    [8, 1000, 1000], // square
    [0.1, 600, 1200], // small width
    [100, 3000, 1500], // maximum supported width
  ])("uses %s cm width and preserves %s × %s artwork ratio", (cm, pxWidth, pxHeight) => {
    const pdf = createTableCardPdf(png, cm, pxWidth, pxHeight);
    const widthMm = cm * 10;
    const heightMm = widthMm * pxHeight / pxWidth;
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(widthMm, 6);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(heightMm, 6);

    // Inspect the serialized PDF, not only the input configuration.
    const output = pdf.output();
    const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(output);
    expect(mediaBox).not.toBeNull();
    const pointsToMm = 25.4 / 72;
    expect(Number(mediaBox![1]) * pointsToMm).toBeCloseTo(widthMm, 6);
    expect(Number(mediaBox![2]) * pointsToMm).toBeCloseTo(heightMm, 6);
    expect(Number(mediaBox![2]) / Number(mediaBox![1])).toBeCloseTo(pxHeight / pxWidth, 6);
    expect(output).toContain("/Subtype /Image");
  });

  it.each([
    [0, 100, 100], [-1, 100, 100], [101, 100, 100],
    [NaN, 100, 100], [Infinity, 100, 100],
    [10, 0, 100], [10, 100, 0], [10, -100, 100],
  ])("rejects invalid dimensions %s / %s / %s", (cm, width, height) => {
    expect(() => createTableCardPdf(png, cm, width, height)).toThrow("must be valid");
  });
});
