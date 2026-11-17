import type { CompareOp, Condition, Effect, Value } from '../../shared/format/types.ts';
import { forEachCondition, forEachEffect } from '../../shared/format/validate.ts';

/**
 * Translation between the story's conditions/effects and block pictures.
 *
 * The story JSON is the only thing that is stored. When the block editor opens, the JSON
 * is turned into blocks; every block change is turned straight back into JSON. Both
 * directions work on Blockly's plain "saved workspace" data, so this file needs no
 * Blockly and can be tested on its own.
 *
 * Each condition and effect of the format has exactly one block type (`cond_*`, `fx_*`).
 * Anything this editor does not know (made by a newer version) becomes an "unknown"
 * block that carries the original JSON along untouched.
 */

/** A block as Blockly saves it. */
export interface BlockState {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockState }>;
  next?: { block?: BlockState };
  /** Free text Blockly keeps with the block; used to carry unknown JSON. */
  data?: string;
  x?: number;
  y?: number;
  deletable?: boolean;
  movable?: boolean;
}

export interface WorkspaceState {
  blocks?: { languageVersion: number; blocks: BlockState[] };
}

/** What a block editor edits: a condition, a list of effects, or both (a choice). */
export interface Rule {
  when?: Condition;
  effects?: Effect[];
}

export type RuleKind = 'choice' | 'effects' | 'condition';

const ROOT_TYPES: Record<RuleKind, string> = { choice: 'root_choice', effects: 'root_effects', condition: 'root_condition' };

function inputs(entries: Record<string, BlockState | undefined>): Record<string, { block: BlockState }> | undefined {
  const present = Object.entries(entries).filter((entry): entry is [string, BlockState] => entry[1] !== undefined);
  return present.length > 0 ? Object.fromEntries(present.map(([name, block]) => [name, { block }])) : undefined;
}

// ---- Conditions ---------------------------------------------------------------------

/** How the left side of a comparison is written in the block's drop-down list. */
function encodeValue(value: Exclude<Value, number>): string {
  if ('stat' in value) return `stat:${value.stat}`;
  if ('counter' in value) return `counter:${value.counter}`;
  return `item:${value.itemCount}`;
}

function decodeValue(text: string): Value {
  const [kind, id = ''] = [text.slice(0, text.indexOf(':')), text.slice(text.indexOf(':') + 1)];
  if (kind === 'stat') return { stat: id as 'hp' };
  if (kind === 'counter') return { counter: id };
  return { itemCount: id };
}

const FLIPPED: Record<CompareOp, CompareOp> = { '<': '>', '<=': '>=', '=': '=', '!=': '!=', '>=': '<=', '>': '<' };

export function conditionToBlock(cond: Condition | undefined): BlockState | undefined {
  if (!cond) return undefined;
  switch (cond.type) {
    case 'hasItem':
      return { type: 'cond_has_item', fields: { COUNT: cond.count ?? 1, ITEM: cond.item } };
    case 'did':
      return { type: 'cond_did', fields: { ACTION: cond.action } };
    case 'visited':
      return { type: 'cond_visited', fields: { PAGE: cond.page } };
    case 'won':
      return { type: 'cond_won', fields: { PAGE: cond.page } };
    case 'profession':
      return { type: 'cond_profession', fields: { PROFESSION: cond.profession } };
    case 'compare': {
      // The block reads "<thing> <is more than> <number>"; "5 < gold" is shown as "gold > 5".
      const { left, right } = cond;
      if (typeof left !== 'number' && typeof right === 'number') {
        return { type: 'cond_compare', fields: { WHAT: encodeValue(left), OP: cond.op, NUMBER: right } };
      }
      if (typeof left === 'number' && typeof right !== 'number') {
        return { type: 'cond_compare', fields: { WHAT: encodeValue(right), OP: FLIPPED[cond.op], NUMBER: left } };
      }
      break;
    }
    case 'and':
    case 'or': {
      // Blocks join two things at a time: "a and b and c" becomes "a and (b and c)".
      const parts = cond.type === 'and' ? cond.all : cond.any;
      const blocks = parts.map(conditionToBlock).filter((block): block is BlockState => !!block);
      if (parts.length === 0) return undefined;
      if (blocks.length !== parts.length) break;
      return blocks.reduceRight((rest, block) => ({ type: `cond_${cond.type}`, inputs: inputs({ A: block, B: rest }) }));
    }
    case 'not':
      return { type: 'cond_not', inputs: inputs({ A: conditionToBlock(cond.cond) }) };
  }
  return { type: 'cond_unknown', data: JSON.stringify(cond) };
}

