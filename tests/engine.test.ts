import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Game } from '../src/shared/engine/game.ts';
import { strike } from '../src/shared/engine/rules.ts';
import type { GameState } from '../src/shared/engine/state.ts';
import type { Page, Story } from '../src/shared/format/types.ts';
import { normalizeStory, validateStory } from '../src/shared/format/validate.ts';

function loadSample(name: string): Story {
  const url = new URL(`../public/adventures/${name}/story.json`, import.meta.url);
  return normalizeStory(JSON.parse(readFileSync(url, 'utf8')));
}

/** A tiny story for testing one thing at a time. */
function miniStory(pages: Page[], extra: Partial<Story> = {}): Story {
  return normalizeStory({
    id: 'mini',
    title: 'Mini',
    language: 'en',
    startPage: pages[0]!.id,
    hero: { stats: { hp: 10, attack: 3, defense: 1 } },
    items: [
      { id: 'key', name: 'Key' },
      { id: 'potion', name: 'Potion', use: { effects: [{ type: 'changeStat', stat: 'hp', by: 5 }] } },
      { id: 'sword', name: 'Sword', bonus: { attack: 2 } },
    ],
    counters: [{ id: 'gold', name: 'Gold', start: 3, min: 0 }],
    pages,
    ...extra,
  });
}

function fightToTheEnd(game: Game): 'win' | 'lose' {
  while (!game.state.combat!.outcome) game.fightRound();
  return game.state.combat!.outcome!;
}

test('sample stories have no problems', () => {
  for (const name of ['goblin-cave', 'ztracena-stanice']) {
    assert.deepEqual(validateStory(loadSample(name)), [], name);
  }
});

test('validation reports broken links, dead ends and unreachable pages', () => {
  const story = miniStory([
    { id: 'a', text: '', actions: [{ id: 'go', label: 'Go', target: 'nowhere' }] },
    { id: 'b', text: '', actions: [] },
  ]);
  const codes = validateStory(story).map((p) => `${p.code}:${p.pageId}`);
  assert.deepEqual(codes.sort(), ['deadEnd:b', 'unknownPage:a', 'unreachablePage:b']);
});

test('a profession gives its stats, fixed items and the chosen items', () => {
  const game = new Game(loadSample('goblin-cave'));
  game.start({ profession: 'thief', items: ['torch', 'rope', 'potion', 'crown'] });
  const view = game.view();
  assert.equal(view.hero.profession?.id, 'thief');
  assert.equal(view.hero.maxHp, 16);
  assert.equal(view.hero.attack, 3, 'attack 2 + dagger');
  // Only two of the offered items may be picked, and nothing outside the offer.
  assert.deepEqual(Object.keys(game.state.items).sort(), ['dagger', 'rope', 'torch']);
  assert.equal(view.counters[0]!.value, 5);
});

test('actions move between pages and first-visit effects run only once', () => {
  const game = new Game(
    miniStory([
      { id: 'a', text: 'A', actions: [{ id: 'a-b', label: 'To B', target: 'b' }] },
      {
        id: 'b',
        text: 'B',
        onFirstVisit: [{ type: 'giveItem', item: 'key' }],
        onEveryVisit: [{ type: 'changeCounter', counter: 'gold', by: 1 }],
        actions: [{ id: 'b-a', label: 'To A', target: 'a' }],
      },
    ]),
  );
  game.start();
  assert.equal(game.act('a-b'), true);
  assert.equal(game.state.pageId, 'b');
  assert.deepEqual(game.view().notices, [
    { kind: 'itemGained', item: 'key', count: 1 },
    { kind: 'counterChanged', counter: 'gold', by: 1 },
  ]);
  game.act('b-a');
  game.act('a-b');
  assert.equal(game.state.items.key, 1);
  assert.equal(game.state.counters.gold, 5);
  assert.equal(game.act('nope'), false);
});

