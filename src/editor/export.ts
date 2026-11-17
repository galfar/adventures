import { listAssets, saveAsset, saveProject, type ProjectRecord } from '../shared/db.ts';
import type { Story } from '../shared/format/types.ts';
import { normalizeStory } from '../shared/format/validate.ts';
import { readZip, writeZip } from '../shared/zip.ts';
import { assetRefs, copyStory, ensurePositions, newId } from './ops.ts';

/**
 * Getting adventures out of the editor and back in.
 *
 * - ZIP: `story.json` plus the pictures. It is the backup, the file another author can
 *   open in their editor, and what the player site opens.
 * - One HTML file: the player with the story and pictures inside, for sending to players.
 */

export interface Picture {
  path: string;
  blob: Blob;
}

const PICTURE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** The pictures the story actually uses (pictures of deleted pages are left out). */
export async function usedPictures(projectId: string, story: Story): Promise<Picture[]> {
  const used = new Set(assetRefs(story));
  return (await listAssets(projectId)).filter((asset) => used.has(asset.path)).map(({ path, blob }) => ({ path, blob }));
}

/** A file name made from the story's title: "Ztracená stanice" becomes "ztracena-stanice". */
export function fileName(title: string, extension: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'adventure'}.${extension}`;
}

export async function buildZip(story: Story, pictures: Picture[]): Promise<Blob> {
  const files = [{ name: 'story.json', data: new TextEncoder().encode(JSON.stringify(story, null, 2)) }];
  for (const picture of pictures) files.push({ name: picture.path, data: new Uint8Array(await picture.blob.arrayBuffer()) });
  return new Blob([await writeZip(files)], { type: 'application/zip' });
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Puts the story and its pictures into the single-file player.
 * `template` is the text of `player-template.html` (made by scripts/build-template.mjs).
 */
export async function buildHtml(story: Story, pictures: Picture[], template: string): Promise<Blob> {
  const assets: Record<string, string> = {};
  for (const picture of pictures) {
    const type = picture.blob.type || PICTURE_TYPES[picture.path.split('.').pop()!.toLowerCase()] || '';
    assets[picture.path] = await dataUrl(type === picture.blob.type ? picture.blob : new Blob([picture.blob], { type }));
  }
  // Inside a <script> element only "<" needs care: written as < it can never form
  // a closing tag, and JSON reads it back as the same character.
  const data = JSON.stringify({ story, assets }).replace(/</g, '\\u003c');
  if (!template.includes('<!--ADVENTURE-DATA-->')) throw new Error('The player template is not usable.');
  const html = template
    // Replacement functions, because story text may contain "$" which replace() would interpret.
    .replace('<!--ADVENTURE-TITLE-->', () => escapeHtml(story.title))
    .replace('<!--ADVENTURE-DATA-->', () => `<script type="application/json" id="adventure-data">${data}</script>`);
  return new Blob([html], { type: 'text/html' });
}

export async function loadTemplate(): Promise<string> {
  const response = await fetch('player-template.html');
  if (!response.ok) throw new Error(`player-template.html: ${response.status}`);
  return response.text();
}

/** Hands a file to the browser to save. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address is withdrawn.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens an adventure ZIP as a new project and returns the project's id.
 * It never replaces an existing project, even when the same file is opened twice.
 */
export async function importZip(data: ArrayBuffer): Promise<string> {
  const files = await readZip(data);
  const storyPath = [...files.keys()]
    .filter((name) => name === 'story.json' || name.endsWith('/story.json'))
    .sort((a, b) => a.length - b.length)[0];
  if (storyPath === undefined) throw new Error('No story.json in the ZIP file.');
  const folder = storyPath.slice(0, -'story.json'.length);
  const parsed = normalizeStory(JSON.parse(new TextDecoder().decode(files.get(storyPath))));
  const story = copyStory(parsed, parsed.title);
  ensurePositions(story);

  const now = Date.now();
  const record: ProjectRecord = { id: newId('project') + now.toString(36), doc: { story, trash: [] }, past: [], future: [], createdAt: now, updatedAt: now };
  for (const ref of assetRefs(story)) {
    const bytes = files.get(folder + ref);
    const type = PICTURE_TYPES[ref.split('.').pop()!.toLowerCase()];
    // Only real picture files the story points to are taken from the archive.
    if (bytes && type) await saveAsset(record.id, ref, new Blob([bytes], { type }));
  }
  await saveProject(record);
  return record.id;
}