export function blockToCondition(block: BlockState | undefined): Condition | undefined {
  if (!block) return undefined;
  const fields = block.fields ?? {};
  const text = (name: string) => String(fields[name] ?? '');
  const child = (name: string) => blockToCondition(block.inputs?.[name]?.block);
  switch (block.type) {
    case 'cond_has_item': {
      const count = Number(fields.COUNT) || 1;
      return count > 1 ? { type: 'hasItem', item: text('ITEM'), count } : { type: 'hasItem', item: text('ITEM') };
    }
    case 'cond_did':
      return { type: 'did', action: text('ACTION') };
    case 'cond_visited':
      return { type: 'visited', page: text('PAGE') };
    case 'cond_won':
      return { type: 'won', page: text('PAGE') };
    case 'cond_profession':
      return { type: 'profession', profession: text('PROFESSION') };
    case 'cond_compare':
      return { type: 'compare', left: decodeValue(text('WHAT')), op: text('OP') as CompareOp, right: Number(fields.NUMBER) || 0 };
    case 'cond_and':
    case 'cond_or': {
      // A half-filled "and"/"or" block counts as just its filled half.
      const [a, b] = [child('A'), child('B')];
      if (!a || !b) return a ?? b;
      const kind = block.type === 'cond_and' ? 'and' : 'or';
      // "a and (b and c)" is stored flat again: all of [a, b, c].
      const partsOf = (part: Condition) => (kind === 'and' && part.type === 'and' ? part.all : kind === 'or' && part.type === 'or' ? part.any : [part]);
      const flat = [...partsOf(a), ...partsOf(b)];
      return kind === 'and' ? { type: 'and', all: flat } : { type: 'or', any: flat };
    }
    case 'cond_not': {
      const inner = child('A');
      return inner ? { type: 'not', cond: inner } : undefined;
    }
    case 'cond_unknown':
      return parse<Condition>(block.data);
    default:
      return undefined;
  }
}

// ---- Effects ------------------------------------------------------------------------

function effectToBlock(effect: Effect): BlockState {
  switch (effect.type) {
    case 'giveItem':
      return { type: 'fx_give_item', fields: { COUNT: effect.count ?? 1, ITEM: effect.item } };
    case 'takeItem':
      return { type: 'fx_take_item', fields: { COUNT: effect.count ?? 1, ITEM: effect.item } };
    case 'changeStat':
      return { type: 'fx_change_stat', fields: { STAT: effect.stat, BY: effect.by } };
    case 'setStat':
      return { type: 'fx_set_stat', fields: { STAT: effect.stat, TO: effect.to } };
    case 'changeCounter':
      return { type: 'fx_change_counter', fields: { COUNTER: effect.counter, BY: effect.by } };
    case 'setCounter':
      return { type: 'fx_set_counter', fields: { COUNTER: effect.counter, TO: effect.to } };
    case 'message':
      return { type: 'fx_message', fields: { TEXT: effect.text } };
    case 'goto':
      return { type: 'fx_goto', fields: { PAGE: effect.page } };
    case 'if':
      return {
        type: 'fx_if',
        inputs: inputs({ WHEN: conditionToBlock(effect.when), THEN: effectsToBlocks(effect.then), ELSE: effectsToBlocks(effect.else) }),
      };
    case 'chance':
      return {
        type: 'fx_chance',
        fields: { PERCENT: effect.percent },
        inputs: inputs({ THEN: effectsToBlocks(effect.then), ELSE: effectsToBlocks(effect.else) }),
      };
    default:
      return { type: 'fx_unknown', data: JSON.stringify(effect) };
  }
}

/** A list of effects as a stack of blocks; returns the top block. */
export function effectsToBlocks(effects: Effect[] | undefined): BlockState | undefined {
  let list = effects ?? [];
  // "Go to page" ends a list, and its block has nothing to attach below it.
  const jump = list.findIndex((effect) => effect.type === 'goto');
  if (jump >= 0) list = list.slice(0, jump + 1);
  let below: BlockState | undefined;
  for (const effect of [...list].reverse()) {
    const block = effectToBlock(effect);
    if (below) block.next = { block: below };
    below = block;
  }
  return below;
}

