import { listSnapshots } from '../shared/db.ts';
import { h, openDialog } from '../shared/dom.ts';
import type { PageId } from '../shared/format/types.ts';
import type { EditorContext } from './context.ts';
import { restorePage } from './ops.ts';
import { field, growToFit, pictureField, select, textArea, textInput } from './panel.ts';

/** The editor's dialogs: story settings, hints, trash, older versions, and play-testing. */

function formatTime(ctx: EditorContext, time: number): string {
  return new Date(time).toLocaleString(ctx.language, { dateStyle: 'medium', timeStyle: 'short' });
}

function closeButton(ctx: EditorContext, dialog: HTMLDialogElement, text = ctx.t('close')): HTMLElement {
  return h('div', { class: 'dialog-buttons' }, h('button', { class: 'action primary', onclick: () => dialog.close() }, text));
}

export function openSettings(ctx: EditorContext): void {
  const { t } = ctx;
  const dialog = openDialog('dialog', () => []);
  const body = dialog.firstElementChild!;
  // Typing changes the story at once; nothing here needs a "save" button.
  const typing = (name: string) => ({ merge: `story-${name}`, quiet: true });
  const fill = () => {
    const story = ctx.story;
    const description = textArea(story.description ?? '', { 'data-key': 'story-description' }, (value) =>
      ctx.change((doc) => void (doc.story.description = value), typing('description')),
    );
    body.replaceChildren(
      h('h2', null, t('settings')),
      field(t('storyTitle'), textInput(story.title, {}, (value) => ctx.change((doc) => void (doc.story.title = value), typing('title')))),
      field(t('author'), textInput(story.author ?? '', {}, (value) => ctx.change((doc) => void (doc.story.author = value), typing('author')))),
      field(t('description'), description),
      h(
        'div',
        { class: 'number-row' },
        field(
          t('storyLanguage'),
          select(
            [
              { value: 'cs', label: t('languageCs') },
              { value: 'en', label: t('languageEn') },
            ],
            story.language,
            'story-language',
            (value) => ctx.change((doc) => void (doc.story.language = value), { quiet: true }),
          ),
        ),
        field(
          t('style'),
          select(
            [
              { value: 'fantasy', label: t('styleFantasy') },
              { value: 'neutral', label: t('styleNeutral') },
              { value: 'scifi', label: t('styleScifi') },
            ],
            story.theme ?? 'fantasy',
            'story-theme',
            (value) => ctx.change((doc) => void (doc.story.theme = value), { quiet: true }),
          ),
        ),
      ),
      h(
        'section',
        { class: 'section' },
        h('h3', null, t('cover')),
        pictureField(ctx, story.cover, (path) => {
          ctx.change(
            (doc) => {
              if (path) doc.story.cover = path;
              else delete doc.story.cover;
            },
            { quiet: true },
          );
          fill();
        }),
      ),
      closeButton(ctx, dialog, t('done')),
    );
    growToFit(description);
  };
  fill();
}

export function openHints(ctx: EditorContext): void {
  const { t } = ctx;
  const pageName = (id: PageId | undefined) => ctx.story.pages.find((page) => page.id === id);
  openDialog('dialog', (dialog) => [
    h('h2', null, t('hintsTitle')),
    ctx.problems.length === 0
      ? h('p', null, `✅ ${t('hintsNone')}`)
      : h(
          'ul',
          { class: 'list' },
          ctx.problems.map((problem) => {
            const page = pageName(problem.pageId);
            const text = `⚠️ ${ctx.problemText(problem)}`;
            // A hint about a page is a button that opens the page.
            return h(
              'li',
              null,
              page
                ? h(
                    'button',
                    {
                      class: 'action',
                      onclick: () => {
                        dialog.close();
                        ctx.select(page.id, { reveal: true });
                      },
                    },
                    text,
                  )
                : h('p', null, text),
            );
          }),
        ),
    closeButton(ctx, dialog),
  ]);
}

export function openTrash(ctx: EditorContext): void {
  const { t } = ctx;
  const dialog = openDialog('dialog', () => []);
  const body = dialog.firstElementChild!;
  const fill = () => {
    const trash = ctx.doc.trash;
    body.replaceChildren(
      h('h2', null, `🗑 ${t('trash')}`),
      h('p', { class: 'field-note' }, trash.length === 0 ? t('trashEmpty') : t('trashIntro')),
      h(
        'ul',
        { class: 'list' },
        trash.map((entry, index) =>
          h(
            'li',
            { class: 'row' },
            h('div', { class: 'row-text' }, h('strong', null, ctx.label(entry.page)), h('small', null, t('deletedWhen', { when: formatTime(ctx, entry.deletedAt) }))),
            h(
              'button',
              {
                class: 'action',
                onclick: () => {
                  let restored: PageId | undefined;
                  ctx.change((doc) => void (restored = restorePage(doc, index)?.id));
                  if (restored) ctx.select(restored, { reveal: true });
                  fill();
                },
              },
              t('putBack'),
            ),
          ),
        ),
      ),
      closeButton(ctx, dialog),
    );
  };
  fill();
}

export async function openVersions(ctx: EditorContext): Promise<void> {
  const { t } = ctx;
  const snapshots = (await listSnapshots(ctx.projectId)).reverse();
  openDialog('dialog', (dialog) => [
    h('h2', null, `🕘 ${t('versions')}`),
    h('p', { class: 'field-note' }, snapshots.length === 0 ? t('versionsNone') : t('versionsIntro')),
    h(
      'ul',
      { class: 'list' },
      snapshots.map((snapshot) =>
        h(
          'li',
          { class: 'row' },
          h(
            'div',
            { class: 'row-text' },
            h('strong', null, formatTime(ctx, snapshot.time)),
            h('small', null, t('pagesCount', { n: snapshot.doc.story.pages.length })),
          ),
          h(
            'button',
            {
              class: 'action',
              onclick: () => {
                // Going back is an ordinary change, so Undo returns to the present.
                ctx.change((doc) => {
                  doc.story = structuredClone(snapshot.doc.story);
                  doc.trash = structuredClone(snapshot.doc.trash);
                });
                dialog.close();
              },
            },
            t('restoreVersion'),
          ),
        ),
      ),
    ),
    closeButton(ctx, dialog),
  ]);
}

/** Plays the story in the real player, next to the editor. Test games are not saved. */
export async function openPreview(ctx: EditorContext): Promise<void> {
  const { t } = ctx;
  // The player reads the project from storage, so pending changes must be written first.
  await ctx.flush();
  const frame = h('iframe', { class: 'preview-frame', title: t('play') });
  const load = (fromPage?: PageId) => {
    const query = new URLSearchParams({ preview: ctx.projectId, v: String(Date.now()) });
    if (fromPage) query.set('page', fromPage);
    frame.src = `index.html?${query}`;
  };
  const selected = ctx.selected;
  openDialog('dialog preview', (dialog) => [
    h(
      'div',
      { class: 'preview-bar' },
      h('button', { class: 'action', onclick: () => load() }, `▶ ${t('playFromStart')}`),
      selected && h('button', { class: 'action', onclick: () => load(selected) }, `▶ ${t('playFromHere')}`),
      h('button', { class: 'action primary', onclick: () => dialog.close() }, t('close')),
    ),
    frame,
  ]);
  load(selected);
}
