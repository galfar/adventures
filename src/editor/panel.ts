import type { EditorDoc } from '../shared/db.ts';
import { h } from '../shared/dom.ts';
import type { Action, Page, PageId } from '../shared/format/types.ts';
import type { EditorContext } from './context.ts';
import { addAction, addPage, deletePage, findPage, moveAction, spotNear } from './ops.ts';
import type { ChangeOptions } from './store.ts';

/**
 * The page panel: the form for the selected page. It is rebuilt from the story whenever
 * the page or its structure changes; plain typing does not rebuild it (see `quiet`).
 * Fields carry a `data-key` so the cursor can be put back after a rebuild.
 */

type Child = Node | string | false | undefined | null;

export function textInput(value: string, props: Record<string, string>, onInput: (value: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', ...props, oninput: () => onInput(input.value) });
  input.value = value;
  return input;
}

export function textArea(value: string, props: Record<string, string>, onInput: (value: string) => void): HTMLTextAreaElement {
  const area = h('textarea', {
    rows: 3,
    ...props,
    oninput: () => {
      growToFit(area);
      onInput(area.value);
    },
  });
  area.value = value;
  return area;
}

/** Makes a text area as tall as its text. Call again once it is on the page. */
export function growToFit(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

export function numberInput(value: number, key: string, min: number, max: number, onInput: (value: number) => void): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    inputmode: 'numeric',
    min,
    max,
    'data-key': key,
    oninput: () => {
      const number = Math.round(Number(input.value));
      if (input.value !== '' && Number.isFinite(number)) onInput(Math.min(max, Math.max(min, number)));
    },
  });
  input.value = String(value);
  return input;
}

export function select(options: { value: string; label: string }[], current: string, key: string, onPick: (value: string) => void): HTMLSelectElement {
  const element = h(
    'select',
    { 'data-key': key, onchange: () => onPick(element.value) },
    options.map((option) => h('option', { value: option.value }, option.label)),
  );
  element.value = current;
  return element;
}

export function field(label: string, ...controls: Child[]): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), controls);
}

/** A picture with "choose / change / remove". `onSet` receives the stored picture's path. */
export function pictureField(ctx: EditorContext, current: string | undefined, onSet: (path: string | undefined) => void): HTMLElement {
  const { t } = ctx;
  const url = ctx.assetUrl(current);
  const error = h('p', { class: 'field-error', role: 'alert' });
  const fileInput = h('input', {
    class: 'file-input',
    type: 'file',
    accept: 'image/*',
    tabindex: -1,
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const path = await ctx.importImage(file);
      if (path) onSet(path);
      else error.textContent = t('pictureFailed');
    },
  });
  return h(
    'div',
    { class: 'picture' },
    url && h('img', { class: 'picture-thumb', src: url, alt: '' }),
    h(
      'div',
      { class: 'picture-buttons' },
      h('button', { class: 'action', type: 'button', onclick: () => fileInput.click() }, url ? t('changePicture') : `🖼️ ${t('choosePicture')}`),
      current && h('button', { class: 'action', type: 'button', onclick: () => onSet(undefined) }, t('removePicture')),
    ),
    fileInput,
    error,
  );
}

