import type { ActionId, CounterId, ItemId, PageId, ProfessionId, StatName } from '../format/types.ts';

export const STATE_VERSION = 1;

/**
 * Everything that changes while playing. Plain JSON on purpose: saving a game is
 * `JSON.stringify(state)` and continuing later is `JSON.parse`.
 */
export interface GameState {
  version: number;
  storyId: string;
  profession?: ProfessionId;
  /** Base values, without item bonuses. */
  stats: Record<StatName, number>;
  /** How many pieces of each item the hero carries. */
  items: Record<ItemId, number>;
  counters: Record<CounterId, number>;
  /** How many times each page was entered. */
  visits: Record<PageId, number>;
  /** How many times each action was used. */
  done: Record<ActionId, number>;
  /** Pages whose fight was won. */
  won: Record<PageId, boolean>;
  pageId: PageId;
  /**
   * Where the hero goes next, once the player has read what just happened ("continue").
   * Set when a choice told the player something and then leads to another page, so
   * the result shows on the page where it happened, not on the next one.
   */
  moveTo?: PageId;
  /** Present while a fight is going on. */
  combat?: CombatState;
  over?: 'dead';
  /** State of the random number generator, so dice rolls survive a reload. */
  rng: number;
  /** What happened during the last command, for the player to show ("You got: Key"). */
  notices: Notice[];
}

export interface CombatState {
  enemyHp: number;
  round: number;
  last?: RoundLog;
  /** Set when the fight is decided; the player then confirms with "continue". */
  outcome?: 'win' | 'lose';
}

/** One blow: `roll + attack - defense = damage`. */
export interface StrikeLog {
  roll: number;
  attack: number;
  defense: number;
  damage: number;
}

export interface RoundLog {
  hero: StrikeLog;
  /** Missing when the enemy fell before it could strike back. */
  enemy?: StrikeLog;
}

/** Things worth telling the player about. */
export type Notice =
  | { kind: 'itemGained'; item: ItemId; count: number }
  | { kind: 'itemLost'; item: ItemId; count: number }
  | { kind: 'itemUsed'; item: ItemId }
  | { kind: 'statChanged'; stat: StatName; by: number }
  | { kind: 'counterChanged'; counter: CounterId; by: number }
  | { kind: 'message'; text: string }
  /** An action pointed to a page that does not exist (unfinished story). */
  | { kind: 'brokenLink'; target: PageId };

/**
 * Everything that happens in the game, in order. The player shows the notices; other
 * listeners can react to the rest (later: sound effects, switching to combat music).
 */
export type GameEvent =
  | Notice
  | { kind: 'pageEnter'; page: PageId }
  | { kind: 'action'; action: ActionId }
  | { kind: 'combatStart'; page: PageId }
  | { kind: 'combatRound'; round: RoundLog }
  | { kind: 'combatEnd'; page: PageId; outcome: 'win' | 'lose' | 'fled' }
  | { kind: 'ending'; page: PageId; ending: 'victory' | 'defeat' | 'neutral' }
  | { kind: 'gameOver' };

const NOTICE_KINDS = new Set<GameEvent['kind']>([
  'itemGained',
  'itemLost',
  'itemUsed',
  'statChanged',
  'counterChanged',
  'message',
  'brokenLink',
]);

export function isNotice(event: GameEvent): event is Notice {
  return NOTICE_KINDS.has(event.kind);
}
