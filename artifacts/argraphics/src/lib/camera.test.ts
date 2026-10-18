import { describe, expect, it } from "vitest";
import { cameraProblem, captureFileName, fitWithin, MAX_CAPTURE_SIDE } from "./camera";

describe("fitWithin", () => {
  it("leaves small frames alone", () => {
    expect(fitWithin(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("scales the longest side down to the cap and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_CAPTURE_SIDE, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: MAX_CAPTURE_SIDE });
    expect(fitWithin(5000, 5000, 1000)).toEqual({ width: 1000, height: 1000 });
  });
});

describe("captureFileName", () => {
  it("makes a readable, filesystem-safe JPEG name from the dish and the moment", () => {
    const at = new Date("2026-10-18T19:04:05.123Z");
    expect(captureFileName("Tuesday Birria Tower", at)).toBe("tuesday-birria-tower-20261018-190405.jpg");
    expect(captureFileName("Crème brûlée / #2", at)).toBe("creme-brulee-2-20261018-190405.jpg");
    expect(captureFileName("   ", at)).toBe("dish-20261018-190405.jpg");
  });

  it("keeps long names short enough for storage", () => {
    const name = captureFileName("x".repeat(200));
    expect(name.length).toBeLessThan(70);
  });
});

describe("cameraProblem", () => {
  it("explains permission, missing and busy cameras", () => {
    expect(cameraProblem({ name: "NotAllowedError" })).toMatch(/blocked/i);
    expect(cameraProblem({ name: "NotFoundError" })).toMatch(/no camera/i);
    expect(cameraProblem({ name: "NotReadableError" })).toMatch(/another app/i);
    expect(cameraProblem(new Error("boom"))).toMatch(/could not start/i);
  });
});
