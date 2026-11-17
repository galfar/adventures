import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addAction, addPage, deletePage, ensurePositions, moveAction, newStory, pageLabel, pageLinks, restorePage } from '../src/editor/ops.ts';
import { Store } from '../src/editor/store.ts';
import type { EditorDoc } from '../src/shared/db.ts';
import { validateStory } from '../src/shared/format/validate.ts';

const newDoc = (): EditorDoc => ({ story: newStory('Test', 'en'), trash: [] });

test('a new story is valid apart from its single empty page leading nowhere', () => {
  assert.deepEqual(
    validateStory(newDoc().story).map((p) => p.code),
    ['deadEnd'],
  );
});

test('undo and redo walk through the changes', () => {
  const store = new Store({ n: 0 });
  let calls = 0;
  store.onChange = () => calls++;
  store.change((d) => void (d.n = 1));
  store.change((d) => void (d.n = 2));
  assert.equal(store.undo(), true);
  assert.equal(store.current.n, 1);
  assert.equal(store.redo(), true);
  assert.equal(store.current.n, 2);
  store.undo();
  store.change((d) => void (d.n = 5));
  assert.equal(store.canRedo, false, 'a new change forgets the redo steps');
  store.undo();
  store.undo();
  assert.equal(store.current.n, 0);
  assert.equal(store.undo(), false);
  assert.equal(calls, 8);
});

test('a change never modifies earlier versions', () => {
  const store = new Store({ list: [1] });
  const before = store.current;
  store.change((d) => d.list.push(2));
  assert.deepEqual(before.list, [1]);
  assert.deepEqual(store.current.list, [1, 2]);
});

test('typing in one field becomes one undo step, until a pause or another field', () => {
  const store = new Store({ a: '', b: '' });
  store.change((d) => void (d.a = 'h'), { merge: 'a' }, 1000);
  store.change((d) => void (d.a = 'he'), { merge: 'a' }, 1200);
  store.change((d) => void (d.a = 'hey'), { merge: 'a' }, 1400);
  assert.equal(store.past.length, 1);
  store.change((d) => void (d.a = 'hey!'), { merge: 'a' }, 9000);
  assert.equal(store.past.length, 2, 'a pause starts a new step');
  store.change((d) => void (d.b = 'x'), { merge: 'b' }, 9100);
  assert.equal(store.past.length, 3, 'another field starts a new step');
  store.undo();
  store.undo();
  assert.equal(store.current.a, 'hey');
  store.undo();
  assert.equal(store.current.a, '');
});

test('long continuous typing is split into several undo steps', () => {
  const store = new Store({ a: '' });
  for (let time = 0; time <= 20_000; time += 500) store.change((d) => void (d.a += 'x'), { merge: 'a' }, time);
  assert.ok(store.past.length >= 3);
});

test('a deleted page goes to the trash and can be put back with its links intact', () => {
  const doc = newDoc();
  const cave = addPage(doc, { x: 233, y: 148 });
  assert.deepEqual(cave.pos, { x: 240, y: 140 }, 'pages snap to the grid');
  const action = addAction(doc, 'start', cave.id)!;
  action.label = 'Enter the cave';

  assert.equal(deletePage(doc, cave.id, 123), true);
  assert.equal(doc.story.pages.length, 1);
  assert.deepEqual(doc.trash, [{ page: cave, deletedAt: 123 }]);
  assert.ok(validateStory(doc.story).some((p) => p.code === 'unknownPage'), 'the broken link is reported');

  assert.equal(restorePage(doc, 0)?.id, cave.id);
  assert.equal(doc.trash.length, 0);
  assert.equal(validateStory(doc.story).some((p) => p.code === 'unknownPage'), false);
});

test('the last page cannot be deleted, and deleting the start page picks a new start', () => {
  const doc = newDoc();
  assert.equal(deletePage(doc, 'start'), false);
  const other = addPage(doc, { x: 0, y: 200 });
  assert.equal(deletePage(doc, 'start'), true);
  assert.equal(doc.story.startPage, other.id);
});

test('choices can be reordered', () => {
  const doc = newDoc();
  const a = addAction(doc, 'start')!;
  const b = addAction(doc, 'start')!;
  assert.notEqual(a.id, b.id);
  moveAction(doc, 'start', b.id, -1);
  assert.deepEqual(
    doc.story.pages[0]!.actions.map((x) => x.id),
    [b.id, a.id],
  );
  moveAction(doc, 'start', b.id, -1);
  assert.equal(doc.story.pages[0]!.actions[0]!.id, b.id, 'moving past the end does nothing');
});

test('map arrows include choices, jumps inside effects and fight outcomes', () => {
  const links = pageLinks({
    id: 'a',
    text: '',
    actions: [
      { id: 'go', label: 'Go', target: 'b', when: { type: 'hasItem', item: 'key' } },
      { id: 'luck', label: 'Try', effects: [{ type: 'chance', percent: 50, then: [{ type: 'goto', page: 'c' }] }] },
    ],
    combat: { enemy: { name: 'Rat', hp: 1, attack: 1, defense: 0 }, onWin: { target: 'd' }, flee: { target: 'e' } },
  });
  assert.deepEqual(
    links.map((l) => `${l.kind}:${l.target}:${l.conditional}`),
    ['action:b:true', 'jump:c:true', 'win:d:false', 'flee:e:false'],
  );
});

test('pages without a position get one, and labels fall back to the text', () => {
  const doc = newDoc();
  doc.story.pages.push({ id: 'x', text: 'A dark  **cave**.', actions: [] });
  ensurePositions(doc.story);
  assert.ok(doc.story.pages.every((page) => page.pos));
  assert.equal(pageLabel(doc.story.pages[1]!, '?'), 'A dark cave.');
  assert.equal(pageLabel(doc.story.pages[0]!, 'Empty page'), 'Empty page');
});
