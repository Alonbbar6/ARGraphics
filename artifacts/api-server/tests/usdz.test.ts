import { describe, expect, it } from "vitest";
import { readStoredZip, scaledUsdz, writeUsdz } from "../src/lib/usdz";

const usdc = Buffer.from("PXR-USDC fake binary layer with some bytes in it", "utf8");
const jpg = Buffer.alloc(1000, 7);

describe("USDZ at real size", () => {
  it("round-trips a stored zip", () => {
    const zip = writeUsdz([{ name: "model.usdc", data: usdc }, { name: "tex.jpg", data: jpg }]);
    expect(readStoredZip(zip).map((e) => [e.name, e.data.length])).toEqual([["model.usdc", usdc.length], ["tex.jpg", 1000]]);
    expect(readStoredZip(zip)[1].data.equals(jpg)).toBe(true);
  });

  it("aligns every file's data to 64 bytes and stores everything", () => {
    const zip = writeUsdz([{ name: "a.usdc", data: Buffer.alloc(13, 1) }, { name: "a-longer-texture-name.jpg", data: Buffer.alloc(77, 2) }, { name: "b.png", data: Buffer.alloc(5, 3) }]);
    // Walk the local headers and check each data offset.
    let offset = 0;
    for (let i = 0; i < 3; i++) {
      expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
      expect(zip.readUInt16LE(offset + 8)).toBe(0); // stored
      const size = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + nameLength + extraLength;
      expect(dataStart % 64).toBe(0);
      offset = dataStart + size;
    }
  });

  it("puts a root layer first that sublayers the original and sets metersPerUnit", () => {
    const original = writeUsdz([{ name: "model.abc.usdc", data: usdc }, { name: "tex.jpg", data: jpg }]);
    const scaled = scaledUsdz(original, 0.16 / 1.903);
    const entries = readStoredZip(scaled);
    expect(entries.map((e) => e.name)).toEqual(["argraphics.usda", "model.abc.usdc", "tex.jpg"]);
    const root = entries[0].data.toString("utf8");
    expect(root.startsWith("#usda 1.0")).toBe(true);
    expect(root).toContain("subLayers = [ @./model.abc.usdc@ ]");
    expect(root).toContain("metersPerUnit = 0.084077772");
    expect(entries[1].data.equals(usdc)).toBe(true);
  });

  it("can be scaled again without stacking root layers", () => {
    const original = writeUsdz([{ name: "model.usdc", data: usdc }]);
    const twice = scaledUsdz(scaledUsdz(original, 0.1), 0.2);
    const entries = readStoredZip(twice);
    expect(entries.map((e) => e.name)).toEqual(["argraphics.usda", "model.usdc"]);
    expect(entries[0].data.toString("utf8")).toContain("metersPerUnit = 0.2");
  });

  it("refuses compressed or non-zip input and bad scales", () => {
    expect(() => readStoredZip(Buffer.from("hello"))).toThrow(/zip/);
    expect(() => scaledUsdz(writeUsdz([{ name: "m.usdc", data: usdc }]), 0)).toThrow(/positive/);
    expect(() => scaledUsdz(writeUsdz([{ name: "only.jpg", data: jpg }]), 1)).toThrow(/layer/);
  });
});
