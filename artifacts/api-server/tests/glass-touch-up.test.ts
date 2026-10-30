import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { publicObjects } from "./support/storage";
import { atlas, cup } from "./support/cup";
import { glassifyGlb, type Loop } from "../src/lib/glb-glass";
import { writeUsdz } from "../src/lib/usdz";

const endpoint = "/api/drinks/fixture-drink/glass-touch-up";
const liquid: Loop = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
const garnish: Loop = [[0.6, 0], [1, 0], [1, 0.45], [0.6, 0.45]];

const triangleCounts = async (bytes: Buffer) => {
  const document = await new NodeIO().registerExtensions([KHRMeshQuantization]).readBinary(new Uint8Array(bytes));
  // The solid and glass parts only; the drink's body is a third, unindexed primitive.
  return document.getRoot().listMeshes()[0].listPrimitives().filter((p) => p.getIndices()).map((p) => p.getIndices()!.getCount() / 3);
};

/** A built, split clear-glass model stored as the fixture drink's files. */
async function storeSplitModel() {
  const { glb } = await cup();
  const split = (await glassifyGlb(glb, { parts: { liquid, garnish: [garnish] } }))!;
  publicObjects.set("public/argraphics/drinks/fixture-drink/model.glb", { bytes: split.glb, contentType: "model/gltf-binary" });
  publicObjects.set("public/argraphics/drinks/fixture-drink/model.usdz", {
    bytes: writeUsdz([{ name: "model.usdc", data: Buffer.from("PXR-USDC stand-in") }, { name: "tex.jpg", data: Buffer.alloc(8) }]), contentType: "model/vnd.usdz+zip",
  });
  await db.update(schema.drinksTable).set({
    clearGlass: true, modelGlbUrl: "/public-objects/argraphics/drinks/fixture-drink/model.glb",
    modelUsdzUrl: "/public-objects/argraphics/drinks/fixture-drink/model.usdz", generationStatus: "ready",
  }).where(eq(schema.drinksTable.id, "fixture-drink"));
  return triangleCounts(split.glb);
}

beforeEach(() => publicObjects.clear());