test('conditional actions are hidden or locked, and "once" actions disappear', () => {
  const game = new Game(
    miniStory([
      {
        id: 'a',
        text: 'A',
        extraTexts: [{ when: { type: 'did', action: 'take' }, text: 'The table is empty.' }],
        actions: [
          { id: 'take', label: 'Take key', once: true, effects: [{ type: 'giveItem', item: 'key' }] },
          { id: 'door', label: 'Open door', target: 'b', when: { type: 'hasItem', item: 'key' }, lockedHint: 'Locked.' },
          { id: 'secret', label: 'Secret', target: 'b', when: { type: 'compare', left: { counter: 'gold' }, op: '>', right: 99 } },
        ],
      },
      { id: 'b', text: 'B', actions: [], ending: 'victory' },
    ]),
  );
  game.start();
  assert.deepEqual(game.view().actions, [
    { id: 'take', label: 'Take key', enabled: true },
    { id: 'door', label: 'Open door', enabled: false, hint: 'Locked.' },
  ]);
  assert.equal(game.act('door'), false, 'a locked action cannot be used');
  game.act('take');
  assert.deepEqual(
    game.view().actions.map((a) => [a.id, a.enabled]),
    [['door', true]],
  );
  assert.deepEqual(game.view().texts, ['A', 'The table is empty.']);
  game.act('door');
  assert.equal(game.view().status, 'ending');
});

test('goto, if and chance effects choose the next page', () => {
  const game = new Game(
    miniStory([
      {
        id: 'a',
        text: 'A',
        actions: [
          {
            id: 'try',
            label: 'Try',
            target: 'a',
            effects: [
              { type: 'if', when: { type: 'hasItem', item: 'key' }, then: [{ type: 'goto', page: 'b' }] },
              { type: 'chance', percent: 100, then: [{ type: 'giveItem', item: 'key' }] },
              { type: 'chance', percent: 0, then: [{ type: 'goto', page: 'b' }] },
            ],
          },
        ],
      },
      { id: 'b', text: 'B', actions: [], ending: 'neutral' },
    ]),
  );
  game.start();
  game.act('try');
  assert.equal(game.state.pageId, 'a');
  game.act('try');
  assert.equal(game.state.pageId, 'b');
});

test('a blow is roll + attack - defense, and a six always hurts', () => {
  assert.equal(strike(4, 3, 1).damage, 6);
  assert.equal(strike(2, 1, 9).damage, 0);
  assert.equal(strike(6, 0, 9).damage, 1);
});

const fightPages = (onLoseTarget?: string): Page[] => [
  {
    id: 'arena',
    text: 'Fight!',
    combat: {
      enemy: { name: 'Rat', hp: 6, attack: 1, defense: 0 },
      onWin: { effects: [{ type: 'giveItem', item: 'key' }] },
      onLose: onLoseTarget ? { target: onLoseTarget } : undefined,
      flee: { target: 'out', effects: [{ type: 'changeStat', stat: 'hp', by: -2 }] },
    },
    actions: [{ id: 'leave', label: 'Leave', target: 'out' }],
  },
  { id: 'out', text: 'Outside', actions: [{ id: 'back', label: 'Back', target: 'arena' }] },
];

test('winning a fight applies the outcome and the fight does not repeat', () => {
  const game = new Game(miniStory(fightPages()));
  game.start({}, 1);
  assert.equal(game.view().status, 'combat');
  assert.deepEqual(game.view().actions, [], 'no actions during a fight');
  assert.equal(game.act('leave'), false);
  assert.equal(fightToTheEnd(game), 'win');
  const last = game.state.combat!.last!;
  assert.equal(last.hero.damage, Math.max(0, last.hero.roll + 3 - 0));
  game.finishCombat();
  assert.equal(game.view().status, 'playing');
  assert.equal(game.state.items.key, 1);
  game.act('leave');
  game.act('back');
  assert.equal(game.view().status, 'playing', 'the rat stays defeated');
});

test('losing a fight ends the game, unless the author gave it a target', () => {
  const weak = { hero: { stats: { hp: 1, attack: 0, defense: 0 } } };
  const strongRat = (pages: Page[]) => {
    pages[0]!.combat!.enemy = { name: 'Rat', hp: 99, attack: 9, defense: 9 };
    return pages;
  };

  const deadly = new Game(miniStory(strongRat(fightPages()), weak));
  deadly.start({}, 1);
  assert.equal(fightToTheEnd(deadly), 'lose');
  deadly.finishCombat();
  assert.equal(deadly.view().status, 'dead');
  assert.equal(deadly.fightRound(), false);
  assert.equal(deadly.act('leave'), false);

  const merciful = new Game(miniStory(strongRat(fightPages('out')), weak));
  merciful.start({}, 1);
  assert.equal(fightToTheEnd(merciful), 'lose');
  merciful.finishCombat();
  assert.equal(merciful.state.pageId, 'out');
  assert.equal(merciful.state.stats.hp, 1);
  assert.equal(merciful.view().status, 'playing');
});

