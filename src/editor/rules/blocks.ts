import type * as BlocklyApi from 'blockly/core';
import type { Translate } from '../i18n/index.ts';
import type { RuleKind } from './convert.ts';

/**
 * The blocks themselves: what each looks like and which blocks the toolbox offers.
 * Their meaning (which condition or effect a block stands for) is in `convert.ts`;
 * the block type and field names here must match the ones used there.
 */

type Blockly = typeof BlocklyApi;
/** One line of a drop-down list: [text shown, value stored]. */
export type Option = [string, string];

/** The story's things that blocks can refer to, refreshed each time the editor opens. */
export interface Lists {
  items: Option[];
  pages: Option[];
  actions: Option[];
  counters: Option[];
  professions: Option[];
  /** Left side of a comparison: stats, counters and "number of <item>". */
  values: Option[];
}

let lists: Lists = { items: [], pages: [], actions: [], counters: [], professions: [], values: [] };

export function setLists(next: Lists): void {
  lists = next;
}

const COLOUR = { question: 210, things: 150, numbers: 35, story: 290, root: 48, unknown: '#8a8f98' };

export function defineBlocks(B: Blockly, t: Translate): void {
  // A drop-down list must never be empty, or Blockly refuses to draw the block.
  const list = (name: keyof Lists) => new B.FieldDropdown(() => (lists[name].length > 0 ? lists[name] : [[t('bNothingYet'), '']]));
  const number = (value: number, min = -9999, max = 9999) => new B.FieldNumber(value, min, max, 1);
  const stats = () =>
    new B.FieldDropdown([
      [t('hp'), 'hp'],
      [t('maxHp'), 'maxHp'],
      [t('attack'), 'attack'],
      [t('defense'), 'defense'],
    ]);

  const define = (type: string, build: (block: BlocklyApi.Block) => void) => {
    B.Blocks[type] = {
      init(this: BlocklyApi.Block) {
        build(this);
      },
    };
  };
  /** A question: a rounded block that fits into "if" and "only if" slots. */
  const question = (type: string, build: (block: BlocklyApi.Block) => void) =>
    define(type, (block) => {
      build(block);
      block.setOutput(true, 'Boolean');
      block.setColour(COLOUR.question);
      block.setInputsInline(true);
    });
  /** An effect: a block that stacks under other effects. */
  const effect = (type: string, colour: number | string, build: (block: BlocklyApi.Block) => void, last = false) =>
    define(type, (block) => {
      build(block);
      block.setPreviousStatement(true);
      block.setNextStatement(!last);
      block.setColour(colour);
      block.setInputsInline(true);
    });

  // ---- Questions (conditions) ----
  question('cond_has_item', (b) => b.appendDummyInput().appendField(t('bHas')).appendField(number(1, 1, 999), 'COUNT').appendField('×').appendField(list('items'), 'ITEM'));
  question('cond_did', (b) => b.appendDummyInput().appendField(t('bDid')).appendField(list('actions'), 'ACTION'));
  question('cond_visited', (b) => b.appendDummyInput().appendField(t('bVisited')).appendField(list('pages'), 'PAGE'));
  question('cond_won', (b) => b.appendDummyInput().appendField(t('bWon')).appendField(list('pages'), 'PAGE'));
  question('cond_profession', (b) => b.appendDummyInput().appendField(t('bIsProfession')).appendField(list('professions'), 'PROFESSION'));
  question('cond_compare', (b) =>
    b
      .appendDummyInput()
      .appendField(list('values'), 'WHAT')
      .appendField(
        new B.FieldDropdown([
          ['=', '='],
          ['≠', '!='],
          ['<', '<'],
          ['≤', '<='],
          ['>', '>'],
          ['≥', '>='],
        ]),
        'OP',
      )
      .appendField(number(1), 'NUMBER'),
  );
  for (const [type, word] of [
    ['cond_and', t('bAnd')],
    ['cond_or', t('bOr')],
  ] as const) {
    question(type, (b) => {
      b.appendValueInput('A').setCheck('Boolean');
      b.appendValueInput('B').setCheck('Boolean').appendField(word);
    });
  }
  question('cond_not', (b) => b.appendValueInput('A').setCheck('Boolean').appendField(t('bNot')));
  question('cond_unknown', (b) => {
    b.appendDummyInput().appendField(t('bUnknown'));
  });

  // ---- Effects ----
  effect('fx_give_item', COLOUR.things, (b) => b.appendDummyInput().appendField(t('bGive')).appendField(number(1, 1, 999), 'COUNT').appendField('×').appendField(list('items'), 'ITEM'));
  effect('fx_take_item', COLOUR.things, (b) => b.appendDummyInput().appendField(t('bTake')).appendField(number(1, 1, 999), 'COUNT').appendField('×').appendField(list('items'), 'ITEM'));
  effect('fx_change_stat', COLOUR.numbers, (b) => b.appendDummyInput().appendField(t('bChange')).appendField(stats(), 'STAT').appendField(t('bBy')).appendField(number(1), 'BY'));
  effect('fx_set_stat', COLOUR.numbers, (b) => b.appendDummyInput().appendField(t('bSet')).appendField(stats(), 'STAT').appendField(t('bTo')).appendField(number(1, 0), 'TO'));
  effect('fx_change_counter', COLOUR.numbers, (b) => b.appendDummyInput().appendField(t('bChange')).appendField(list('counters'), 'COUNTER').appendField(t('bBy')).appendField(number(1), 'BY'));
  effect('fx_set_counter', COLOUR.numbers, (b) => b.appendDummyInput().appendField(t('bSet')).appendField(list('counters'), 'COUNTER').appendField(t('bTo')).appendField(number(0), 'TO'));
  effect('fx_message', COLOUR.story, (b) => b.appendDummyInput().appendField(t('bSay')).appendField(new B.FieldTextInput(''), 'TEXT'));
  effect('fx_goto', COLOUR.story, (b) => b.appendDummyInput().appendField(t('bGoto')).appendField(list('pages'), 'PAGE'), true);
  effect('fx_if', COLOUR.story, (b) => {
    b.appendValueInput('WHEN').setCheck('Boolean').appendField(t('bIf'));
    b.appendStatementInput('THEN').appendField(t('bThen'));
    b.appendStatementInput('ELSE').appendField(t('bElse'));
    b.setInputsInline(false);
  });
  effect('fx_chance', COLOUR.story, (b) => {
    b.appendDummyInput().appendField(t('bChance')).appendField(number(50, 0, 100), 'PERCENT').appendField('%');
    b.appendStatementInput('THEN').appendField(t('bThen'));
    b.appendStatementInput('ELSE').appendField(t('bElse'));
  });
  effect('fx_unknown', COLOUR.unknown, (b) => {
    b.appendDummyInput().appendField(t('bUnknown'));
  });

  // ---- Root blocks: the fixed block the author fills in ----
  define('root_choice', (b) => {
    b.appendValueInput('WHEN').setCheck('Boolean').appendField(t('bChoiceOnlyIf'));
    b.appendStatementInput('DO').appendField(t('bChoiceDo'));
    b.setColour(COLOUR.root);
  });
  define('root_effects', (b) => {
    b.appendStatementInput('DO').appendField(t('bEffectsDo'));
    b.setColour(COLOUR.root);
  });
  define('root_condition', (b) => {
    b.appendValueInput('WHEN').setCheck('Boolean').appendField(t('bConditionIf'));
    b.setColour(COLOUR.root);
  });
}

/** The palette on the left: questions always, effects only where effects can go. */
export function toolbox(kind: RuleKind, t: Translate): BlocklyApi.utils.toolbox.ToolboxDefinition {
  const category = (name: string, colour: number, types: string[]) => ({
    kind: 'category',
    name,
    colour: String(colour),
    contents: types.map((type) => ({ kind: 'block', type })),
  });
  const questions = category(t('catQuestions'), COLOUR.question, [
    'cond_has_item',
    'cond_did',
    'cond_visited',
    'cond_won',
    'cond_profession',
    'cond_compare',
    'cond_and',
    'cond_or',
    'cond_not',
  ]);
  if (kind === 'condition') return { kind: 'categoryToolbox', contents: [questions] };
  return {
    kind: 'categoryToolbox',
    contents: [
      category(t('catThings'), COLOUR.things, ['fx_give_item', 'fx_take_item']),
      category(t('catNumbers'), COLOUR.numbers, ['fx_change_stat', 'fx_set_stat', 'fx_change_counter', 'fx_set_counter']),
      category(t('catStory'), COLOUR.story, ['fx_message', 'fx_goto', 'fx_if', 'fx_chance']),
      questions,
    ],
  };
}