describe("owner's glass touch-ups", () => {
  it("re-splits the stored model with the lassoed spots, keeps the labels, and rewrites both files", async () => {
    const cookie = await signIn();
    const [solidBefore, glassBefore] = await storeSplitModel();
    // Three glass triangles become solid; one solid triangle becomes glass.
    const response = await request(app).post(endpoint).set("Cookie", cookie)
      .send({ solid: [[1, 0], [1, 1], [1, 2]], glass: [[0, 0]] }).expect(200);
    expect(response.body.modelGlbUrl).not.toContain("model.glb");
    expect(response.body.modelUsdzUrl).not.toContain("model.usdz");
    expect(response.body.clearGlass).toBe(true);
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(Object.keys(drink.glassOverrides ?? {})).toHaveLength(4);
    const stored = publicObjects.get(`public/${drink.modelGlbUrl!.replace("/public-objects/", "")}`)!;
    expect(stored.contentType).toBe("model/gltf-binary");
    expect(await triangleCounts(stored.bytes)).toEqual([solidBefore + 2, glassBefore - 2]);
    const usdz = publicObjects.get(`public/${drink.modelUsdzUrl!.replace("/public-objects/", "")}`)!;
    expect(usdz.bytes.toString("latin1")).toContain("argraphics-glass.usda");
    // The published menu moved on, so guests fetch the new files.
    const [version] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    expect(version.version).toBe(2);
    // A second touch-up builds on the first: earlier labels still apply.
    const again = await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[1, 3]], glass: [] }).expect(200);
    const [drinkAgain] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(Object.keys(drinkAgain.glassOverrides ?? {})).toHaveLength(5);
    const storedAgain = publicObjects.get(`public/${again.body.modelGlbUrl.replace(/^.*\/public-objects\//, "")}`)!;
    expect(await triangleCounts(storedAgain.bytes)).toEqual([solidBefore + 3, glassBefore - 3]);
  });
  it("fills in lassoed spots: they turn solid, stay solid, and their texture is repainted in both files", async () => {
    const cookie = await signIn();
    const [solidBefore, glassBefore] = await storeSplitModel();
    await request(app).post(endpoint).set("Cookie", cookie)
      .send({ solid: [], glass: [], fill: [[1, 0], [1, 1], [1, 2], [1, 3]] }).expect(200);
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(Object.values(drink.glassOverrides ?? {})).toEqual(["solid", "solid", "solid", "solid"]);
    const stored = publicObjects.get(`public/${drink.modelGlbUrl!.replace("/public-objects/", "")}`)!;
    expect(await triangleCounts(stored.bytes)).toEqual([solidBefore + 4, glassBefore - 4]);
    const document = await new NodeIO().registerExtensions([KHRMeshQuantization]).readBinary(new Uint8Array(stored.bytes));
    const image = document.getRoot().listMaterials()[0].getBaseColorTexture()!.getImage()!;
    expect(Buffer.from(image).equals(await atlas())).toBe(false);
    const usdz = publicObjects.get(`public/${drink.modelUsdzUrl!.replace("/public-objects/", "")}`)!;
    expect(usdz.bytes.toString("latin1")).toContain("argraphics-glass.png");
  });
  it("fills the inside behind lassoed glass: the wall stays clear, an inner surface is stored, and later picks still resolve", async () => {
    const cookie = await signIn();
    const [solidBefore, glassBefore] = await storeSplitModel();
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [], glass: [], inside: [[1, 0], [1, 1]] }).expect(200);
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(Object.values(drink.glassOverrides ?? {})).toEqual(["glass", "glass"]);
    const stored = publicObjects.get(`public/${drink.modelGlbUrl!.replace("/public-objects/", "")}`)!;
    expect(await triangleCounts(stored.bytes)).toEqual([solidBefore, glassBefore]);
    const document = await new NodeIO().registerExtensions([KHRMeshQuantization]).readBinary(new Uint8Array(stored.bytes));
    const names = document.getRoot().listMeshes()[0].listPrimitives().map((p) => p.getMaterial()!.getName());
    expect(names).toContain("inner");
    // The inner surface takes no picks; a pick naming it is ignored and the rest still apply.
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[names.indexOf("inner"), 0], [1, 2]], glass: [] }).expect(200);
    const [after] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(Object.keys(after.glassOverrides ?? {})).toHaveLength(3);
  });
  it("refuses while a build runs, without a clear-glass model, and for another owner's drink", async () => {
    const cookie = await signIn();
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[1, 0]], glass: [] }).expect(400);
    await storeSplitModel();
    await db.update(schema.drinksTable).set({ generationStatus: "processing" }).where(eq(schema.drinksTable.id, "fixture-drink"));
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[1, 0]], glass: [] }).expect(409);
    await db.update(schema.drinksTable).set({ generationStatus: "ready" }).where(eq(schema.drinksTable.id, "fixture-drink"));
    await request(app).post(endpoint).set("Cookie", await signIn("other@example.test")).send({ solid: [[1, 0]], glass: [] }).expect(404);
    await request(app).post(endpoint).send({ solid: [[1, 0]], glass: [] }).expect(401);
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: "nope" }).expect(400);
  });
  it("ignores picks that name no triangle and refuses an unsplit model", async () => {
    const cookie = await signIn();
    const [solidBefore, glassBefore] = await storeSplitModel();
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[7, 0], [1, 999999]], glass: [] }).expect(200);
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(drink.glassOverrides).toEqual({});
    expect(await triangleCounts(publicObjects.get(`public/${drink.modelGlbUrl!.replace("/public-objects/", "")}`)!.bytes)).toEqual([solidBefore, glassBefore]);
    const { glb } = await cup();
    publicObjects.set("public/argraphics/drinks/fixture-drink/plain.glb", { bytes: glb, contentType: "model/gltf-binary" });
    await db.update(schema.drinksTable).set({ modelGlbUrl: "/public-objects/argraphics/drinks/fixture-drink/plain.glb" }).where(eq(schema.drinksTable.id, "fixture-drink"));
    await request(app).post(endpoint).set("Cookie", cookie).send({ solid: [[0, 0]], glass: [] }).expect(400);
  });
});
