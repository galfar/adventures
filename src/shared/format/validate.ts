import type { Condition, Effect, Page, PageId, StartingKit, Story, Value } from './types.ts';
import { FORMAT_VERSION } from './types.ts';

/**
 * A problem found in a story. Problems are data (a code plus the place), not text,
 * so that the editor can show them in the user's language and jump to the place.
 */
export interface Problem {
  /** `error`: the player cannot run the story. `warning`: playable, but probably a mistake. */
  level: 'error' | 'warning';
  code:
    | 'duplicateId'
    | 'missingStartPage'
    | 'unknownPage'
    | 'unknownItem'
    | 'unknownCounter'
    | 'unknownProfession'
    | 'unknownAction'
    | 'chooseTooMany'
    | 'emptyLabel'
    | 'unreachablePage'
    | 'deadEnd';
  pageId?: PageId;
  /** The id that is duplicated or not found. */
  ref?: string;
}

/**
 * Turns parsed JSON into a Story with all optional lists present, so the engine never
 * has to check for missing arrays. Throws only when the data is not a story at all.
 */
export function normalizeStory(raw: unknown): Story {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Story).pages)) {
    throw new Error('Not an adventure story file.');
  }
  const story = raw as Story;
  if (typeof story.format === 'number' && story.format > FORMAT_VERSION) {
    throw new Error(`The story needs a newer player (format ${story.format}).`);
  }
  story.format ??= FORMAT_VERSION;
  story.id ??= 'story';
  story.title ??= '';
  story.language ??= 'en';
  story.hero ??= { stats: { hp: 20, attack: 2, defense: 2 } };
  story.professions ??= [];
  story.items ??= [];
  story.counters ??= [];
  for (const page of story.pages) {
    page.text ??= '';
    page.actions ??= [];
  }
  story.startPage ??= story.pages[0]?.id ?? '';
  return story;
}

/** Calls `visit` for every effect in the list, including the ones nested in if/chance. */
export function forEachEffect(effects: Effect[] | undefined, visit: (effect: Effect) => void): void {
  for (const effect of effects ?? []) {
    visit(effect);
    if (effect.type === 'if' || effect.type === 'chance') {
      forEachEffect(effect.then, visit);
      forEachEffect(effect.else, visit);
    }
  }
}

/** Calls `visit` for the condition and every condition nested in it. */
export function forEachCondition(cond: Condition | undefined, visit: (cond: Condition) => void): void {
  if (!cond) return;
  visit(cond);
  if (cond.type === 'and') cond.all.forEach((c) => forEachCondition(c, visit));
  else if (cond.type === 'or') cond.any.forEach((c) => forEachCondition(c, visit));
  else if (cond.type === 'not') forEachCondition(cond.cond, visit);
}

/** All effect lists and conditions of one page, with the pages they can lead to. */
function pageParts(page: Page): { effects: Effect[]; conditions: Condition[]; targets: PageId[] } {
  const effects: Effect[] = [];
  const conditions: Condition[] = [];
  const targets: PageId[] = [];
  const addEffects = (list: Effect[] | undefined) => {
    forEachEffect(list, (effect) => {
      effects.push(effect);
      if (effect.type === 'goto') targets.push(effect.page);
      if (effect.type === 'if') conditions.push(effect.when);
    });
  };
  addEffects(page.onFirstVisit);
  addEffects(page.onEveryVisit);
  for (const extra of page.extraTexts ?? []) conditions.push(extra.when);
  for (const action of page.actions) {
    if (action.when) conditions.push(action.when);
    if (action.target !== undefined) targets.push(action.target);
    addEffects(action.effects);
  }
  if (page.combat) {
    for (const outcome of [page.combat.onWin, page.combat.onLose, page.combat.flee]) {
      if (outcome?.target !== undefined) targets.push(outcome.target);
      addEffects(outcome?.effects);
    }
  }
  return { effects, conditions, targets };
}

