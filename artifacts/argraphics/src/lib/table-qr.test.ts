import { describe, expect, it } from "vitest";
import { createQrPrintPdf, fileSafe, numberedLabels, parseLabelList, qrSvg, scanUrl } from "./table-qr";

describe("scan links", () => {
  it("joins the public origin and the server's scan path", () => {
    expect(scanUrl("https://argraphics.app", "/s/k7m2x9qp")).toBe("https://argraphics.app/s/k7m2x9qp");
    expect(scanUrl("http://localhost:5173/", "/s/abc123")).toBe("http://localhost:5173/s/abc123");
  });

  it.each([
    ["argraphics.app", "/s/k7m2x9qp"],
    ["https://argraphics.app/app", "/s/k7m2x9qp"],
    ["https://argraphics.app", "/menu/bar"],
    ["https://argraphics.app", "/s/AB"],
    ["https://argraphics.app", "https://evil.example/s/k7m2x9qp"],
  ])("rejects %j + %j", (origin, path) => {
    expect(() => scanUrl(origin, path)).toThrow();
  });
});

describe("spot labels", () => {
  it("numbers a range of tables, capped at 60", () => {
    expect(numberedLabels("Table", 1, 3)).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(numberedLabels("", 5, 6)).toEqual(["5", "6"]);
    expect(numberedLabels("Table", 1, 500)).toHaveLength(60);
    expect(numberedLabels("Table", 4, 2)).toEqual(["Table 4"]);
    expect(numberedLabels("Bar", Number.NaN, Number.NaN)).toEqual(["Bar 1"]);
  });

  it("parses custom labels, one per line or comma", () => {
    expect(parseLabelList("Front window\n Patio 2 , patio 2,\n\nHost stand")).toEqual(["Front window", "Patio 2", "Host stand"]);
    expect(parseLabelList("x".repeat(80))[0]).toHaveLength(40);
    expect(parseLabelList(Array.from({ length: 70 }, (_, i) => `S${i}`).join(","))).toHaveLength(60);
  });
});

describe("rendering", () => {
  it("renders a scannable SVG", async () => {
    const svg = await qrSvg(scanUrl("https://argraphics.app", "/s/k7m2x9qp"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
  });

  const codes = (count: number) => Array.from({ length: count }, (_, i) => ({ label: `Table ${i + 1}`, url: `https://argraphics.app/s/code${String(i).padStart(4, "0")}` }));

  it("puts two table tents on each Letter page", async () => {
    const pdf = await createQrPrintPdf("tent", "Casa Marisol", codes(3));
    expect(pdf.getNumberOfPages()).toBe(2);
    expect(Math.round(pdf.internal.pageSize.getWidth())).toBe(216);
  });

  it("prints one 5 × 5 in sticker per page", async () => {
    const pdf = await createQrPrintPdf("sticker", "Casa Marisol", codes(2));
    expect(pdf.getNumberOfPages()).toBe(2);
    expect(Math.round(pdf.internal.pageSize.getWidth())).toBe(127);
  });

  it("prints one 11 × 17 in poster per page", async () => {
    const pdf = await createQrPrintPdf("poster", "Casa Marisol", [{ ...codes(1)[0], displayTitle: "Tuesday Birria Tower" }]);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(Math.round(pdf.internal.pageSize.getHeight())).toBe(432);
  });

  it("refuses an empty batch", async () => {
    await expect(createQrPrintPdf("tent", "Casa Marisol", [])).rejects.toThrow("at least one");
  });

  it("makes safe file names", () => {
    expect(fileSafe("Casa Marisol — Table 6")).toBe("casa-marisol-table-6");
    expect(fileSafe("!!!")).toBe("argraphics");
  });
});
