import type { ActionId, CompareOp, Condition, CounterId, Effect, ItemId, PageId, StatName, Story, Value } from '../format/types.ts';

/**
 * What one page asks about: everything its conditions look at, with a value that makes
 * each condition true. Used when play-testing from a page, so the author can start with
 * the key that would normally be found three pages earlier.
 *
 * Things the hero can do on the page itself (its own choices, its own fight) are left
 * out: those are what the test is for.
 */
export interface PageNeeds {
  items: Map<ItemId, number>;
  counters: Map<CounterId, number | undefined>;
  stats: Map<StatName, number | undefined>;
  did: Set<ActionId>;
  visited: Set<PageId>;
  won: Set<PageId>;
}

/** A starting state for play-testing, applied on top of the hero's normal start. */
export interface TestKit {
  items?: Record<ItemId, number>;
  counters?: Record<CounterId, number>;
  stats?: Partial<Record<StatName, number>>;
  did?: ActionId[];
  visited?: PageId[];
  won?: PageId[];
}

export function pageNeeds(story: Story, pageId: PageId): PageNeeds {
  const needs: PageNeeds = { items: new Map(), counters: new Map(), stats: new Map(), did: new Set(), visited: new Set(), won: new Set() };
  const page = story.pages.find((p) => p.id === pageId);
  if (!page) return needs;
  const ownActions = new Set(page.actions.map((a) => a.id));

  /** Keeps the largest wanted number, so `>= 4` and `>= 8` are both true. */
  const want = <K>(map: Map<K, number | undefined>, key: K, value: number | undefined) => {
    const before = map.get(key);
    map.set(key, value === undefined ? before : Math.max(before ?? value, value));
  };
  const wantItem = (item: ItemId, count: number) => needs.items.set(item, Math.max(needs.items.get(item) ?? count, count));
  const ref = (value: Value, wanted: number | undefined) => {
    if (typeof value === 'number') return;
    if ('itemCount' in value) wantItem(value.itemCount, wanted ?? 1);
    else if ('counter' in value) want(needs.counters, value.counter, wanted);
    else want(needs.stats, value.stat, wanted);
  };
  const condition = (c: Condition | undefined): void => {
    switch (c?.type) {
      case 'hasItem':
        wantItem(c.item, c.count ?? 1);
        break;
      case 'did':
        if (!ownActions.has(c.action)) needs.did.add(c.action);
        break;
      case 'visited':
        if (c.page !== pageId) needs.visited.add(c.page);
        break;
      case 'won':
        if (c.page !== pageId) needs.won.add(c.page);
        break;
      case 'compare':
        if (typeof c.right === 'number') ref(c.left, satisfy(c.op, c.right));
        else if (typeof c.left === 'number') ref(c.right, satisfy(mirror(c.op), c.left));
        else {
          ref(c.left, undefined);
          ref(c.right, undefined);
        }
        break;
      case 'and':
        c.all.forEach(condition);
        break;
      case 'or':
        c.any.forEach(condition);
        break;
      case 'not':
        condition(c.cond);
        break;
      default:
      // `profession` is chosen on the hero screen; unknown types are skipped.
    }
  };
  const effects = (list: Effect[] | undefined): void => {
    for (const effect of list ?? []) {
      if (effect.type === 'if') {
        condition(effect.when);
        effects(effect.then);
        effects(effect.else);
      } else if (effect.type === 'chance') {
        effects(effect.then);
        effects(effect.else);
      }
    }
  };

  for (const action of page.actions) {
    condition(action.when);
    effects(action.effects);
  }
  for (const extra of page.extraTexts ?? []) condition(extra.when);
  effects(page.onFirstVisit);
  effects(page.onEveryVisit);
  effects(page.combat?.onWin?.effects);
  effects(page.combat?.onLose?.effects);
  effects(page.combat?.flee?.effects);
  return needs;
}

/** A value that makes `x op n` true. */
function satisfy(op: CompareOp, n: number): number {
  switch (op) {
    case '>':
    case '!=':
      return n + 1;
    case '<':
      return Math.max(0, n - 1);
    default:
      return n;
  }
}

/** `n op x` written as `x op' n`. */
function mirror(op: CompareOp): CompareOp {
  const mirrored: Partial<Record<CompareOp, CompareOp>> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
  return mirrored[op] ?? op;
}
