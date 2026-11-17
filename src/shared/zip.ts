/**
 * Minimal ZIP reader built on the browser's own decompression (no library needed).
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
