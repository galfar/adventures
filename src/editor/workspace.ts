import { addSnapshot, getProject, listAssets, listSnapshots, removeAsset, saveAsset, saveProject, type EditorDoc, type ProjectRecord } from '../shared/db.ts';
import { h } from '../shared/dom.ts';
import type { Page, PageId, Story } from '../shared/format/types.ts';
import { validateStory, type Problem } from '../shared/format/validate.ts';
import type { EditorContext } from './context.ts';
import { openExport, openHints, openPreview, openSettings, openTrash, openVersions } from './dialogs.ts';
import type { Translate } from './i18n/index.ts';
import { imageFrom, prepareImage } from './images.ts';
import { MapView } from './map.ts';
import { assetRefs, ensurePositions, findPage, newId, pageLabel } from './ops.ts';
import { buildPanel, growToFit } from './panel.ts';
import { Store, type ChangeOptions } from './store.ts';
import { openCounters, openHero, openItems } from './tables.ts';

/** Changes are written to storage this long after the last one. */
const SAVE_DELAY_MS = 400;
/** While the author works, a copy for "older versions" is kept this often. */
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;

interface Lock {
  release(): void;
  /** Resolves if another tab takes the project over. */
  lost: Promise<void>;
}

/**
 * Makes sure only one tab edits a project. Returns undefined when another tab holds it
 * (unless `steal` takes it over). Browsers without the Locks API get no protection.
 */
function acquireLock(projectId: string, steal: boolean): Promise<Lock | undefined> {
  if (!navigator.locks) return Promise.resolve({ release: () => {}, lost: new Promise<void>(() => {}) });
  return new Promise((resolve) => {
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    let reportLost = () => {};
    const lost = new Promise<void>((done) => (reportLost = done));
    navigator.locks
      .request(`adventures-project-${projectId}`, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(undefined);
          return undefined;
        }
        resolve({ release, lost });
        return held;
      })
      // The request fails when another tab steals the lock.
      .catch(() => reportLost());
  });
}

/** The editor of one project: top bar, map and page panel, with saving and undo. */
export class Workspace implements EditorContext {
  readonly t: Translate;
  readonly language: string;
  readonly projectId: string;
  selected: PageId | undefined;
  problems: Problem[] = [];

  private readonly root: HTMLElement;
  private readonly record: ProjectRecord;
  private readonly store: Store<EditorDoc>;
  private readonly lock: Lock;
  private readonly assets = new Map<string, string>();
  private readonly map: MapView;
  private readonly panel: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly bar: Record<'title' | 'undo' | 'redo' | 'status' | 'hints', HTMLElement>;
  private readonly cleanups: (() => void)[] = [];

  private dirty = false;
  private stopped = false;
  private saveTimer: number | undefined;
  private saving: Promise<void> = Promise.resolve();
  private lastSnapshot = '';

  /**
   * Opens a project in `root`. Shows a message instead (and returns undefined) when the
   * project does not exist or is being edited in another tab.
   */
  static async open(
    root: HTMLElement,
    projectId: string,
    t: Translate,
    language: string,
    page: string | undefined,
    steal = false,
  ): Promise<Workspace | undefined> {
    const message = (title: string, text: string, ...buttons: HTMLElement[]) =>
      root.replaceChildren(
        h('main', { class: 'home' }, h('h1', null, title), text && h('p', null, text), h('div', { class: 'button-row' }, buttons, h('a', { class: 'action', href: '#/' }, t('home')))),
      );

    const lock = await acquireLock(projectId, steal);
    if (!lock) {
      const retry = h('button', { class: 'action primary' }, t('useHere'));
      retry.addEventListener('click', async () => {
        const workspace = await Workspace.open(root, projectId, t, language, page, true);
        if (workspace) Workspace.onReplace(workspace);
      });
      message(t('lockedTitle'), t('lockedText'), retry);
      return undefined;
    }
    const record = await getProject(projectId);
    if (!record || record.deletedAt !== undefined) {
      lock.release();
      message(t('notFound'), '');
      return undefined;
    }
    ensurePositions(record.doc.story);
    const assets = await listAssets(projectId);
    const snapshots = await listSnapshots(projectId);
    const workspace = new Workspace(root, record, lock, t, language);

    // Pictures no version of the story uses any more are removed; the rest get an address.
    const used = new Set(
      [record.doc, ...record.past, ...record.future, ...snapshots.map((s) => s.doc)].flatMap((doc) => [
        ...assetRefs(doc.story),
        ...assetRefs({ ...doc.story, pages: doc.trash.map((entry) => entry.page) }),
      ]),
    );
    for (const asset of assets) {
      if (used.has(asset.path)) workspace.assets.set(asset.path, URL.createObjectURL(asset.blob));
      else void removeAsset(projectId, asset.path);
    }
    workspace.lastSnapshot = JSON.stringify(snapshots.at(-1)?.doc ?? null);
    workspace.begin(page);
    return workspace;
  }

  /** Set by the router so that "edit it here" can hand over the new workspace. */
  static onReplace: (workspace: Workspace) => void = () => {};

