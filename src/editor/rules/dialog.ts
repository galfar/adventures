import type { EditorDoc } from '../../shared/db.ts';
import { h } from '../../shared/dom.ts';
import type { EditorContext } from '../context.ts';
import { defineBlocks, setLists, toolbox, type Lists, type Option } from './blocks.ts';
import { ruleRefs, ruleToWorkspace, workspaceToRule, type Rule, type RuleKind, type WorkspaceState } from './convert.ts';
import { ruleToText, type TextNames } from './text.ts';
import { canPasteRules, combineRules } from '../ops.ts';

/**
 * The block editor: a full-screen dialog with one Blockly workspace for one rule
 * (the rules of a choice, a list of effects, or a condition).
 *
 * Blockly is large, so it is loaded only when the first rule is opened.
 */

export interface RuleTarget {
  /** Shown at the top: what is being edited. */
  title: string;
  kind: RuleKind;
  /** Finds the rule in a document; undefined when its owner no longer exists. */
  read(doc: EditorDoc): Rule | undefined;
  write(doc: EditorDoc, rule: Rule): void;
  /** Ordinary form fields shown above the blocks (e.g. "only once" for a choice). */
  extra?: HTMLElement[];
  /** Groups the block changes of this rule into undo steps. */
  mergeKey: string;
}

/** One dialog element is reused for every rule. */
let host: HTMLDialogElement | undefined;
/** The part of the dialog that is rebuilt for each rule. */
const content = h('div', { class: 'rules-content' });

function buildLists(ctx: EditorContext, rule: Rule): Lists {
  const { t } = ctx;
  const story = ctx.story;
  const refs = ruleRefs(rule);
  /** The story's things, plus anything the rule still refers to that has been deleted. */
  const withDeleted = (known: Option[], used: Set<string>): Option[] => [
    ...known,
    ...[...used].filter((id) => id !== '' && !known.some(([, value]) => value === id)).map((id): Option => [t('bDeleted'), id]),
  ];
  const items = withDeleted(
    story.items.map((item): Option => [item.name || t('unnamed'), item.id]),
    refs.items,
  );
  const counters = withDeleted(
    story.counters.map((counter): Option => [counter.name || t('unnamed'), counter.id]),
    refs.counters,
  );
  return {
    items,
    counters,
    pages: withDeleted(
      story.pages.map((page): Option => [ctx.label(page), page.id]),
      refs.pages,
    ),
    actions: withDeleted(
      story.pages.flatMap((page) => page.actions.map((action): Option => [`${ctx.label(page)}: ${action.label || '?'}`, action.id])),
      refs.actions,
    ),
    professions: withDeleted(
      story.professions.map((profession): Option => [profession.name || t('unnamed'), profession.id]),
      refs.professions,
    ),
    values: [
      [t('hp'), 'stat:hp'],
      [t('maxHp'), 'stat:maxHp'],
      [t('attack'), 'stat:attack'],
      [t('defense'), 'stat:defense'],
      ...counters.map(([name, id]): Option => [name, `counter:${id}`]),
      ...items.map(([name, id]): Option => [t('bCountOf', { name }), `item:${id}`]),
    ],
  };
}

const CLIPBOARD_KEY = 'adventures.editor.rulesClipboard';

interface Clip {
  /** Where the rules were copied from, shown when pasting. */
  title: string;
  rule: Rule;
}

/** Copied rules live in the browser, so they can be pasted into any rule, even after a reload. */
let memoryClip: Clip | undefined;

function writeClipboard(clip: Clip): void {
  memoryClip = structuredClone(clip);
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clip));
  } catch {
    // Kept in memory only.
  }
}

function readClipboard(): Clip | undefined {
  try {
    const stored = localStorage.getItem(CLIPBOARD_KEY);
    if (stored) {
      const clip = JSON.parse(stored) as Clip;
      if (clip && typeof clip.title === 'string' && clip.rule && typeof clip.rule === 'object') return clip;
    }
  } catch {
    // Fall back to memory.
  }
  return memoryClip;
}

const TEXT_VIEW_KEY = 'adventures.editor.rulesText';

/** Whether the text view is open. Remembered, so authors who like it keep it. */
function textViewOpen(): boolean {
  try {
    return localStorage.getItem(TEXT_VIEW_KEY) === 'open';
  } catch {
    return false;
  }
}

