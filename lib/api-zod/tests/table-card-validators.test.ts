import { describe, expect, it } from "vitest";
// Import the real, unbundled generated module at collection time. Constants
// emitted below schemas that reference them must fail here, even if the
// server's esbuild bundle happens to conceal the initialization-order bug.
import {
  UpdateTableCardBody,
  UpdateTableCardParams,
  UpdateTableCardResponse,
} from "../src/generated/api";

describe("generated UpdateTableCardBody contract", () => {
  it.each(["A", "a".repeat(80), "  Patio card \t", "\nA\n"])(
    "accepts a nonblank name without trimming: %j",
    (name) => {
      expect(UpdateTableCardBody.parse({ name })).toEqual({ name });
    },
  );

  it.each(["", "a".repeat(81), " ", "\t\r\n", "\u00a0", "\u2003"])(
    "rejects an empty, overlong, or whitespace-only name: %j",
    (name) => {
      expect(UpdateTableCardBody.safeParse({ name }).success).toBe(false);
    },
  );

  it.each([0.001, 0.0011, 12.5, 100])(
    "accepts width %s, including both inclusive bounds",
    (physicalWidthCm) => {
      expect(UpdateTableCardBody.parse({ physicalWidthCm })).toEqual({
        physicalWidthCm,
      });
    },
  );

  it.each([-1, 0, 0.0009, 100.001, NaN, Infinity, -Infinity, "12", null])(
    "rejects width %j without number coercion",
    (physicalWidthCm) => {
      expect(
        UpdateTableCardBody.safeParse({ physicalWidthCm }).success,
      ).toBe(false);
    },
  );

  it("accepts individual optional fields and their combination", () => {
    for (const body of [
      { name: "Patio" },
      { physicalWidthCm: 10 },
      { isActive: true },
      { isActive: false },
      { name: "Patio", physicalWidthCm: 10, isActive: false },
      { name: undefined, physicalWidthCm: undefined, isActive: undefined },
    ]) {
      expect(UpdateTableCardBody.parse(body)).toEqual(body);
    }
  });

  it.each([
    { name: null },
    { name: 123 },
    { physicalWidthCm: null },
    { isActive: null },
    { isActive: "false" },
    { isActive: 0 },
    null,
    [],
  ])("rejects wrong field or body types: %j", (body) => {
    expect(UpdateTableCardBody.safeParse(body).success).toBe(false);
  });

  it("leaves nonempty/unknown-field enforcement to the server boundary", () => {
    // Orval currently omits minProperties and additionalProperties: false.
    // Assert actual generated behavior, not the stricter route behavior.
    expect(UpdateTableCardBody.parse({})).toEqual({});
    expect(UpdateTableCardBody.parse({ unsupported: true })).toEqual({});
    expect(
      UpdateTableCardBody.parse({ name: "Patio", unsupported: true }),
    ).toEqual({ name: "Patio" });
  });
});

describe("generated UpdateTableCardResponse contract", () => {
  const timestamp = "2026-10-15T12:34:56.000Z";
  const response = {
    id: "card-1",
    name: "Patio",
    referenceImageUrl: "/api/storage/objects/card-1",
    physicalWidthCm: 12,
    isActive: false,
    createdAt: timestamp,
  };

  it.each([timestamp, new Date(timestamp), Date.parse(timestamp)])(
    "coerces createdAt %j to a Date",
    (createdAt) => {
      const parsed = UpdateTableCardResponse.parse({ ...response, createdAt });
      expect(parsed).toEqual({ ...response, createdAt: new Date(timestamp) });
      expect(parsed.createdAt).toBeInstanceOf(Date);
    },
  );

  it.each(["not-a-date", "", undefined, new Date(NaN)])(
    "rejects invalid or missing createdAt: %j",
    (createdAt) => {
      expect(
        UpdateTableCardResponse.safeParse({ ...response, createdAt }).success,
      ).toBe(false);
    },
  );

  it.each([0.0001, 0.001, 100])(
    "accepts positive response width %s (unlike the request minimum)",
    (physicalWidthCm) => {
      expect(
        UpdateTableCardResponse.parse({ ...response, physicalWidthCm })
          .physicalWidthCm,
      ).toBe(physicalWidthCm);
    },
  );

  it.each([-1, 0, 100.001, NaN, Infinity, "12", null])(
    "rejects response width %j without number coercion",
    (physicalWidthCm) => {
      expect(
        UpdateTableCardResponse.safeParse({ ...response, physicalWidthCm })
          .success,
      ).toBe(false);
    },
  );

  it.each(Object.keys(response))("requires response field %s", (field) => {
    const incomplete: Record<string, unknown> = { ...response };
    delete incomplete[field];
    expect(UpdateTableCardResponse.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    { id: 1 },
    { name: null },
    { referenceImageUrl: null },
    { isActive: "false" },
  ])("rejects wrong response field types: %j", (patch) => {
    expect(
      UpdateTableCardResponse.safeParse({ ...response, ...patch }).success,
    ).toBe(false);
  });
});

describe("generated UpdateTableCardParams contract", () => {
  it.each([
    ["card-1", "card-1"],
    [123, "123"],
    [0, "0"],
    [false, "false"],
  ])("coerces id %j to %j", (id, expected) => {
    expect(UpdateTableCardParams.parse({ id })).toEqual({ id: expected });
  });

  it("rejects an empty id but does not trim strings", () => {
    expect(UpdateTableCardParams.safeParse({ id: "" }).success).toBe(false);
    expect(UpdateTableCardParams.parse({ id: "  card-1  " })).toEqual({
      id: "  card-1  ",
    });
  });

  it("preserves Zod string coercion for null and missing ids", () => {
    // Required in OpenAPI does not bypass z.coerce.string() semantics.
    expect(UpdateTableCardParams.parse({ id: null })).toEqual({ id: "null" });
    expect(UpdateTableCardParams.parse({})).toEqual({ id: "undefined" });
  });
});