  private constructor(root: HTMLElement, record: ProjectRecord, lock: Lock, t: Translate, language: string) {
    this.root = root;
    this.record = record;
    this.lock = lock;
    this.t = t;
    this.language = language;
    this.projectId = record.id;
    this.store = new Store(record.doc, record.past, record.future);
    this.store.onChange = ({ quiet }) => this.afterChange(quiet);

    const iconButton = (icon: string, label: string, run: () => void, extra = '') =>
      h('button', { class: `action bar-button ${extra}`, title: label, 'aria-label': label, onclick: run }, icon);
    this.bar = {
      title: h('button', { class: 'bar-title', title: t('settings'), onclick: () => openSettings(this) }),
      undo: iconButton('↶', t('undo'), () => this.undo()),
      redo: iconButton('↷', t('redo'), () => this.redo()),
      status: h('span', { class: 'bar-status', role: 'status' }),
      hints: h('button', { class: 'action bar-hints', onclick: () => openHints(this) }),
    };
    this.map = new MapView(this);
    this.panel = h('aside', { class: 'panel' });
    this.shell = h(
      'div',
      { class: 'editor' },
      h(
        'header',
        { class: 'topbar' },
        h('a', { class: 'action bar-button', href: '#/', title: t('home'), 'aria-label': t('home') }, '🏠'),
        this.bar.title,
        this.bar.undo,
        this.bar.redo,
        this.bar.status,
        h('span', { class: 'bar-space' }),
        iconButton('🎒', t('items'), () => openItems(this)),
        iconButton('🔢', t('counters'), () => openCounters(this)),
        iconButton('🧙', t('heroTitle'), () => openHero(this)),
        this.bar.hints,
        iconButton('🗑', t('trash'), () => openTrash(this)),
        iconButton('🕘', t('versions'), () => void openVersions(this)),
        iconButton('⚙️', t('settings'), () => openSettings(this)),
        iconButton('⬇', t('export'), () => openExport(this)),
        h('button', { class: 'action primary bar-play', onclick: () => void openPreview(this) }, `▶ ${t('play')}`),
      ),
      h('div', { class: 'workspace' }, this.map.element, this.panel),
    );
  }

  private begin(page: string | undefined): void {
    this.root.replaceChildren(this.shell);
    this.selected = findPage(this.story, page)?.id;
    this.problems = validateStory(this.story);
    this.map.render();
    this.map.start();
    this.renderPanel();
    this.refreshBar();
    this.setStatus('saved');
    this.shell.classList.toggle('panel-open', this.selected !== undefined);

    const listen = <K extends keyof DocumentEventMap>(target: Document | Window | HTMLElement, type: K, handler: (event: DocumentEventMap[K]) => void) => {
      target.addEventListener(type, handler as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };
    listen(document, 'keydown', (event) => this.onKey(event));
    // Leaving or hiding the tab: write whatever is pending straight away.
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
    listen(window, 'pagehide' as keyof DocumentEventMap, () => void this.flush());
    // A picture pasted or dropped on the panel becomes the picture of the open page.
    listen(this.panel, 'paste', (event) => this.receiveImage(event, event.clipboardData));
    listen(this.panel, 'dragover', (event) => event.preventDefault());
    listen(this.panel, 'drop', (event) => this.receiveImage(event, event.dataTransfer));

    const timer = window.setInterval(() => void this.snapshot(), SNAPSHOT_EVERY_MS);
    this.cleanups.push(() => window.clearInterval(timer));
    void this.snapshot();
    void navigator.storage?.persist?.();

    void this.lock.lost.then(() => {
      // Another tab took over: stop saving so the two cannot overwrite each other.
      this.stopped = true;
      this.root.replaceChildren(h('main', { class: 'home' }, h('h1', null, this.t('lockLost')), h('a', { class: 'action', href: '#/' }, this.t('home'))));
    });
  }

  /** Stops the editor and writes pending changes. */
  async dispose(): Promise<void> {
    for (const cleanup of this.cleanups) cleanup();
    await this.flush();
    this.stopped = true;
    this.lock.release();
    for (const url of this.assets.values()) URL.revokeObjectURL(url);
  }

  // ---- EditorContext --------------------------------------------------------------

  get doc(): EditorDoc {
    return this.store.current;
  }

  get story(): Story {
    return this.store.current.story;
  }

  change(mutate: (doc: EditorDoc) => void, options?: ChangeOptions): void {
    if (!this.stopped) this.store.change(mutate, options);
  }

  select(pageId: PageId | undefined, options: { focus?: string; reveal?: boolean } = {}): void {
    this.selected = findPage(this.story, pageId)?.id;
    this.syncAddress();
    this.map.render();
    if (this.selected && options.reveal) this.map.reveal(this.selected);
    this.renderPanel(options.focus);
  }

  focusField(key: string): void {
    const element = this.panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  }

  label(page: Page): string {
    return pageLabel(page, this.t('emptyPage'));
  }

  assetUrl(path: string | undefined): string | undefined {
    return path === undefined ? undefined : this.assets.get(path);
  }

  async importImage(file: Blob): Promise<string | undefined> {
    const prepared = await prepareImage(file);
    if (!prepared) return undefined;
    const path = `images/${newId('img', this.assets.keys())}.${prepared.extension}`;
    await saveAsset(this.projectId, path, prepared.blob);
    this.assets.set(path, URL.createObjectURL(prepared.blob));
    return path;
  }

  flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    if (!this.dirty || this.stopped) return this.saving;
    this.dirty = false;
    const record: ProjectRecord = {
      ...this.record,
      doc: this.store.current,
      past: this.store.past,
      future: this.store.future,
      updatedAt: Date.now(),
    };
    this.saving = this.saving
      .then(() => saveProject(record))
      .then(
        () => {
          if (!this.dirty) this.setStatus('saved');
        },
        () => {
          // Keep the change marked as unsaved and try again shortly.
          this.dirty = true;
          this.setStatus('saveFailed');
          this.saveTimer = window.setTimeout(() => void this.flush(), 3000);
        },
      );
    return this.saving;
  }

