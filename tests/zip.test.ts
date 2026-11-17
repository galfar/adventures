import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readZip } from '../src/shared/zip.ts';

/** Builds a ZIP archive by hand (checksums left at zero; the reader does not need them). */
function makeZip(files: { name: string; text: string; deflate: boolean }[]): ArrayBuffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.text);
    const data = file.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(file.deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    directory.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, directoryBytes, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

test('reads stored and deflated files, with Czech text and Windows paths', async () => {
  const story = JSON.stringify({ title: 'Ztracená stanice', text: 'žluťoučký kůň '.repeat(50) });
  const files = await readZip(
    makeZip([
      { name: 'story.json', text: story, deflate: true },
      { name: 'images\\a.svg', text: '<svg/>', deflate: false },
      { name: 'images/', text: '', deflate: false },
    ]),
  );
  assert.deepEqual([...files.keys()], ['story.json', 'images/a.svg']);
  assert.equal(new TextDecoder().decode(files.get('story.json')), story);
  assert.equal(new TextDecoder().decode(files.get('images/a.svg')), '<svg/>');
});

test('refuses data that is not a ZIP archive', async () => {
  await assert.rejects(readZip(new TextEncoder().encode('this is not a zip file at all').buffer as ArrayBuffer));
});