test('fleeing leaves the fight and applies its price', () => {
  const game = new Game(miniStory(fightPages()));
  game.start({}, 1);
  assert.equal(game.flee(), true);
  assert.equal(game.state.pageId, 'out');
  assert.equal(game.state.stats.hp, 8);
  game.act('back');
  assert.equal(game.view().status, 'combat', 'the rat is still there');
});

test('usable items heal up to the maximum and are consumed; bonuses count', () => {
  const game = new Game(
    miniStory([
      {
        id: 'a',
        text: 'A',
        onFirstVisit: [
          { type: 'giveItem', item: 'potion', count: 2 },
          { type: 'giveItem', item: 'sword' },
          { type: 'changeStat', stat: 'hp', by: -3 },
        ],
        actions: [{ id: 'stay', label: 'Stay' }],
      },
    ]),
  );
  game.start();
  assert.equal(game.view().hero.attack, 5);
  assert.equal(game.useItem('potion'), true);
  assert.equal(game.state.stats.hp, 10, 'healing stops at the maximum');
  assert.equal(game.state.items.potion, 1);
  assert.equal(game.useItem('sword'), false, 'a sword is not usable');
  assert.equal(game.useItem('key'), false, 'the hero has no key');
});

test('dying outside a fight ends the game', () => {
  const game = new Game(
    miniStory([
      { id: 'a', text: 'A', actions: [{ id: 'trap', label: 'Trap', target: 'b', effects: [{ type: 'changeStat', stat: 'hp', by: -99 }] }] },
      { id: 'b', text: 'B', actions: [] },
    ]),
  );
  game.start();
  game.act('trap');
  assert.equal(game.view().status, 'dead');
  assert.equal(game.state.pageId, 'a');
});

test('a broken link keeps the hero in place and tells the player', () => {
  const game = new Game(miniStory([{ id: 'a', text: 'A', actions: [{ id: 'go', label: 'Go', target: 'missing' }] }]));
  game.start();
  game.act('go');
  assert.equal(game.state.pageId, 'a');
  assert.deepEqual(game.view().notices, [{ kind: 'brokenLink', target: 'missing' }]);
});

test('a saved game continues exactly where it stopped, including the dice', () => {
  const story = loadSample('goblin-cave');
  const play = (game: Game) => {
    game.act('forest-bushes');
    fightToTheEnd(game);
    return JSON.stringify(game.state);
  };
  const original = new Game(story);
  original.start({ profession: 'knight', items: ['torch'] }, 42);
  original.act('village-forest');
  const saved = JSON.parse(JSON.stringify(original.state)) as GameState;

  const continued = new Game(story);
  assert.equal(continued.restore(saved), true);
  assert.equal(play(continued), play(original));

  const other = new Game(loadSample('ztracena-stanice'));
  assert.equal(other.restore(saved), false, 'a save from another story is refused');
});

test('random play-throughs of the samples never crash or get stuck', () => {
  for (const name of ['goblin-cave', 'ztracena-stanice']) {
    const story = loadSample(name);
    const endings = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const game = new Game(story);
      let random = seed;
      const pick = <T>(list: T[]): T => {
        random = (Math.imul(random, 1103515245) + 12345) & 0x7fffffff;
        // The low bits of this simple generator repeat quickly, so use the high ones.
        return list[(random >>> 16) % list.length]!;
      };
      const profession = story.professions.length > 0 ? pick(story.professions) : undefined;
      const kit = profession ?? story.hero;
      game.start({ profession: profession?.id, items: kit.choose?.from }, seed);
      let steps = 0;
      for (; steps < 2000; steps++) {
        const view = game.view();
        if (view.status === 'dead' || view.status === 'ending') {
          endings.add(view.status === 'dead' ? 'dead' : view.page.id);
          break;
        }
        assert.notEqual(view.status, 'deadEnd', `${name}: stuck on page ${view.page.id}`);
        if (view.status === 'combat') {
          if (view.combat!.outcome) game.finishCombat();
          else if (view.combat!.canFlee && pick([0, 1, 2, 3, 4]) === 0) game.flee();
          else game.fightRound();
        } else {
          const usable = view.items.filter((item) => item.usable);
          if (usable.length > 0 && pick([0, 1, 2, 3, 4, 5]) === 0) game.useItem(pick(usable).def.id);
          else game.act(pick(view.actions.filter((a) => a.enabled)).id);
        }
      }
      assert.ok(steps < 2000, `${name}: play-through ${seed} did not finish`);
    }
    assert.ok(endings.size >= 2, `${name}: expected several endings, got ${[...endings].join(', ')}`);
  }
});