function setTextViewOpen(open: boolean): void {
  try {
    localStorage.setItem(TEXT_VIEW_KEY, open ? 'open' : 'closed');
  } catch {
    // The choice just will not be remembered.
  }
}

/** The side panel showing the rule as read-only text (see `text.ts`). */
function buildTextPane(ctx: EditorContext, kind: RuleKind): { pane: HTMLElement; show(rule: Rule): void } {
  const { t } = ctx;
  const story = ctx.story;
  const find = <T extends { id: string }>(list: T[], name: (thing: T) => string) => (id: string) => {
    const thing = list.find((entry) => entry.id === id);
    return thing ? name(thing) : undefined;
  };
  const names: TextNames = {
    item: find(story.items, (item) => item.name || t('unnamed')),
    counter: find(story.counters, (counter) => counter.name || t('unnamed')),
    profession: find(story.professions, (profession) => profession.name || t('unnamed')),
    page: find(story.pages, (page) => ctx.label(page)),
    action: (id) => {
      for (const page of story.pages) {
        const action = page.actions.find((entry) => entry.id === id);
        if (action) return `${ctx.label(page)}: ${action.label || '?'}`;
      }
      return undefined;
    },
  };
  const code = h('pre', { class: 'rules-text-code' });
  let text = '';
  const copy = h(
    'button',
    {
      class: 'action',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = t('copiedText');
          setTimeout(() => (copy.textContent = t('copyText')), 1500);
        } catch {
          // Without clipboard access the text can still be selected by hand.
        }
      },
    },
    t('copyText'),
  );
  const pane = h(
    'aside',
    { class: 'rules-text' },
    h('div', { class: 'rules-text-head' }, h('div', { class: 'rules-title' }, h('strong', null, t('rulesTextTitle')), h('small', null, t('rulesTextNote'))), copy),
    code,
  );
  return {
    pane,
    show(rule) {
      text = ruleToText(rule, kind, names);
      code.textContent = text || t('rulesTextEmpty');
      code.classList.toggle('empty', !text);
      copy.disabled = !text;
    },
  };
}

const PINNED_TOOLBOX = 'adventures-pinned';
let toolboxRegistered = false;

/**
 * A toolbox whose group of blocks never closes: clicking the open group again, or
 * clicking the workspace, keeps its blocks on show. Choosing another group still works.
 */
function registerToolbox(B: typeof import('blockly/core')): void {
  if (toolboxRegistered) return;
  toolboxRegistered = true;
  class PinnedToolbox extends B.Toolbox {
    override setSelectedItem(item: Parameters<InstanceType<typeof B.Toolbox>['setSelectedItem']>[0]): void {
      if (item === null || item === this.getSelectedItem()) return;
      super.setSelectedItem(item);
    }
  }
  B.registry.register(B.registry.Type.TOOLBOX, PINNED_TOOLBOX, PinnedToolbox);
}

