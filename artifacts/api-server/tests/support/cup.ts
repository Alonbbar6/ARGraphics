import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import sharp from "sharp";

export const io = () => new NodeIO().registerExtensions([KHRMeshQuantization]);
export const SEG = 32;
export const R = 1;
export const H = 2;

/** Atlas: left half pale grey like glass, right half orange like a garnish or a spritz. */
export const atlas = (size = 64) => {
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 3;
    if (x < size / 2) { raw[i] = 205; raw[i + 1] = 208; raw[i + 2] = 212; }
    else { raw[i] = 240; raw[i + 1] = 150; raw[i + 2] = 30; }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
};

/**
 * A cup: a cylinder in four bands (the lower two textured orange like liquid, the upper two
 * grey like glass) and a vertical disc standing on the rim at the right, like a citrus wheel.
 * With `paintedSlice`, the upper front-right wall is textured orange too, like Meshy's painted
 * copy of the garnish. Bands share no vertices, so every triangle has one colour.
 */
export async function cup({ paintedSlice = false, bottom = false } = {}) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ROWS = 5;
  const bandTriangles = SEG * 2 * ROWS;
  for (let band = 0; band < 4; band++) {
    const base = positions.length / 3;
    for (let row = 0; row <= ROWS; row++) {
      const y = ((band + row / ROWS) * H) / 4;
      for (let s = 0; s <= SEG; s++) {
        const angle = (s / SEG) * Math.PI * 2;
        positions.push(R * Math.cos(angle), y, R * Math.sin(angle));
        const frontRight = s < SEG / 4;
        const orange = band < 2 || (paintedSlice && frontRight);
        uvs.push((orange ? 0.5 : 0) + 0.49 * (s / SEG), 1 - y / H);
      }
    }
    for (let row = 0; row < ROWS; row++) {
      for (let s = 0; s < SEG; s++) {
        const a = base + row * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const discBase = positions.length / 3;
  const [dx, dy, dr] = [R + 0.3, H - 0.45, 0.4];
  positions.push(dx, dy, 0);
  uvs.push(0.75, 0.5);
  for (let s = 0; s < SEG; s++) {
    const angle = (s / SEG) * Math.PI * 2;
    positions.push(dx + dr * Math.cos(angle), dy + dr * Math.sin(angle), 0);
    uvs.push(0.75 + 0.2 * Math.cos(angle), 0.5 + 0.2 * Math.sin(angle));
  }
  for (let s = 0; s < SEG; s++) indices.push(discBase, discBase + 1 + s, discBase + 1 + ((s + 1) % SEG));
  if (bottom) {
    // A floor at y = 0, wound to face down.
    const floorBase = positions.length / 3;
    positions.push(0, 0, 0);
    uvs.push(0.75, 0.9);
    for (let s = 0; s < SEG; s++) {
      const angle = (s / SEG) * Math.PI * 2;
      positions.push(R * Math.cos(angle), 0, R * Math.sin(angle));
      uvs.push(0.75 + 0.05 * Math.cos(angle), 0.9 + 0.05 * Math.sin(angle));
    }
    for (let s = 0; s < SEG; s++) indices.push(floorBase, floorBase + 1 + s, floorBase + 1 + ((s + 1) % SEG));
  }
  const texture = document.createTexture("atlas").setImage(new Uint8Array(await atlas())).setMimeType("image/png");
  const material = document.createMaterial("mat0").setBaseColorTexture(texture).setRoughnessFactor(0.8);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  document.createNode("cup").setMesh(document.createMesh("cup").addPrimitive(primitive));
  document.createScene().addChild(document.getRoot().listNodes()[0]);
  return { glb: Buffer.from(await io().writeBinary(document)), bandTriangles, discTriangles: SEG };
}

