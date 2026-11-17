import type { EditorDoc } from '../shared/db.ts';
import { h, openDialog } from '../shared/dom.ts';
import type { CounterDef, ItemDef, Profession, StartingKit } from '../shared/format/types.ts';
import type { EditorContext } from './context.ts';
import { newId } from './ops.ts';
import { checkbox, field, growToFit, numberInput, pictureField, rulesButton, select, textArea, textInput } from './panel.ts';
import type { ChangeOptions } from './store.ts';

/**
 * Dialogs for the story's lists: items, counters, and the hero with professions.
 * Like everywhere in the editor, typing changes the story at once; there is no "save".
 * Each dialog is redrawn (`fill`) after a change to its structure, such as adding a row.
 */

const STATS = ['hp', 'attack', 'defense'] as const;
const STAT_ICON = { hp: '❤️', attack: '⚔️', defense: '🛡️' };

/** A dialog whose contents are rebuilt by `build`, which receives the redraw function. */
function listDialog(build: (redraw: () => void, dialog: HTMLDialogElement) => (Node | string | false | undefined)[]): void {
  const dialog = openDialog('dialog wide', () => []);
  const body = dialog.firstElementChild!;
  const redraw = () => {
    const scroll = dialog.scrollTop;
    body.replaceChildren(...build(redraw, dialog).filter((child): child is Node | string => !!child));
    for (const area of body.querySelectorAll('textarea')) growToFit(area);
    dialog.scrollTop = scroll;
  };
  redraw();
}

const doneButton = (ctx: EditorContext, dialog: HTMLDialogElement) =>
  h('div', { class: 'dialog-buttons' }, h('button', { class: 'action primary', onclick: () => dialog.close() }, ctx.t('done')));

const deleteButton = (label: string, run: () => void) => h('button', { class: 'tool', type: 'button', title: label, 'aria-label': label, onclick: run }, '🗑');

// ---- Items --------------------------------------------------------------------------

export function openItems(ctx: EditorContext): void {
  const { t } = ctx;
  listDialog((redraw, dialog) => {
    const card = (item: ItemDef) => {
      const edit = (mutate: (item: ItemDef) => void, options?: ChangeOptions) =>
        ctx.change((doc) => {
          const target = doc.story.items.find((i) => i.id === item.id);
          if (target) mutate(target);
        }, options);
      const typing = (name: string): ChangeOptions => ({ merge: `item-${name}:${item.id}`, quiet: true });
      const bonus = (stat: 'attack' | 'defense') =>
        field(
          `${STAT_ICON[stat]} ${t(stat === 'attack' ? 'bonusAttack' : 'bonusDefense')}`,
          numberInput(item.bonus?.[stat] ?? 0, `item-${stat}:${item.id}`, -99, 99, (value) =>
            edit((i) => {
              const next = { ...i.bonus, [stat]: value };
              if (!next[stat]) delete next[stat];
              if (Object.keys(next).length > 0) i.bonus = next;
              else delete i.bonus;
            }, typing(stat)),
          ),
        );
      return h(
        'li',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          textInput(item.name, { placeholder: t('itemNamePlaceholder'), 'aria-label': t('itemName'), 'data-key': `item-name:${item.id}` }, (value) =>
            edit((i) => void (i.name = value), typing('name')),
          ),
          deleteButton(t('deleteItem'), () => {
            ctx.change((doc) => void (doc.story.items = doc.story.items.filter((i) => i.id !== item.id)));
            redraw();
          }),
        ),
        textInput(item.description ?? '', { placeholder: t('itemDescription'), 'aria-label': t('itemDescription') }, (value) =>
          edit((i) => {
            if (value) i.description = value;
            else delete i.description;
          }, typing('description')),
        ),
        h('div', { class: 'number-row' }, bonus('attack'), bonus('defense')),
        checkbox(t('usable'), !!item.use, (on) => {
          edit((i) => {
            if (on) i.use = { effects: [] };
            else delete i.use;
          });
          redraw();
        }),
        item.use &&
          h(
            'div',
            { class: 'button-row' },
            rulesButton(
              ctx,
              t('whenUsed'),
              item.use.effects.length,
              () => ({
                title: `${item.name || t('unnamed')}: ${t('whenUsed')}`,
                kind: 'effects',
                mergeKey: `rules:item:${item.id}`,
                read: (doc) => {
                  const use = doc.story.items.find((i) => i.id === item.id)?.use;
                  return use ? { effects: use.effects } : undefined;
                },
                write: (doc, rule) => {
                  const use = doc.story.items.find((i) => i.id === item.id)?.use;
                  if (use) use.effects = rule.effects ?? [];
                },
              }),
              redraw,
            ),
            checkbox(t('usedUp'), item.use.consumed !== false, (on) =>
              edit((i) => {
                if (!i.use) return;
                if (on) delete i.use.consumed;
                else i.use.consumed = false;
              }, { quiet: true }),
            ),
          ),
        pictureField(ctx, item.image, (path) => {
          edit((i) => {
            if (path) i.image = path;
            else delete i.image;
          });
          redraw();
        }),
      );
    };
    return [
      h('h2', null, `🎒 ${t('items')}`),
      h('p', { class: 'field-note' }, ctx.story.items.length === 0 ? t('noItems') : t('itemsHelp')),
      h('ul', { class: 'cards' }, ctx.story.items.map(card)),
      h(
        'button',
        {
          class: 'action primary',
          onclick: () => {
            const id = newId(
              'item',
              ctx.story.items.map((i) => i.id),
            );
            ctx.change((doc) => void doc.story.items.push({ id, name: '' }));
            redraw();
            dialog.querySelector<HTMLElement>(`[data-key="item-name:${id}"]`)?.focus();
          },
        },
        `＋ ${t('addItem')}`,
      ),
      doneButton(ctx, dialog),
    ];
  });
}

