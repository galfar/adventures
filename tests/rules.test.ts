import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blockToCondition, conditionToBlock, ruleRefs, ruleToWorkspace, workspaceToRule, type Rule, type RuleKind } from '../src/editor/rules/convert.ts';
import type { Condition, Effect, Story } from '../src/shared/format/types.ts';
import { normalizeStory } from '../src/shared/format/validate.ts';

/** Through the block editor's data and back, as if the author opened and closed it. */
function roundTrip(rule: Rule, kind: RuleKind): Rule {
  // Blockly stores plain data, so a JSON copy stands in for "saved and loaded".
  return workspaceToRule(JSON.parse(JSON.stringify(ruleToWorkspace(rule, kind))));
}

test('every rule in the sample adventures survives the block editor unchanged', () => {
  let checked = 0;
  for (const name of ['goblin-cave', 'ztracena-stanice']) {
    const url = new URL(`../public/adventures/${name}/story.json`, import.meta.url);
    const story: Story = normalizeStory(JSON.parse(readFileSync(url, 'utf8')));
    const check = (rule: Rule, kind: RuleKind, where: string) => {
      const clean: Rule = {};
      if (rule.when) clean.when = rule.when;
      if (rule.effects?.length) clean.effects = rule.effects;
      assert.deepEqual(roundTrip(clean, kind), clean, `${name}: ${where}`);
      checked++;
    };
    for (const page of story.pages) {
      for (const action of page.actions) check({ when: action.when, effects: action.effects }, 'choice', action.id);
      for (const extra of page.extraTexts ?? []) check({ when: extra.when }, 'condition', `${page.id} extra text`);
      check({ effects: page.onFirstVisit }, 'effects', `${page.id} first visit`);
      check({ effects: page.combat?.onWin?.effects }, 'effects', `${page.id} win`);
      check({ effects: page.combat?.flee?.effects }, 'effects', `${page.id} flee`);
    }
    for (const item of story.items) check({ effects: item.use?.effects }, 'effects', `item ${item.id}`);
  }
  assert.ok(checked > 80);
});

test('conditions become blocks and back', () => {
  const key: Condition = { type: 'hasItem', item: 'key' };
  const cases: Condition[] = [
    { type: 'hasItem', item: 'coin', count: 3 },
    { type: 'not', cond: key },
    { type: 'and', all: [key, { type: 'did', action: 'a1' }, { type: 'won', page: 'p' }] },
    { type: 'or', any: [key, { type: 'and', all: [{ type: 'visited', page: 'p' }, { type: 'profession', profession: 'thief' }] }] },
    { type: 'compare', left: { stat: 'hp' }, op: '<=', right: 5 },
    { type: 'compare', left: { itemCount: 'arrow' }, op: '!=', right: 0 },
  ];
  for (const cond of cases) assert.deepEqual(blockToCondition(conditionToBlock(cond)), cond);
});

test('"5 < gold" is shown the readable way round, with the same meaning', () => {
  const block = conditionToBlock({ type: 'compare', left: 5, op: '<', right: { counter: 'gold' } })!;
  assert.deepEqual(block.fields, { WHAT: 'counter:gold', OP: '>', NUMBER: 5 });
  assert.deepEqual(blockToCondition(block), { type: 'compare', left: { counter: 'gold' }, op: '>', right: 5 });
});

test('things this editor does not know are carried along untouched', () => {
  const future = { type: 'moonPhase', phase: 'full' } as unknown as Condition;
  const sound = { type: 'playSound', sound: 'roar' } as unknown as Effect;
  const compare: Condition = { type: 'compare', left: { stat: 'hp' }, op: '<', right: { counter: 'gold' } };
  const rule: Rule = { when: { type: 'and', all: [future, compare] }, effects: [sound, { type: 'message', text: 'Roar!' }] };
  assert.deepEqual(roundTrip(rule, 'choice'), rule);
});

test('half-built blocks give a sensible rule', () => {
  const key = conditionToBlock({ type: 'hasItem', item: 'key' })!;
  assert.deepEqual(blockToCondition({ type: 'cond_and', inputs: { A: { block: key } } }), { type: 'hasItem', item: 'key' });
  assert.equal(blockToCondition({ type: 'cond_not' }), undefined);
  const rule = workspaceToRule({
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: 'fx_message', fields: { TEXT: 'loose block, not part of the rule' } },
        { type: 'root_effects', inputs: { DO: { block: { type: 'fx_if', inputs: { THEN: { block: { type: 'fx_goto', fields: { PAGE: 'p' } } } } } } } },
      ],
    },
  });
  assert.deepEqual(rule, { effects: [{ type: 'if', when: { type: 'and', all: [] }, then: [{ type: 'goto', page: 'p' }] }] });
  // The always-true question is not drawn as a block, so the "if" slot shows empty again.
  assert.deepEqual(roundTrip(rule, 'effects'), rule);
});

test('effects after "go to page" are dropped, since they could never run', () => {
  const rule = roundTrip({ effects: [{ type: 'goto', page: 'p' }, { type: 'message', text: 'never' }] }, 'effects');
  assert.deepEqual(rule, { effects: [{ type: 'goto', page: 'p' }] });
});

test('references are collected for the drop-down lists', () => {
  const refs = ruleRefs({
    when: { type: 'or', any: [{ type: 'did', action: 'a' }, { type: 'compare', left: { counter: 'gold' }, op: '>', right: 1 }] },
    effects: [{ type: 'if', when: { type: 'hasItem', item: 'key' }, then: [{ type: 'goto', page: 'p' }] }],
  });
  assert.deepEqual([[...refs.actions], [...refs.counters], [...refs.items], [...refs.pages]], [['a'], ['gold'], ['key'], ['p']]);
});
