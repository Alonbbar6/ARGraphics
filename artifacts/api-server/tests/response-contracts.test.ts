import { describe, expect, it } from "vitest";
import { checkResponseContract, expectResponseContract } from "./support/response-contracts";

const drink = {
  id: "drink", name: "Drink", description: "", price: "$12.50", priceCents: 1250,
  category: "signature", thumbnailUrl: null, modelUsdzUrl: null, modelGlbUrl: null,
  updatedAt: "2026-10-14T12:00:00.000Z",
};
const menu = { barName: "Fixture Bar", logoUrl: null, drinks: [drink] };
const publicCard = {
  id: "card", name: "Table", referenceImageUrl: "https://storage.example.test/signed-download",
  physicalWidthCm: 12.5,
};
const ownerCard = {
  ...publicCard, referenceImageUrl: "/api/storage/objects/uploads/fixture",
  isActive: true, createdAt: "2026-10-14T12:00:00.000Z",
};

// Prove these assertions catch wire regressions, including nullable-but-required
// fields and formats that the generated validators alone may coerce or ignore.
describe("response contract assertion sensitivity", () => {
  it("accepts representative documented JSON in both contract sources", () => {
    expectResponseContract("getPublicMenu", 200, menu);
    expectResponseContract("getPublicTableCards", 200, [publicCard]);
    expectResponseContract("createTableCard", 201, ownerCard);
    expectResponseContract("getPublicMenuVersion", 200, { version: 1 });
  });

  it("rejects every missing required menu, drink, and table-card field", () => {
    for (const field of Object.keys(menu)) {
      const body: Record<string, unknown> = { ...menu };
      delete body[field];
      expect(checkResponseContract("getPublicMenu", 200, body).conforms, field).toBe(false);
    }
    for (const field of Object.keys(drink)) {
      const body: Record<string, unknown> = { ...drink };
      delete body[field];
      expect(checkResponseContract("getPublicMenu", 200, { ...menu, drinks: [body] }).conforms, field).toBe(false);
    }
    for (const [operation, status, card] of [
      ["getPublicTableCards", 200, publicCard],
      ["createTableCard", 201, ownerCard],
    ] as const) {
      for (const field of Object.keys(card)) {
        const body: Record<string, unknown> = { ...card };
        delete body[field];
        expect(checkResponseContract(operation, status, operation === "getPublicTableCards" ? [body] : body)
          .conforms, `${operation}.${field}`).toBe(false);
      }
    }
  });

  it.each([
    { priceCents: "1250" }, { priceCents: 12.5 }, { price: 12.5 },
    { category: null }, { thumbnailUrl: 42 }, { updatedAt: 0 }, { updatedAt: "not-a-date" },
  ])("rejects wrongly typed or formatted nested drink values %j", (change) => {
    expect(checkResponseContract("getPublicMenu", 200, { ...menu, drinks: [{ ...drink, ...change }] })
      .conforms).toBe(false);
  });

  it.each([
    { physicalWidthCm: "12.5" }, { referenceImageUrl: "/relative-download" }, { name: null },
  ])("rejects public card wire regressions %j", (change) => {
    expect(checkResponseContract("getPublicTableCards", 200, [{ ...publicCard, ...change }]).conforms).toBe(false);
  });

  it.each([
    { isActive: "true" }, { createdAt: 0 }, { createdAt: "not-a-date" },
    { physicalWidthCm: 0 }, { physicalWidthCm: 101 },
  ])("rejects owner card wire regressions %j", (change) => {
    expect(checkResponseContract("createTableCard", 201, { ...ownerCard, ...change }).conforms).toBe(false);
  });

  it.each([{}, { version: "1" }, { version: 1.5 }])("rejects invalid menu versions %j", (body) => {
    expect(checkResponseContract("getPublicMenuVersion", 200, body).conforms).toBe(false);
  });
});