export function buildPanel(ctx: EditorContext): Child[] {
  const { t } = ctx;
  const story = ctx.story;
  const page = findPage(story, ctx.selected);
  if (!page) {
    return [
      h('h2', null, t('panelEmptyTitle')),
      h('ul', { class: 'tips' }, [t('tipSelect'), t('tipConnect'), t('tipNew'), t('tipSafe')].map((tip) => h('li', null, tip))),
    ];
  }
  const id = page.id;

  /** Changes this page (looked up again in the document copy). */
  const edit = (mutate: (page: Page, doc: EditorDoc) => void, options?: ChangeOptions) =>
    ctx.change((doc) => {
      const target = findPage(doc.story, id);
      if (target) mutate(target, doc);
    }, options);
  /** For text fields: one undo step per burst of typing, and no rebuild of this form. */
  const typing = (name: string): ChangeOptions => ({ merge: `${name}:${id}`, quiet: true });

  /**
   * A list of pages to lead to. `none` is what "no page" means in this place;
   * "a new page" creates one next to this page and links to it.
   */
  const targetSelect = (current: PageId | undefined, none: string, key: string, pick: (page: Page, target: PageId | undefined) => void) => {
    const options = [
      { value: '', label: none },
      ...story.pages.map((p) => ({ value: p.id, label: ctx.label(p) })),
      { value: '+', label: t('targetNew') },
    ];
    if (current !== undefined && !findPage(story, current)) options.push({ value: current, label: t('targetMissing') });
    return select(options, current ?? '', key, (value) =>
      edit((target, doc) => {
        if (value === '+') pick(target, addPage(doc, spotNear(doc.story, target)).id);
        else pick(target, value === '' ? undefined : value);
      }),
    );
  };

  const choice = (action: Action, index: number) => {
    const editAction = (mutate: (action: Action) => void, options?: ChangeOptions) =>
      edit((p) => {
        const target = p.actions.find((a) => a.id === action.id);
        if (target) mutate(target);
      }, options);
    const hasRules = !!(action.when || action.effects?.length || action.once || action.lockedHint);
    const toolButton = (text: string, label: string, disabled: boolean, run: () => void) =>
      h('button', { class: 'tool', type: 'button', title: label, 'aria-label': label, disabled, onclick: run }, text);
    return h(
      'div',
      { class: 'choice' },
      h(
        'div',
        { class: 'choice-main' },
        textInput(action.label, { placeholder: t('choicePlaceholder'), 'data-key': `action-label:${action.id}`, 'aria-label': t('choices') }, (value) =>
          editAction((a) => void (a.label = value), typing(`action:${action.id}`)),
        ),
        h(
          'label',
          { class: 'choice-target' },
          h('span', null, t('leadsTo')),
          targetSelect(action.target, t('targetStay'), `action-target:${action.id}`, (p, target) => {
            const a = p.actions.find((x) => x.id === action.id);
            if (!a) return;
            if (target === undefined) delete a.target;
            else a.target = target;
          }),
        ),
        hasRules && h('span', { class: 'chip', title: t('hasRulesTitle') }, `◆ ${t('hasRules')}`),
      ),
      h(
        'div',
        { class: 'choice-tools' },
        toolButton('▲', t('moveUp'), index === 0, () => ctx.change((doc) => moveAction(doc, id, action.id, -1))),
        toolButton('▼', t('moveDown'), index === page.actions.length - 1, () => ctx.change((doc) => moveAction(doc, id, action.id, 1))),
        toolButton('🗑', t('deleteChoice'), false, () => edit((p) => void (p.actions = p.actions.filter((a) => a.id !== action.id)))),
      ),
    );
  };

  const combat = page.combat;
  const fight = combat
    ? [
        field(
          t('enemyName'),
          textInput(combat.enemy.name, { placeholder: t('enemyNamePlaceholder'), 'data-key': 'enemy-name' }, (value) =>
            edit((p) => void (p.combat!.enemy.name = value), typing('enemy')),
          ),
        ),
        h(
          'div',
          { class: 'number-row' },
          (['hp', 'attack', 'defense'] as const).map((stat) =>
            field(
              `${{ hp: '❤️', attack: '⚔️', defense: '🛡️' }[stat]} ${t(stat)}`,
              numberInput(combat.enemy[stat], `enemy-${stat}`, stat === 'hp' ? 1 : 0, 999, (value) =>
                edit((p) => void (p.combat!.enemy[stat] = value), typing(`enemy-${stat}`)),
              ),
            ),
          ),
        ),
        pictureField(ctx, combat.enemy.image, (path) =>
          edit((p) => {
            if (path) p.combat!.enemy.image = path;
            else delete p.combat!.enemy.image;
          }),
        ),
        field(
          t('afterWin'),
          targetSelect(combat.onWin?.target, t('winStay'), 'fight-win', (p, target) => void (p.combat!.onWin = { ...p.combat!.onWin, target })),
        ),
        field(
          t('afterLose'),
          targetSelect(combat.onLose?.target, t('loseGameOver'), 'fight-lose', (p, target) => void (p.combat!.onLose = { ...p.combat!.onLose, target })),
        ),
        field(
          t('runAway'),
          targetSelect(combat.flee?.target, t('fleeNone'), 'fight-flee', (p, target) => {
            if (target === undefined) delete p.combat!.flee;
            else p.combat!.flee = { ...p.combat!.flee, target };
          }),
        ),
        h('button', { class: 'action', type: 'button', onclick: () => edit((p) => void delete p.combat) }, t('removeFight')),
      ]
    : [
        h(
          'button',
          {
            class: 'action',
            type: 'button',
            onclick: () => {
              edit((p) => void (p.combat = { enemy: { name: '', hp: 8, attack: 2, defense: 1 } }));
              ctx.focusField('enemy-name');
            },
          },
          `⚔️ ${t('addFight')}`,
        ),
      ];

  // Things made outside this editor that cannot be edited here yet must stay visible.
  const later = [page.extraTexts?.length && t('extraTexts'), (page.onFirstVisit?.length || page.onEveryVisit?.length) && t('arrivalEffects')].filter(
    (name): name is string => !!name,
  );
  const isStart = story.startPage === id;
  const onlyPage = story.pages.length <= 1;

  return [
    h('button', { class: 'action back-to-map', type: 'button', onclick: () => ctx.select(undefined) }, `← ${t('backToMap')}`),
    field(
      t('pageTitle'),
      textInput(page.title ?? '', { placeholder: t('pageTitlePlaceholder'), 'data-key': 'title' }, (value) =>
        edit((p) => {
          if (value) p.title = value;
          else delete p.title;
        }, typing('title')),
      ),
    ),
    field(
      t('pageText'),
      textArea(page.text, { placeholder: t('pageTextPlaceholder'), 'data-key': 'text', rows: '5' }, (value) => edit((p) => void (p.text = value), typing('text'))),
    ),
    h(
      'section',
      { class: 'section' },
      h('h3', null, t('picture')),
      pictureField(ctx, page.image, (path) =>
        edit((p) => {
          if (path) p.image = path;
          else delete p.image;
        }),
      ),
      !page.image && h('p', { class: 'field-note' }, t('pictureHint')),
    ),
    h(
      'section',
      { class: 'section' },
      h('h3', null, t('choices')),
      page.actions.map(choice),
      h(
        'button',
        {
          class: 'action primary',
          type: 'button',
          onclick: () => {
            let created: string | undefined;
            ctx.change((doc) => void (created = addAction(doc, id)?.id));
            if (created) ctx.focusField(`action-label:${created}`);
          },
        },
        `＋ ${t('addChoice')}`,
      ),
    ),
    h('section', { class: 'section' }, h('h3', null, t('fight')), fight),
    h(
      'section',
      { class: 'section' },
      field(
        t('pageKind'),
        select(
          [
            { value: '', label: t('kindNormal') },
            { value: 'victory', label: `🏆 ${t('kindVictory')}` },
            { value: 'defeat', label: `💀 ${t('kindDefeat')}` },
            { value: 'neutral', label: `🔚 ${t('kindNeutral')}` },
          ],
          page.ending ?? '',
          'kind',
          (value) =>
            edit((p) => {
              if (value) p.ending = value as Page['ending'];
              else delete p.ending;
            }),
        ),
      ),
      isStart
        ? h('p', { class: 'field-note' }, `🚩 ${t('isStart')}`)
        : h('button', { class: 'action', type: 'button', onclick: () => ctx.change((doc) => void (doc.story.startPage = id)) }, `🚩 ${t('makeStart')}`),
      later.length > 0 && h('p', { class: 'field-note' }, `◆ ${t('extraNote', { what: later.join(', ') })}`),
    ),
    h(
      'section',
      { class: 'section' },
      h(
        'button',
        { class: 'action danger', type: 'button', disabled: onlyPage, title: onlyPage ? t('lastPage') : '', onclick: () => ctx.change((doc) => void deletePage(doc, id)) },
        `🗑 ${t('deletePage')}`,
      ),
    ),
  ];
}
