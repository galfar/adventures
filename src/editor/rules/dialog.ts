import type { EditorDoc } from '../../shared/db.ts';
import { h } from '../../shared/dom.ts';
import type { EditorContext } from '../context.ts';
import { defineBlocks, setLists, toolbox, type Lists, type Option } from './blocks.ts';
import { ruleRefs, ruleToWorkspace, workspaceToRule, type Rule, type RuleKind, type WorkspaceState } from './convert.ts';

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

/** One dialog element is reused for every rule: Blockly attaches its menus to it once. */
let host: HTMLDialogElement | undefined;
/** The part of the dialog that is rebuilt for each rule. Blockly's own menu elements sit next to it and must stay. */
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
    // Blockly's drop-down menus must live inside the dialog, or they open behind it.
    B.setParentContainer(host);
  }
  const dialog = host;
  const area = h('div', { class: 'rules-blocks' });
  content.replaceChildren(
    h(
      'div',
      { class: 'rules-head' },
      h('div', { class: 'rules-title' }, h('strong', null, `◆ ${target.title}`), h('small', null, t('rulesHelp'))),
      h('button', { class: 'action primary', onclick: () => dialog.close() }, t('done')),
    ),
    target.extra?.length ? h('div', { class: 'rules-extra' }, target.extra) : '',
    area,
  );
  dialog.showModal();

  defineBlocks(B, t);
  setLists(buildLists(ctx, rule));
  const workspace = B.inject(area, {
    toolbox: toolbox(target.kind, t),
    renderer: 'zelos',
    media: 'blockly-media/',
    sounds: false,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 1.6 },
    move: { scrollbars: true, drag: true, wheel: false },
  });
  B.serialization.workspaces.load(ruleToWorkspace(rule, target.kind), workspace);

  const current = () => workspaceToRule(B.serialization.workspaces.save(workspace) as WorkspaceState);
  // Compare against what the blocks say right after loading, so that merely opening
  // the editor never counts as a change.
  let last = JSON.stringify(current());
  workspace.addChangeListener((event) => {
    if (event.isUiEvent) return;
    const next = current();
    const text = JSON.stringify(next);
    if (text === last) return;
    last = text;
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