/** Opens the block editor for one rule. Resolves when the author closes it. */
export async function openRules(ctx: EditorContext, target: RuleTarget): Promise<void> {
  const { t } = ctx;
  const rule = target.read(ctx.doc);
  if (!rule) return;
  const [B, messages] = await Promise.all([import('blockly/core'), ctx.language === 'cs' ? import('blockly/msg/cs') : import('blockly/msg/en')]);
  B.setLocale(messages as unknown as Record<string, string>);

  if (!host) {
    host = h('dialog', { class: 'rules-dialog' }, content);
    document.body.append(host);
    // Blockly puts its drop-down menus inside the block area, so they are in the dialog
    // and show above it. Do not move them elsewhere (setParentContainer): Blockly then
    // thinks focus left the blocks and closes each menu the moment it opens.
  }
  const dialog = host;
  const area = h('div', { class: 'rules-blocks' });
  const textPane = buildTextPane(ctx, target.kind);
  textPane.pane.hidden = !textViewOpen();
  let resizeBlocks = () => {};
  const textToggle = h(
    'button',
    {
      class: 'action rules-text-toggle',
      title: t('rulesTextShow'),
      'aria-label': t('rulesTextShow'),
      'aria-pressed': String(!textPane.pane.hidden),
      onclick: () => {
        textPane.pane.hidden = !textPane.pane.hidden;
        textToggle.setAttribute('aria-pressed', String(!textPane.pane.hidden));
        setTextViewOpen(!textPane.pane.hidden);
        resizeBlocks();
      },
    },
    '</>',
  );
  // Copy and paste of whole rules. Pasting adds to what is here, as one undo step.
  const copyButton = h(
    'button',
    {
      class: 'action rules-clip',
      title: t('copyRulesTitle'),
      'aria-label': t('copyRulesTitle'),
      onclick: () => {
        writeClipboard({ title: target.title, rule: current() });
        copyButton.lastElementChild!.textContent = t('copiedText');
        setTimeout(() => (copyButton.lastElementChild!.textContent = t('copyRules')), 1500);
        updatePaste();
      },
    },
    '📋',
    h('span', null, t('copyRules')),
  );
  const pasteButton = h(
    'button',
    {
      class: 'action rules-clip',
      onclick: () => {
        const clip = readClipboard();
        if (!clip || !canPasteRules(clip.rule, target.kind)) return;
        B.serialization.workspaces.load(ruleToWorkspace(combineRules(current(), clip.rule, target.kind), target.kind), workspace);
        // What the blocks now say (the same rules, tidied up by the blocks).
        const next = current();
        last = JSON.stringify(next);
        textPane.show(next);
        ctx.change((doc) => target.write(doc, next), { quiet: true });
      },
    },
    '📥',
    h('span', null, t('pasteRules')),
  );
  const updatePaste = () => {
    const clip = readClipboard();
    const fits = !!clip && canPasteRules(clip.rule, target.kind);
    pasteButton.disabled = !fits;
    const title = !clip ? t('pasteNothing') : fits ? t('pasteRulesTitle', { title: clip.title }) : t('pasteDoesNotFit');
    pasteButton.title = title;
    pasteButton.setAttribute('aria-label', title);
  };
  updatePaste();

  content.replaceChildren(
    h(
      'div',
      { class: 'rules-head' },
      h('div', { class: 'rules-title' }, h('strong', null, `◆ ${target.title}`), h('small', null, t('rulesHelp'))),
      h('div', { class: 'button-row' }, copyButton, pasteButton, textToggle, h('button', { class: 'action primary', onclick: () => dialog.close() }, t('done'))),
    ),
    target.extra?.length ? h('div', { class: 'rules-extra' }, target.extra) : '',
    h('div', { class: 'rules-body' }, area, textPane.pane),
  );
  dialog.showModal();

  defineBlocks(B, t);
  setLists(buildLists(ctx, rule));
  registerToolbox(B);
  // With enough room, the blocks of the chosen group stay on show instead of a menu
  // that has to be opened again for every block.
  // Measured on the whole dialog, so an open text view does not change the palette.
  const pinned = content.clientWidth >= 640;
  const workspace = B.inject(area, {
    toolbox: toolbox(target.kind, t),
    plugins: pinned ? { toolbox: PINNED_TOOLBOX } : {},
    renderer: 'zelos',
    media: 'blockly-media/',
    sounds: false,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 1.6 },
    move: { scrollbars: true, drag: true, wheel: false },
  });
  if (pinned) {
    const flyout = workspace.getFlyout();
    if (flyout instanceof B.Flyout) flyout.setAutoClose(false);
    else if (flyout) flyout.autoClose = false;
    workspace.getToolbox()?.selectItemByPosition(0);
  }
  B.serialization.workspaces.load(ruleToWorkspace(rule, target.kind), workspace);

  const current = () => workspaceToRule(B.serialization.workspaces.save(workspace) as WorkspaceState);
  // Compare against what the blocks say right after loading, so that merely opening
  // the editor never counts as a change.
  let last = JSON.stringify(current());
  textPane.show(current());
  resizeBlocks = () => B.svgResize(workspace);
  workspace.addChangeListener((event) => {
    if (event.isUiEvent) return;
    const next = current();
    const text = JSON.stringify(next);
    if (text === last) return;
    last = text;
    textPane.show(next);
    ctx.change((doc) => target.write(doc, next), { merge: target.mergeKey, quiet: true });
  });

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        // A menu left open would otherwise stay attached to the workspace being thrown away.
        workspace.hideChaff();
        B.DropDownDiv.hideWithoutAnimation();
        B.WidgetDiv.hide();
        workspace.dispose();
        content.replaceChildren();
        resolve();
      },
      { once: true },
    );
  });
}