// ---- Counters -----------------------------------------------------------------------

export function openCounters(ctx: EditorContext): void {
  const { t } = ctx;
  listDialog((redraw, dialog) => {
    const card = (counter: CounterDef) => {
      const edit = (mutate: (counter: CounterDef) => void, options?: ChangeOptions) =>
        ctx.change((doc) => {
          const target = doc.story.counters.find((c) => c.id === counter.id);
          if (target) mutate(target);
        }, options);
      const typing = (name: string): ChangeOptions => ({ merge: `counter-${name}:${counter.id}`, quiet: true });
      return h(
        'li',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          textInput(counter.name, { placeholder: t('counterNamePlaceholder'), 'aria-label': t('counterName'), 'data-key': `counter-name:${counter.id}` }, (value) =>
            edit((c) => void (c.name = value), typing('name')),
          ),
          deleteButton(t('deleteCounter'), () => {
            ctx.change((doc) => void (doc.story.counters = doc.story.counters.filter((c) => c.id !== counter.id)));
            redraw();
          }),
        ),
        h(
          'div',
          { class: 'number-row' },
          field(
            t('counterStart'),
            numberInput(counter.start, `counter-start:${counter.id}`, -9999, 9999, (value) => edit((c) => void (c.start = value), typing('start'))),
          ),
          field(
            t('counterIcon'),
            textInput(counter.icon ?? '', { placeholder: '💰', maxlength: '4' }, (value) =>
              edit((c) => {
                if (value) c.icon = value;
                else delete c.icon;
              }, typing('icon')),
            ),
          ),
        ),
        checkbox(t('counterShow'), !!counter.show, (on) =>
          edit((c) => {
            if (on) c.show = true;
            else delete c.show;
          }, { quiet: true }),
        ),
        checkbox(t('counterNotBelowZero'), counter.min === 0, (on) =>
          edit((c) => {
            if (on) c.min = 0;
            else delete c.min;
          }, { quiet: true }),
        ),
      );
    };
    return [
      h('h2', null, `🔢 ${t('counters')}`),
      h('p', { class: 'field-note' }, ctx.story.counters.length === 0 ? t('noCounters') : t('countersHelp')),
      h('ul', { class: 'cards' }, ctx.story.counters.map(card)),
      h(
        'button',
        {
          class: 'action primary',
          onclick: () => {
            const id = newId(
              'counter',
              ctx.story.counters.map((c) => c.id),
            );
            ctx.change((doc) => void doc.story.counters.push({ id, name: '', start: 0, min: 0, show: true }));
            redraw();
            dialog.querySelector<HTMLElement>(`[data-key="counter-name:${id}"]`)?.focus();
          },
        },
        `＋ ${t('addCounter')}`,
      ),
      doneButton(ctx, dialog),
    ];
  });
}

// ---- Hero and professions -----------------------------------------------------------

