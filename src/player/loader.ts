import { getProject, listAssets } from '../shared/db.ts';
import type { Story } from '../shared/format/types.ts';
import { normalizeStory } from '../shared/format/validate.ts';
import { readZip } from '../shared/zip.ts';

/** A story together with a way to find its pictures, wherever it was loaded from. */
export interface StoryPackage {
  story: Story;
  /** Turns a picture reference from the story into a URL the browser can show. */
  assetUrl(ref: string | undefined): string | undefined;
}

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** Picture references must stay inside the story package: relative, no `..`, no `http:` etc. */
function safeRef(ref: string | undefined): string | undefined {
  if (!ref || ref.startsWith('/') || ref.includes('\\') || ref.includes(':')) return undefined;
  return ref.split('/').includes('..') ? undefined : ref;
}

async function fetchOk(url: URL): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status}`);
  return response;
}

/**
 * Loads a story from the web. The address may be a folder (containing `story.json`),
 * a `story.json` file, or a `.zip` package.
 */
export async function loadFromUrl(address: string): Promise<StoryPackage> {
  const url = new URL(address, location.href);
  if (url.pathname.endsWith('.zip')) return loadFromZip(await (await fetchOk(url)).arrayBuffer());
  if (!url.pathname.endsWith('.json')) url.pathname = url.pathname.replace(/\/?$/, '/story.json');
  const story = normalizeStory(await (await fetchOk(url)).json());
  return {
    story,
    assetUrl: (ref) => {
      const safe = safeRef(ref);
      return safe && new URL(safe, url).href;
    },
  };
}

/** Loads a story from a ZIP package: `story.json` plus pictures, optionally inside one folder. */
export async function loadFromZip(data: ArrayBuffer): Promise<StoryPackage> {
  const files = await readZip(data);
  const storyPath = [...files.keys()]
    .filter((name) => name === 'story.json' || name.endsWith('/story.json'))
    .sort((a, b) => a.length - b.length)[0];
  if (storyPath === undefined) throw new Error('The ZIP file contains no story.json.');
  const folder = storyPath.slice(0, -'story.json'.length);
  const story = normalizeStory(JSON.parse(new TextDecoder().decode(files.get(storyPath))));

  const urls = new Map<string, string>();
  return {
    story,
    assetUrl: (ref) => {
      const safe = safeRef(ref);
      const bytes = safe && files.get(folder + safe);
      if (!safe || !bytes) return undefined;
      let url = urls.get(safe);
      if (!url) {
        const type = MIME_TYPES[safe.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
        url = URL.createObjectURL(new Blob([bytes], { type }));
        urls.set(safe, url);
      }
      return url;
    },
  };
}

/**
 * Loads a story embedded in the page itself (single-file HTML export):
 * `<script type="application/json" id="adventure-data">{"story": …, "assets": {"images/a.png": "data:…"}}</script>`
 */
export function loadEmbedded(): StoryPackage | undefined {
  const element = document.getElementById('adventure-data');
  if (!element?.textContent) return undefined;
  const data = JSON.parse(element.textContent) as { story: unknown; assets?: Record<string, string> };
  const assets = data.assets ?? {};
  return {
    story: normalizeStory(data.story),
    assetUrl: (ref) => (ref !== undefined && assets[ref]?.startsWith('data:image/') ? assets[ref] : undefined),
  };
}

/**
 * Loads a project straight from the editor's storage, for play-testing.
 * `startPage` begins the story on another page ("play from this page").
 */
export async function loadFromProject(projectId: string, startPage?: string): Promise<StoryPackage> {
  const record = await getProject(projectId);
  if (!record) throw new Error('Project not found.');
  const story = normalizeStory(record.doc.story);
  if (startPage !== undefined && story.pages.some((page) => page.id === startPage)) story.startPage = startPage;
  const urls = new Map((await listAssets(projectId)).map((asset) => [asset.path, URL.createObjectURL(asset.blob)]));
  return { story, assetUrl: (ref) => (ref === undefined ? undefined : urls.get(ref)) };
}
