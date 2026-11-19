import type { EditorDoc } from '../shared/db.ts';
import { FORMAT_VERSION, type Action, type ActionId, type Effect, type Page, type PageId, type Story } from '../shared/format/types.ts';
import { forEachEffect } from '../shared/format/validate.ts';
import type { Rule } from './rules/convert.ts';

/**
 * The editing operations, as plain functions that modify a document copy.
 * They are used inside `store.change(doc => …)` and have no knowledge of the screen,
 * so they can be tested on their own.
 */

/** Pages snap to this grid on the map. */
export const GRID = 20;
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;

const TRASH_LIMIT = 100;

/** A short id nobody has to type or see, unique among `taken`. */
export function newId(prefix: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

export function newStory(title: string, language: string): Story {
  return {
    format: FORMAT_VERSION,
    id: newId('story') + Date.now().toString(36),
    title,
    language,
    theme: 'fantasy',
    startPage: 'start',
    hero: { stats: { hp: 20, attack: 3, defense: 2 } },
    professions: [],
    items: [],
    counters: [],
    pages: [{ id: 'start', text: '', actions: [], pos: { x: 0, y: 0 } }],
  };
}

export function findPage(story: Story, id: PageId | undefined): Page | undefined {
  return story.pages.find((page) => page.id === id);
}

/** What a page is called on the map and in lists: its title, or the start of its text. */
export function pageLabel(page: Page, fallback: string): string {
  const text = (page.title || page.text).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 42 ? `${text.slice(0, 41)}…` : text;
}

/** Gives a map position to every page that has none (stories made outside the editor). */
export function ensurePositions(story: Story): void {
  const placed = story.pages.filter((page) => page.pos);
  let row = placed.length > 0 ? Math.max(...placed.map((page) => page.pos!.y)) + 140 : 0;
  let column = 0;
  for (const page of story.pages) {
    if (page.pos) continue;
    page.pos = { x: column * 240, y: row };
    if (++column === 5) {
      column = 0;
      row += 140;
    }
  }
}

const snap = (value: number) => Math.round(value / GRID) * GRID;

export function addPage(doc: EditorDoc, pos: { x: number; y: number }): Page {
  const page: Page = {
    id: newId(
      'p',
      doc.story.pages.map((p) => p.id),
    ),
    text: '',
    actions: [],
    pos: { x: snap(pos.x), y: snap(pos.y) },
  };
  doc.story.pages.push(page);
  return page;
}

/** A free spot for a new page next to an existing one. */
export function spotNear(story: Story, page: Page): { x: number; y: number } {
  const base = page.pos ?? { x: 0, y: 0 };
  const taken = (x: number, y: number) =>
    story.pages.some((p) => p.pos && Math.abs(p.pos.x - x) < NODE_WIDTH + GRID && Math.abs(p.pos.y - y) < NODE_HEIGHT + GRID);
  for (let ring = 0; ring < 30; ring++) {
    for (const dx of [240, 0, -240]) {
      const x = base.x + dx;
      const y = base.y + 140 * (ring + (dx === 240 ? 0 : 1));
      if (!taken(x, y)) return { x, y };
    }
  }
  return { x: base.x + 240, y: base.y };
}

/**
 * Moves a page to the trash. Links that pointed to it are kept, so putting the page
 * back repairs them. The last page cannot be deleted. Returns whether it was deleted.
 */
export function deletePage(doc: EditorDoc, pageId: PageId, now: number = Date.now()): boolean {
  const story = doc.story;
  const index = story.pages.findIndex((page) => page.id === pageId);
  if (index < 0 || story.pages.length <= 1) return false;
  const [page] = story.pages.splice(index, 1);
  doc.trash.unshift({ page: page!, deletedAt: now });
  doc.trash.length = Math.min(doc.trash.length, TRASH_LIMIT);
  if (story.startPage === pageId) story.startPage = story.pages[0]!.id;
  return true;
}

/** Puts a page from the trash back on the map. */
export function restorePage(doc: EditorDoc, trashIndex: number): Page | undefined {
  const [entry] = doc.trash.splice(trashIndex, 1);
  if (!entry) return undefined;
  const page = entry.page;
  const ids = doc.story.pages.map((p) => p.id);
  if (ids.includes(page.id)) page.id = newId('p', ids);
  doc.story.pages.push(page);
  return page;
}

function allActionIds(story: Story): string[] {
  return story.pages.flatMap((page) => page.actions.map((action) => action.id));
}

export function addAction(doc: EditorDoc, pageId: PageId, target?: PageId): Action | undefined {
  const page = findPage(doc.story, pageId);
  if (!page) return undefined;
  const action: Action = { id: newId('a', allActionIds(doc.story)), label: '', target };
  page.actions.push(action);
  return action;
}

export function moveAction(doc: EditorDoc, pageId: PageId, actionId: ActionId, by: -1 | 1): void {
  const actions = findPage(doc.story, pageId)?.actions;
  if (!actions) return;
  const from = actions.findIndex((action) => action.id === actionId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= actions.length) return;
  [actions[from], actions[to]] = [actions[to]!, actions[from]!];
}

/** Puts a copy of a choice right after it. Its rules are copied too. */
export function duplicateAction(doc: EditorDoc, pageId: PageId, actionId: ActionId): Action | undefined {
  const actions = findPage(doc.story, pageId)?.actions;
  const index = actions?.findIndex((action) => action.id === actionId) ?? -1;
  if (!actions || index < 0) return undefined;
  const copy: Action = { ...structuredClone(actions[index]!), id: newId('a', allActionIds(doc.story)) };
  actions.splice(index + 1, 0, copy);
  return copy;
}

/**
 * Puts a copy of a page next to it, with all its choices and rules. Whatever inside the
 * page referred to the page itself or to its own choices (its own fight, "the chest was
 * already opened") now refers to the copy; references to other pages stay as they are.
 */
export function duplicatePage(doc: EditorDoc, pageId: PageId, title: (old: string) => string): Page | undefined {
  const original = findPage(doc.story, pageId);
  if (!original) return undefined;
  const copy = structuredClone(original);
  copy.id = newId(
    'p',
    doc.story.pages.map((page) => page.id),
  );
  const taken = allActionIds(doc.story);
  const renamed = new Map<string, string>();
  for (const action of copy.actions) {
    const id = newId('a', taken);
    taken.push(id);
    renamed.set(action.id, id);
    action.id = id;
  }
  const remap = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(remap);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const [key, inner] of Object.entries(record)) {
      if (key === 'action' && typeof inner === 'string' && renamed.has(inner)) record[key] = renamed.get(inner);
      else if ((key === 'page' || key === 'target') && inner === pageId) record[key] = copy.id;
      else remap(inner);
    }
  };
  remap(copy);
  copy.title = title(original.title ?? '');
  copy.pos = spotNear(doc.story, original);
  doc.story.pages.push(copy);
  return copy;
}