export function openHero(ctx: EditorContext): void {
  const { t } = ctx;
  listDialog((redraw, dialog) => {
    const story = ctx.story;
    const itemOptions = story.items.map((item) => ({ value: item.id, label: item.name || t('unnamed') }));

    /**
     * The form for one starting kit: numbers, the items the hero always has, and the
     * items the player may pick from. `find` locates the kit in a document copy.
     */
    const kitForm = (kit: StartingKit, key: string, find: (doc: EditorDoc) => StartingKit | undefined) => {
      const edit = (mutate: (kit: StartingKit) => void, options?: ChangeOptions) =>
        ctx.change((doc) => {
          const target = find(doc);
          if (target) mutate(target);
        }, options);
      const offered = kit.choose?.from ?? [];
      return [
        h(
          'div',
          { class: 'number-row' },
          STATS.map((stat) =>
            field(
              `${STAT_ICON[stat]} ${t(stat)}`,
              numberInput(kit.stats[stat], `${key}-${stat}`, stat === 'hp' ? 1 : 0, 999, (value) =>
                edit((k) => void (k.stats[stat] = value), { merge: `${key}-${stat}`, quiet: true }),
              ),
            ),
          ),
        ),
        h('h4', null, t('startItems')),
        itemOptions.length === 0 && h('p', { class: 'field-note' }, t('needItemsFirst')),
        (kit.items ?? []).map((grant, index) =>
          h(
            'div',
            { class: 'grant' },
            numberInput(grant.count ?? 1, `${key}-count-${index}`, 1, 99, (value) =>
              edit((k) => void (k.items![index]!.count = value), { merge: `${key}-count-${index}`, quiet: true }),
            ),
            h('span', null, '×'),
            select(
              // An item that was deleted stays listed, so the form shows what the story really says.
              itemOptions.some((o) => o.value === grant.item) ? itemOptions : [...itemOptions, { value: grant.item, label: t('bDeleted') }],
              grant.item,
              `${key}-item-${index}`,
              (value) => edit((k) => void (k.items![index]!.item = value), { quiet: true }),
            ),
            deleteButton(t('deleteItem'), () => {
              edit((k) => void k.items!.splice(index, 1));
              redraw();
            }),
          ),
        ),
        itemOptions.length > 0 &&
          h(
            'button',
            {
              class: 'action',
              onclick: () => {
                edit((k) => void (k.items ??= []).push({ item: itemOptions[0]!.value }));
                redraw();
              },
            },
            `＋ ${t('addStartItem')}`,
          ),
        itemOptions.length > 0 && h('h4', null, t('choosePick')),
        itemOptions.length > 0 &&
          h(
            'div',
            { class: 'choose' },
            field(
              t('chooseCount'),
              numberInput(kit.choose?.count ?? 0, `${key}-choose`, 0, 20, (value) =>
                edit((k) => {
                  if (value === 0 && !k.choose?.from.length) delete k.choose;
                  else k.choose = { count: value, from: k.choose?.from ?? [] };
                }, { merge: `${key}-choose`, quiet: true }),
              ),
            ),
            h(
              'div',
              { class: 'checks' },
              itemOptions.map((option) =>
                checkbox(option.label, offered.includes(option.value), (on) =>
                  edit((k) => {
                    const from = (k.choose?.from ?? []).filter((id) => id !== option.value);
                    if (on) from.push(option.value);
                    k.choose = { count: k.choose?.count || 1, from };
                    redraw();
                  }, { quiet: true }),
                ),
              ),
            ),
          ),
      ];
    };

    const professionCard = (profession: Profession) => {
      const find = (doc: EditorDoc) => doc.story.professions.find((p) => p.id === profession.id);
      const edit = (mutate: (profession: Profession) => void, options?: ChangeOptions) =>
        ctx.change((doc) => {
          const target = find(doc);
          if (target) mutate(target);
        }, options);
      return h(
        'li',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          textInput(profession.name, { placeholder: t('professionNamePlaceholder'), 'aria-label': t('professionName'), 'data-key': `profession-name:${profession.id}` }, (value) =>
            edit((p) => void (p.name = value), { merge: `profession-name:${profession.id}`, quiet: true }),
          ),
          deleteButton(t('deleteProfession'), () => {
            ctx.change((doc) => void (doc.story.professions = doc.story.professions.filter((p) => p.id !== profession.id)));
            redraw();
          }),
        ),
        textArea(profession.description ?? '', { placeholder: t('professionDescription'), 'aria-label': t('professionDescription'), rows: '2' }, (value) =>
          edit((p) => {
            if (value) p.description = value;
            else delete p.description;
          }, { merge: `profession-description:${profession.id}`, quiet: true }),
        ),
        kitForm(profession, `profession-${profession.id}`, find),
      );
    };

    return [
      h('h2', null, `🧙 ${t('heroTitle')}`),
      h('p', { class: 'field-note' }, t('professionsHelp')),
      // With professions the plain hero is not used by the player, so it is not shown.
      story.professions.length === 0 &&
        h(
          'div',
          { class: 'card' },
          h('h3', null, t('heroStats')),
          kitForm(story.hero, 'hero', (doc) => doc.story.hero),
        ),
      h('ul', { class: 'cards' }, story.professions.map(professionCard)),
      h(
        'button',
        {
          class: 'action primary',
          onclick: () => {
            const id = newId(
              'prof',
              story.professions.map((p) => p.id),
            );
            // A new profession starts as a copy of the hero's numbers and items.
            ctx.change((doc) => void doc.story.professions.push({ ...structuredClone(doc.story.hero), id, name: '' }));
            redraw();
            dialog.querySelector<HTMLElement>(`[data-key="profession-name:${id}"]`)?.focus();
          },
        },
        `＋ ${t('addProfession')}`,
      ),
      doneButton(ctx, dialog),
    ];
  });
}