/** Checks a normalized story and returns everything that looks wrong. */
export function validateStory(story: Story): Problem[] {
  const problems: Problem[] = [];

  const idSet = (list: { id: string }[], pageOf?: (index: number) => PageId): Set<string> => {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      if (seen.has(entry.id)) problems.push({ level: 'error', code: 'duplicateId', ref: entry.id, pageId: pageOf?.(i) });
      seen.add(entry.id);
    });
    return seen;
  };
  const pageIds = idSet(story.pages);
  const itemIds = idSet(story.items);
  const counterIds = idSet(story.counters);
  const professionIds = idSet(story.professions);
  const actionOwners = story.pages.flatMap((page) => page.actions.map(() => page.id));
  const actionIds = idSet(
    story.pages.flatMap((page) => page.actions),
    (i) => actionOwners[i]!,
  );

  if (!pageIds.has(story.startPage)) {
    problems.push({ level: 'error', code: 'missingStartPage', ref: story.startPage });
  }

  const checkItem = (id: string, pageId?: PageId) => {
    if (!itemIds.has(id)) problems.push({ level: 'warning', code: 'unknownItem', ref: id, pageId });
  };
  const checkCounter = (id: string, pageId?: PageId) => {
    if (!counterIds.has(id)) problems.push({ level: 'warning', code: 'unknownCounter', ref: id, pageId });
  };
  const checkValue = (value: Value, pageId?: PageId) => {
    if (typeof value === 'number') return;
    if ('counter' in value) checkCounter(value.counter, pageId);
    if ('itemCount' in value) checkItem(value.itemCount, pageId);
  };
  const checkEffects = (effects: Effect[], pageId?: PageId) => {
    for (const effect of effects) {
      if (effect.type === 'giveItem' || effect.type === 'takeItem') checkItem(effect.item, pageId);
      if (effect.type === 'changeCounter' || effect.type === 'setCounter') checkCounter(effect.counter, pageId);
    }
  };
  const checkConditions = (conditions: Condition[], pageId?: PageId) => {
    for (const root of conditions) {
      forEachCondition(root, (cond) => {
        if (cond.type === 'hasItem') checkItem(cond.item, pageId);
        if (cond.type === 'compare') {
          checkValue(cond.left, pageId);
          checkValue(cond.right, pageId);
        }
        if ((cond.type === 'visited' || cond.type === 'won') && !pageIds.has(cond.page)) {
          problems.push({ level: 'warning', code: 'unknownPage', ref: cond.page, pageId });
        }
        if (cond.type === 'did' && !actionIds.has(cond.action)) {
          problems.push({ level: 'warning', code: 'unknownAction', ref: cond.action, pageId });
        }
        if (cond.type === 'profession' && !professionIds.has(cond.profession)) {
          problems.push({ level: 'warning', code: 'unknownProfession', ref: cond.profession, pageId });
        }
      });
    }
  };

  const checkKit = (kit: StartingKit) => {
    for (const grant of kit.items ?? []) checkItem(grant.item);
    for (const id of kit.choose?.from ?? []) checkItem(id);
    if (kit.choose && kit.choose.count > kit.choose.from.length) {
      problems.push({ level: 'warning', code: 'chooseTooMany' });
    }
  };
  if (story.professions.length === 0) checkKit(story.hero);
  story.professions.forEach(checkKit);

  for (const item of story.items) {
    const effects: Effect[] = [];
    forEachEffect(item.use?.effects, (effect) => effects.push(effect));
    checkEffects(effects);
  }

  // Pages: broken links, dead ends, and which pages can be reached from the start.
  const links = new Map<PageId, PageId[]>();
  for (const page of story.pages) {
    const parts = pageParts(page);
    links.set(page.id, parts.targets);
    checkEffects(parts.effects, page.id);
    checkConditions(parts.conditions, page.id);
    if (page.actions.some((action) => action.label.trim() === '')) {
      problems.push({ level: 'warning', code: 'emptyLabel', pageId: page.id });
    }
    for (const target of parts.targets) {
      if (!pageIds.has(target)) problems.push({ level: 'warning', code: 'unknownPage', ref: target, pageId: page.id });
    }
    if (!page.ending && parts.targets.length === 0) {
      problems.push({ level: 'warning', code: 'deadEnd', pageId: page.id });
    }
  }
  const reached = new Set<PageId>();
  const queue: PageId[] = pageIds.has(story.startPage) ? [story.startPage] : [];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...(links.get(id) ?? []));
  }
  for (const page of story.pages) {
    if (!reached.has(page.id)) problems.push({ level: 'warning', code: 'unreachablePage', pageId: page.id });
  }

  return problems;
}
