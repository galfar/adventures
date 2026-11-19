import { PlayerApp } from './app.ts';
import { h } from '../shared/dom.ts';
import { libraryLanguage, setLibraryLanguage, translator } from './i18n/index.ts';
import { loadEmbedded, loadFromProject, loadFromUrl, loadFromZip, type StoryPackage } from './loader.ts';
import { applyTheme } from './themes.ts';

/**
 * Start-up. The player gets its story from one of these places:
 *  1. embedded in the page (single-file HTML export),
 *  2. `?preview=<project>` (optionally `&page=<page>`): a project from the editor, for play-testing,
 *  3. the `?story=` address: a folder with story.json, a story.json, or a .zip,
 *  4. otherwise it shows the library: bundled adventures plus "open a file".
 * `?theme=` overrides the story's visual style.
 */

const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
let language = libraryLanguage();
let t = translator(language);

interface LibraryEntry {
  path: string;
  title: string;
  description?: string;
  language?: string;
}

function play(pkg: StoryPackage, fromLibrary: boolean, preview = false): void {
  new PlayerApp(root, pkg, {
    preview,
    theme: params.get('theme') ?? undefined,
    onExit: fromLibrary ? () => location.assign(location.pathname) : undefined,
  });
}

async function showLibrary(error?: string): Promise<void> {
  applyTheme(params.get('theme') ?? undefined);
  document.title = t('libraryTitle');
  document.documentElement.lang = language;
  let entries: LibraryEntry[] = [];
  try {
    const response = await fetch('adventures/index.json');
    if (response.ok) entries = (await response.json()) as LibraryEntry[];
  } catch {
    // No bundled adventures: the library only offers opening a file.
  }
  // Adventures in the reader's language come first; the others are still there.
  entries.sort((a, b) => Number(b.language === language) - Number(a.language === language));

  const status = h('p', { class: 'error', role: 'alert' }, error ?? '');
  const fileInput = h('input', {
    class: 'file-input',
    type: 'file',
    accept: '.zip,application/zip',
    'aria-hidden': 'true',
    tabindex: -1,
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        play(await loadFromZip(await file.arrayBuffer()), true);
      } catch {
        status.textContent = t('loadError');
      }
    },
  });

  root.replaceChildren(
    h(
      'main',
      { class: 'book' },
      h(
        'article',
        { class: 'page' },
        h('h1', null, t('libraryTitle')),
        entries.length > 0 && h('p', { class: 'byline' }, t('libraryIntro')),
        h(
          'div',
          { class: 'library-list' },
          entries.map((entry) => {
            const link = new URLSearchParams(params);
            link.set('story', entry.path);
            return h(
              'a',
              { class: 'card', href: `?${link}` },
              h('strong', { class: 'card-title' }, entry.title),
              entry.description && h('span', { class: 'card-text' }, entry.description),
            );
          }),
        ),
        h('div', { class: 'divider' }),
        status,
        h(
          'nav',
          { class: 'actions' },
          h('button', { class: 'action', onclick: () => fileInput.click() }, t('openFile')),
          h(
            'button',
            {
              class: 'action',
              lang: language === 'cs' ? 'en' : 'cs',
              onclick: () => {
                language = language === 'cs' ? 'en' : 'cs';
                setLibraryLanguage(language);
                t = translator(language);
                void showLibrary();
              },
            },
            `🌐 ${t('switchLanguage')}`,
          ),
        ),
        fileInput,
      ),
    ),
  );
}

async function boot(): Promise<void> {
  try {
    const embedded = loadEmbedded();
    if (embedded) return play(embedded, false);
    const project = params.get('preview');
    if (project) return play(await loadFromProject(project, params.get('page') ?? undefined), false, true);
    const address = params.get('story');
    if (address) return play(await loadFromUrl(address), true);
  } catch (error) {
    console.error(error);
    return showLibrary(t('loadError'));
  }
  return showLibrary();
}

void boot();
