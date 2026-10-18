/**
 * USDZ for AR Quick Look on iPhone, at real-world size.
 *
 * Meshy exports every model about 1.9 units tall. The web viewer scales the GLB before AR
 * starts, but on iPhone the AR file is a USDZ, and Chrome on iOS cannot open the one
 * model-viewer generates in the page (blob URLs never reach Quick Look). So the server
 * serves a real .usdz instead: the original file plus a tiny root layer that sets
 * `metersPerUnit`, which Quick Look honours when it sizes the scene.
 *
 * A USDZ is a plain zip with no compression, every file's data aligned to 64 bytes, and
 * the first file as the root layer. Nothing here parses USD; the original layer is left
 * untouched and sublayered under the new root.
 */

export type ZipEntry = { name: string; data: Buffer };

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const ALIGN = 64;

/** Reads a stored (uncompressed) zip, which is what every USDZ is. */
export function readStoredZip(bytes: Buffer): ZipEntry[] {
  // Find the end-of-central-directory record (it sits in the last 64 KB).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === END_RECORD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_HEADER) throw new Error("bad zip central directory");
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (method !== 0) throw new Error(`zip entry ${name} is compressed; a USDZ must be stored`);
    if (bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error("bad zip local header");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: bytes.subarray(dataStart, dataStart + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes a USDZ-conformant zip: stored entries, data aligned to 64 bytes, in the given order. */
export function writeUsdz(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    // Pad the local header's extra field so the file data starts on a 64-byte boundary.
    const unpadded = offset + 30 + name.length + 4;
    const pad = (ALIGN - (unpadded % ALIGN)) % ALIGN;
    const extra = Buffer.alloc(4 + pad);
    extra.writeUInt16LE(0x1986, 0); // Apple's alignment extra-field id
    extra.writeUInt16LE(pad, 2);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_HEADER, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(entry.data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([record, name]));

    parts.push(local, name, extra, entry.data);
    offset += local.length + name.length + extra.length + entry.data.length;
  }
  const centralStart = offset;
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_RECORD, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBytes, end]);
}

/** The layer file that leads the original USDZ (its root layer). */
export function rootLayerName(entries: ZipEntry[]): string {
  const layer = entries.find((entry) => /\.(usdc|usda|usd)$/i.test(entry.name));
  if (!layer) throw new Error("USDZ has no USD layer");
  return layer.name;
}

/**
 * Returns a new USDZ whose stage is `metersPerUnit` metres per model unit. For a model
 * 1.9 units tall that should stand 16 cm, pass 0.16 / 1.9.
 */
export function scaledUsdz(original: Buffer, metersPerUnit: number): Buffer {
  if (!(metersPerUnit > 0) || !Number.isFinite(metersPerUnit)) throw new Error("metersPerUnit must be positive");
  const entries = readStoredZip(original).filter((entry) => entry.name !== "argraphics.usda");
  const layer = rootLayerName(entries);
  const root = [
    "#usda 1.0",
    "(",
    `    subLayers = [ @./${layer}@ ]`,
    `    metersPerUnit = ${metersPerUnit.toPrecision(8)}`,
    ")",
    "",
  ].join("\n");
  return writeUsdz([{ name: "argraphics.usda", data: Buffer.from(root, "utf8") }, ...entries]);
}
