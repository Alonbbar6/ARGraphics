/**
 * Minimal ZIP writer (store only, no compression). WebP frames are already compressed,
 * so this is only here so the baker works in browsers without the File System Access API.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: Uint8Array; crc: number; offset: number };

export class ZipWriter {
  private readonly parts: Uint8Array[] = [];
  private readonly entries: Entry[] = [];
  private offset = 0;

  async add(name: string, blob: Blob) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // utf-8 names
    header.setUint16(8, 0, true); // store
    header.setUint16(10, 0, true);
    header.setUint16(12, 0, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    this.entries.push({ name, data, crc, offset: this.offset });
    this.push(new Uint8Array(header.buffer));
    this.push(nameBytes);
    this.push(data);
  }

  private push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.offset += bytes.length;
  }

  finish(): Blob {
    const centralStart = this.offset;
    for (const e of this.entries) {
      const nameBytes = new TextEncoder().encode(e.name);
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, 0, true);
      h.setUint16(14, 0, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.data.length, true);
      h.setUint32(24, e.data.length, true);
      h.setUint16(28, nameBytes.length, true);
      h.setUint16(30, 0, true);
      h.setUint16(32, 0, true);
      h.setUint16(34, 0, true);
      h.setUint16(36, 0, true);
      h.setUint32(38, 0, true);
      h.setUint32(42, e.offset, true);
      this.push(new Uint8Array(h.buffer));
      this.push(nameBytes);
    }
    const centralSize = this.offset - centralStart;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);
    this.push(new Uint8Array(end.buffer));
    return new Blob(this.parts as BlobPart[], { type: 'application/zip' });
  }
}
