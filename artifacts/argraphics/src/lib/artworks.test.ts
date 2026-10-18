import { describe, expect, it } from "vitest";
import { earnings, formatCents } from "./artworks";

describe("formatCents", () => {
  it("shows free hosting and dollar amounts", () => {
    expect(formatCents(0)).toBe("Free to host");
    expect(formatCents(2500)).toBe("$25.00");
    expect(formatCents(123456)).toBe("$1,234.56");
  });
});

describe("earnings", () => {
  it("counts accepted and ended licences, split by paid and owed, and ignores the rest", () => {
    const paid = new Date().toISOString();
    expect(earnings([
      { status: "accepted", priceCents: 5000, paidAt: paid },
      { status: "accepted", priceCents: 2000, paidAt: null },
      { status: "ended", priceCents: 1500, paidAt: null },
      { status: "requested", priceCents: 9900, paidAt: null },
      { status: "declined", priceCents: 9900, paidAt: null },
    ])).toEqual({ paidCents: 5000, owedCents: 3500, totalCents: 8500, count: 3 });
  });
});
