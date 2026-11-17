/**
 * Minimal ZIP reader and writer built on the browser's own decompression (no library needed).
 * Handles what ordinary ZIP tools produce: stored and deflated files, no encryption,
 * no ZIP64 (archives over 4 GB).
 */

/** Refuse archives that would unpack to more than this (protects phones from "zip bombs"). */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

const END_RECORD = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;

/** Unpacks all files of a ZIP archive; keys are paths with `/` separators. */
export async function readZip(data: ArrayBuffer): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);

  // The list of files sits at the end of the archive; find its record by searching backwards.
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_RECORD) end--;
  if (end < 0) throw new Error('Not a ZIP file.');
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);

  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const decoder = new TextDecoder();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== DIRECTORY_ENTRY) throw new Error('Damaged ZIP file.');
    const method = view.getUint16(pos + 10, true);
    const packedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    // Some Windows tools write backslashes in paths.
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)).replaceAll('\\', '/');
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue; // a folder

    total += size;
    if (total > MAX_UNPACKED_BYTES) throw new Error('The ZIP file is too large.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = bytes.slice(start, start + packedSize);
    if (method === 0) files.set(name, packed);
    else if (method === 8) files.set(name, await inflate(packed));
    else throw new Error(`Unsupported ZIP compression method ${method}.`);
  }
  return files;
}

async function inflate(packed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- Writing ------------------------------------------------------------------------

const LOCAL_HEADER = 0x04034b50;
/** Text files shrink well; pictures are already compressed and are stored as they are. */
const COMPRESSIBLE = /\.(json|svg|txt|html|css|js)$/i;

let crcTable: Uint32Array | undefined;

/** The checksum ZIP stores for every file. */
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Packs files into a ZIP archive that ordinary ZIP tools (and `readZip`) can open. */
export async function writeZip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    let packed = file.data;
    let method = 0;
    if (COMPRESSIBLE.test(file.name)) {
      const smaller = await deflate(file.data);
      if (smaller.length < file.data.length) {
        packed = smaller;
        method = 8;
      }
    }
    // The fields shared by the file's own header and its entry in the list at the end.
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true); // version needed to unpack
    common.setUint16(2, 0x0800, true); // names are UTF-8
    common.setUint16(4, method, true);
    common.setUint16(6, 0, true); // time
    common.setUint16(8, 0x21, true); // date: 1 January 1980
    common.setUint32(10, crc32(file.data), true);
    common.setUint32(14, packed.length, true);
    common.setUint32(18, file.data.length, true);
    common.setUint16(22, name.length, true);
    common.setUint16(24, 0, true); // no extra field

    const local = new Uint8Array(30 + name.length);
    new DataView(local.buffer).setUint32(0, LOCAL_HEADER, true);
    local.set(new Uint8Array(common.buffer), 4);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, DIRECTORY_ENTRY, true);
    entryView.setUint16(4, 20, true); // version made by
    entry.set(new Uint8Array(common.buffer), 6);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);

    parts.push(local, packed);
    directory.push(entry);
    offset += local.length + packed.length;
  }

  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_RECORD, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...directory, new Uint8Array(end.buffer)];
  const result = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