/**
 * Adds copied rules to existing ones: conditions must both hold, effects run one after the
 * other. Only the parts this place can hold are taken (a condition has no effects).
 */
export function combineRules(existing: Rule, pasted: Rule, kind: 'choice' | 'effects' | 'condition'): Rule {
  const result: Rule = {};
  const when = kind === 'effects' ? existing.when : pasted.when && existing.when ? { type: 'and' as const, all: [existing.when, pasted.when] } : (pasted.when ?? existing.when);
  const effects = kind === 'condition' ? existing.effects : [...(existing.effects ?? []), ...(pasted.effects ?? [])];
  if (when) result.when = structuredClone(when);
  if (effects?.length) result.effects = structuredClone(effects);
  return result;
}

/** Whether copied rules have anything that this place can hold. */
export function canPasteRules(pasted: Rule, kind: 'choice' | 'effects' | 'condition'): boolean {
  return (kind !== 'effects' && !!pasted.when) || (kind !== 'condition' && !!pasted.effects?.length);
}

/** A copy of a story for a new project: new story id, everything else the same. */
export function copyStory(story: Story, title: string): Story {
  const copy = structuredClone(story);
  copy.id = newId('story') + Date.now().toString(36);
  copy.title = title;
  return copy;
}

/** Every picture a story refers to. */
export function assetRefs(story: Story): string[] {
  const refs = [
    story.cover,
    ...story.pages.flatMap((page) => [page.image, page.combat?.enemy.image]),
    ...story.items.map((item) => item.image),
    ...story.professions.map((profession) => profession.image),
  ];
  return [...new Set(refs.filter((ref): ref is string => !!ref))];
}

/** An arrow on the map. */
export interface Link {
  target: PageId;
  kind: 'action' | 'jump' | 'win' | 'lose' | 'flee';
  /** The choice's own text; empty for fight outcomes and arrival jumps. */
  label: string;
  /** Not always taken: the choice has a condition, or the jump is inside an effect. */
  conditional: boolean;
  actionId?: ActionId;
}

/** Everywhere a page can lead: its choices, jumps hidden in effects, and fight outcomes. */
export function pageLinks(page: Page): Link[] {
  const links: Link[] = [];
  const jumps = (effects: Effect[] | undefined, kind: Link['kind'], label: string, actionId?: ActionId) => {
    forEachEffect(effects, (effect) => {
      if (effect.type === 'goto') links.push({ target: effect.page, kind, label, conditional: true, actionId });
    });
  };
  for (const action of page.actions) {
    if (action.target !== undefined) {
      links.push({ target: action.target, kind: 'action', label: action.label, conditional: !!action.when, actionId: action.id });
    }
    jumps(action.effects, 'jump', action.label, action.id);
  }
  jumps(page.onFirstVisit, 'jump', '');
  jumps(page.onEveryVisit, 'jump', '');
  const combat = page.combat;
  if (combat) {
    for (const [kind, outcome] of [
      ['win', combat.onWin],
      ['lose', combat.onLose],
      ['flee', combat.flee],
    ] as const) {
      if (outcome?.target !== undefined) links.push({ target: outcome.target, kind, label: '', conditional: false });
      jumps(outcome?.effects, kind, '');
    }
  }
  return links;
}
