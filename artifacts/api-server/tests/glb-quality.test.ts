import { describe, expect, it } from "vitest";
import { judgeDrinkModel, summarizeGlb } from "../src/lib/glb-quality";

/** Builds a binary glTF container around a scene description. */
function glb(json: object): Buffer {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  while (text.length % 4) text = Buffer.concat([text, Buffer.from(" ")]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(text.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, text]);
}

/** A textured drink: 2,000 triangles, 1 unit wide, 1.5 units tall. */
const drink = (overrides: Partial<{ triangles: number; images: number; height: number }> = {}) => {
  const { triangles = 2000, images = 1, height = 1.5 } = overrides;
  return glb({
    asset: { version: "2.0" },
    images: Array.from({ length: images }, () => ({ uri: "tex.png" })),
    accessors: [
      { count: triangles * 3 },
      { count: 1200, min: [-0.5, 0, -0.5], max: [0.5, height, 0.5] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }],
  });
};

describe("generated model checks", () => {
  it("summarizes geometry, textures and extents from the container", () => {
    expect(summarizeGlb(drink())).toEqual({ triangles: 2000, images: 1, extents: { x: 1, y: 1.5, z: 1 } });
  });
  it("rejects bytes that are not a glTF container", () => {
    expect(() => summarizeGlb(Buffer.from("not a model"))).toThrow(/glTF/);
  });
  it("passes a proper drink, with or without the photo's proportions", () => {
    expect(judgeDrinkModel(summarizeGlb(drink()))).toBeNull();
    expect(judgeDrinkModel(summarizeGlb(drink()), 1.5)).toBeNull();
    expect(judgeDrinkModel(summarizeGlb(drink()), 2.2)).toBeNull();
  });
  it("passes a PBR model that carries colour, metal-rough and normal maps", () => {
    expect(judgeDrinkModel(summarizeGlb(drink({ images: 3 })))).toBeNull();
  });
  it("fails placeholders, untextured and flat results", () => {
    expect(judgeDrinkModel(summarizeGlb(drink({ triangles: 120 })))).toMatch(/no detail/);
    expect(judgeDrinkModel(summarizeGlb(drink({ images: 0 })))).toMatch(/texture/);
    expect(judgeDrinkModel(summarizeGlb(drink({ height: 0 })))).toMatch(/flat/);
  });
  it("fails a model whose proportions do not match the photo", () => {
    expect(judgeDrinkModel(summarizeGlb(drink()), 9)).toMatch(/proportions/);
    expect(judgeDrinkModel(summarizeGlb(drink({ height: 6 })), 1)).toMatch(/proportions/);
  });
  it("allows a low dish whose photo was taken from above", () => {
    // A plate of tacos: cutout 0.64 tall per unit wide, model a quarter as tall as it is wide.
    expect(judgeDrinkModel(summarizeGlb(drink({ height: 0.25 })), 0.64)).toBeNull();
  });
});
