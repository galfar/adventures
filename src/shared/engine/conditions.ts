import type {
  Action,
  Condition,
  CounterDef,
  ItemDef,
  Page,
  Profession,
  StatName,
  Story,
  Value,
} from '../format/types.ts';
import type { GameState } from './state.ts';

/** Quick lookups by id, built once per story. */
export interface StoryIndex {
  pages: Map<string, Page>;
  items: Map<string, ItemDef>;
  counters: Map<string, CounterDef>;
  professions: Map<string, Profession>;
  actions: Map<string, Action>;
}

export function buildIndex(story: Story): StoryIndex {
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((entry) => [entry.id, entry]));
  return {
    pages: byId(story.pages),
    items: byId(story.items),
    counters: byId(story.counters),
    professions: byId(story.professions),
    actions: byId(story.pages.flatMap((page) => page.actions)),
  };
}

/** A stat including the bonuses of carried items. */
export function effectiveStat(state: GameState, index: StoryIndex, stat: StatName): number {
  let value = state.stats[stat];
  if (stat === 'attack' || stat === 'defense') {
    for (const [id, count] of Object.entries(state.items)) {
      if (count > 0) value += index.items.get(id)?.bonus?.[stat] ?? 0;
    }
  }
  return value;
}

function valueOf(value: Value, state: GameState, index: StoryIndex): number {
  if (typeof value === 'number') return value;
  if ('stat' in value) return effectiveStat(state, index, value.stat);
  if ('counter' in value) return state.counters[value.counter] ?? 0;
  if ('itemCount' in value) return state.items[value.itemCount] ?? 0;
  return 0;
}

/** Evaluates a condition. A missing condition is true; an unknown kind is false. */
export function test(cond: Condition | undefined, state: GameState, index: StoryIndex): boolean {
  if (!cond) return true;
  switch (cond.type) {
    case 'hasItem':
      return (state.items[cond.item] ?? 0) >= (cond.count ?? 1);
    case 'did':
      return (state.done[cond.action] ?? 0) > 0;
    case 'visited':
      return (state.visits[cond.page] ?? 0) > 0;
    case 'won':
      return state.won[cond.page] === true;
    case 'profession':
      return state.profession === cond.profession;
    case 'compare': {
      const left = valueOf(cond.left, state, index);
      const right = valueOf(cond.right, state, index);
      switch (cond.op) {
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '=':
          return left === right;
        case '!=':
          return left !== right;
        case '>=':
          return left >= right;
        case '>':
          return left > right;
        default:
          return false;
      }
    }
    case 'and':
      return cond.all.every((c) => test(c, state, index));
    case 'or':
      return cond.any.some((c) => test(c, state, index));
    case 'not':
      return !test(cond.cond, state, index);
    default:
      return false;
  }
}