export function blocksToEffects(top: BlockState | undefined): Effect[] {
  const effects: Effect[] = [];
  for (let block = top; block; block = block.next?.block) {
    const fields = block.fields ?? {};
    const text = (name: string) => String(fields[name] ?? '');
    const number = (name: string) => Number(fields[name]) || 0;
    const stack = (name: string) => blocksToEffects(block!.inputs?.[name]?.block);
    const count = () => (number('COUNT') > 1 ? { count: number('COUNT') } : {});
    switch (block.type) {
      case 'fx_give_item':
        effects.push({ type: 'giveItem', item: text('ITEM'), ...count() });
        break;
      case 'fx_take_item':
        effects.push({ type: 'takeItem', item: text('ITEM'), ...count() });
        break;
      case 'fx_change_stat':
        effects.push({ type: 'changeStat', stat: text('STAT') as 'hp', by: number('BY') });
        break;
      case 'fx_set_stat':
        effects.push({ type: 'setStat', stat: text('STAT') as 'hp', to: number('TO') });
        break;
      case 'fx_change_counter':
        effects.push({ type: 'changeCounter', counter: text('COUNTER'), by: number('BY') });
        break;
      case 'fx_set_counter':
        effects.push({ type: 'setCounter', counter: text('COUNTER'), to: number('TO') });
        break;
      case 'fx_message':
        effects.push({ type: 'message', text: text('TEXT') });
        break;
      case 'fx_goto':
        effects.push({ type: 'goto', page: text('PAGE') });
        break;
      case 'fx_if': {
        const otherwise = stack('ELSE');
        effects.push({
          type: 'if',
          // An "if" without a question in it always happens.
          when: blockToCondition(block.inputs?.WHEN?.block) ?? { type: 'and', all: [] },
          then: stack('THEN'),
          ...(otherwise.length > 0 ? { else: otherwise } : {}),
        });
        break;
      }
      case 'fx_chance': {
        const otherwise = stack('ELSE');
        effects.push({
          type: 'chance',
          percent: Math.min(100, Math.max(0, number('PERCENT'))),
          then: stack('THEN'),
          ...(otherwise.length > 0 ? { else: otherwise } : {}),
        });
        break;
      }
      case 'fx_unknown': {
        const original = parse<Effect>(block.data);
        if (original) effects.push(original);
        break;
      }
    }
  }
  return effects;
}

function parse<T>(data: string | undefined): T | undefined {
  try {
    return data ? (JSON.parse(data) as T) : undefined;
  } catch {
    return undefined;
  }
}

// ---- Whole editor contents ----------------------------------------------------------

/**
 * The block editor always holds one fixed "root" block that the author fills in:
 * a question slot (WHEN), a slot for a stack of effects (DO), or both for a choice.
 */
export function ruleToWorkspace(rule: Rule, kind: RuleKind): WorkspaceState {
  const root: BlockState = {
    type: ROOT_TYPES[kind],
    x: 24,
    y: 24,
    deletable: false,
    movable: false,
    inputs: inputs({
      WHEN: kind === 'effects' ? undefined : conditionToBlock(rule.when),
      DO: kind === 'condition' ? undefined : effectsToBlocks(rule.effects),
    }),
  };
  return { blocks: { languageVersion: 0, blocks: [root] } };
}

/** Reads the rule back from the root block. Blocks left lying around loose are not part of it. */
export function workspaceToRule(state: WorkspaceState): Rule {
  const root = state.blocks?.blocks.find((block) => block.type.startsWith('root_'));
  const rule: Rule = {};
  const when = blockToCondition(root?.inputs?.WHEN?.block);
  const effects = blocksToEffects(root?.inputs?.DO?.block);
  if (when) rule.when = when;
  if (effects.length > 0) rule.effects = effects;
  return rule;
}

/** Everything a rule refers to, so the drop-down lists can still show things that were deleted. */
export function ruleRefs(rule: Rule): Record<'items' | 'pages' | 'actions' | 'counters' | 'professions', Set<string>> {
  const refs = { items: new Set<string>(), pages: new Set<string>(), actions: new Set<string>(), counters: new Set<string>(), professions: new Set<string>() };
  const value = (v: Value) => {
    if (typeof v === 'number') return;
    if ('counter' in v) refs.counters.add(v.counter);
    if ('itemCount' in v) refs.items.add(v.itemCount);
  };
  const condition = (root: Condition | undefined) =>
    forEachCondition(root, (cond) => {
      if (cond.type === 'hasItem') refs.items.add(cond.item);
      if (cond.type === 'did') refs.actions.add(cond.action);
      if (cond.type === 'visited' || cond.type === 'won') refs.pages.add(cond.page);
      if (cond.type === 'profession') refs.professions.add(cond.profession);
      if (cond.type === 'compare') {
        value(cond.left);
        value(cond.right);
      }
    });
  condition(rule.when);
  forEachEffect(rule.effects, (effect) => {
    if (effect.type === 'giveItem' || effect.type === 'takeItem') refs.items.add(effect.item);
    if (effect.type === 'changeCounter' || effect.type === 'setCounter') refs.counters.add(effect.counter);
    if (effect.type === 'goto') refs.pages.add(effect.page);
    if (effect.type === 'if') condition(effect.when);
  });
  return refs;
}