  problemText(problem: Problem): string {
    const page = findPage(this.story, problem.pageId);
    return this.t(`hint_${problem.code}`, { page: page ? this.label(page) : '', ref: problem.ref ?? '' });
  }

  // ---- Internals ------------------------------------------------------------------

  private afterChange(quiet: boolean): void {
    if (this.selected && !findPage(this.story, this.selected)) {
      this.selected = undefined;
      this.syncAddress();
    }
    this.dirty = true;
    this.setStatus('saving');
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
    this.problems = validateStory(this.story);
    this.map.render();
    this.refreshBar();
    if (!quiet) this.renderPanel();
  }

  /** Keeps the address and the small-screen layout in step with the selected page. */
  private syncAddress(): void {
    const page = this.selected ? `/${encodeURIComponent(this.selected)}` : '';
    history.replaceState(null, '', `#/p/${encodeURIComponent(this.projectId)}${page}`);
    this.shell.classList.toggle('panel-open', this.selected !== undefined);
  }

  private undo(): void {
    if (!this.stopped) this.store.undo();
  }

  private redo(): void {
    if (!this.stopped) this.store.redo();
  }

  private onKey(event: KeyboardEvent): void {
    // Inside a dialog the keys keep their normal meaning for the field being edited.
    if (!(event.ctrlKey || event.metaKey) || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.redo();
    }
  }

  private async receiveImage(event: Event, data: DataTransfer | null): Promise<void> {
    const file = imageFrom(data);
    const pageId = this.selected;
    if (!file || !pageId) return;
    event.preventDefault();
    const path = await this.importImage(file);
    if (!path) return;
    this.change((doc) => {
      const page = findPage(doc.story, pageId);
      if (page) page.image = path;
    });
  }

  /** Rebuilds the page panel, keeping the cursor where it was (or putting it in `focus`). */
  private renderPanel(focus?: string): void {
    const active = document.activeElement;
    const inPanel = active instanceof HTMLElement && this.panel.contains(active);
    const key = focus ?? (inPanel ? active.dataset.key : undefined);
    const caret = !focus && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.type !== 'number' ? active.selectionStart : null;
    const scroll = this.panel.scrollTop;

    this.panel.replaceChildren(h('div', { class: 'panel-body' }, buildPanel(this)));
    for (const area of this.panel.querySelectorAll('textarea')) growToFit(area);
    this.panel.scrollTop = focus ? 0 : scroll;
    if (!key) return;
    this.focusField(key);
    const now = document.activeElement;
    if (caret !== null && (now instanceof HTMLInputElement || now instanceof HTMLTextAreaElement)) now.setSelectionRange(caret, caret);
  }

  private refreshBar(): void {
    const { t } = this;
    this.bar.title.textContent = this.story.title || t('untitled');
    document.title = `${this.story.title || t('untitled')} – ${t('appTitle')}`;
    (this.bar.undo as HTMLButtonElement).disabled = !this.store.canUndo;
    (this.bar.redo as HTMLButtonElement).disabled = !this.store.canRedo;
    const count = this.problems.length;
    this.bar.hints.textContent = count > 0 ? `⚠️ ${t('hints', { n: count })}` : '✅';
    this.bar.hints.title = count > 0 ? t('hintsTitle') : t('hintsNone');
    this.bar.hints.classList.toggle('has-hints', count > 0);
  }

  private setStatus(status: 'saving' | 'saved' | 'saveFailed'): void {
    this.bar.status.textContent = status === 'saved' ? `✓ ${this.t('saved')}` : this.t(status);
    this.bar.status.dataset.status = status;
  }

  /** Keeps a copy for "older versions" when the story changed since the last copy. */
  private async snapshot(): Promise<void> {
    if (this.stopped) return;
    const text = JSON.stringify(this.store.current);
    if (text === this.lastSnapshot) return;
    this.lastSnapshot = text;
    try {
      await addSnapshot(this.projectId, this.store.current);
    } catch {
      // Older versions are a convenience; failing to store one must not disturb editing.
    }
  }
}
