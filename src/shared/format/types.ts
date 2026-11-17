/**
 * Adventure story format, version 1.
 *
 * A story is plain JSON (`story.json`). Pictures are separate files referenced by a
 * relative path (`images/cave.jpg`). The same data is used by the player, the editor,
 * the ZIP package and the single-file HTML export.
 *
 * Design rules:
 * - Everything a simple page needs is `text` + `actions` with a `label` and a `target`.
 *   All other fields are optional.
 * - Conditions and effects are small JSON trees that map one-to-one to editor blocks.
 * - Readers must ignore unknown fields and unknown effect/condition types, so that a
 *   newer editor (e.g. one that adds sounds) does not break an older player.
 */

export const FORMAT_VERSION = 1;

export type PageId = string;
export type ActionId = string;
export type ItemId = string;
export type CounterId = string;
export type ProfessionId = string;
/** Relative path of a picture inside the story package, e.g. `images/forest.png`. */
export type AssetRef = string;

export type StatName = 'hp' | 'maxHp' | 'attack' | 'defense';

export interface Story {
  /** Format version, see FORMAT_VERSION. */
  format: number;
  /** Unique id of the story; saved games are stored under it. */
  id: string;
  title: string;
  author?: string;
  description?: string;
  /** Language of the story text; the player shows its own buttons in this language. */
  language: string;
  /** Id of a predefined visual style: `fantasy` (default), `neutral`, `scifi`. */
  theme?: string;
  cover?: AssetRef;
  startPage: PageId;
  /** Starting stats and items of the hero when the story defines no professions. */
  hero: StartingKit;
  /** If not empty, the player picks one at the start and gets its kit instead of `hero`. */
  professions: Profession[];
  items: ItemDef[];
  counters: CounterDef[];
  pages: Page[];
}

export interface StartingKit {
  stats: { hp: number; attack: number; defense: number };
  /** Items the hero always starts with. */
  items?: ItemGrant[];
  /** "Pick `count` of these items" at the start. */
  choose?: { count: number; from: ItemId[] };
}

export interface Profession extends StartingKit {
  id: ProfessionId;
  name: string;
  description?: string;
  image?: AssetRef;
}

export interface ItemGrant {
  item: ItemId;
  /** Default 1. */
  count?: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description?: string;
  image?: AssetRef;
  /** Passive bonus while the item is carried (counted once, however many are carried). */
  bonus?: { attack?: number; defense?: number };
  /** Makes the item usable from the bag, e.g. a healing potion. */
  use?: {
    effects: Effect[];
    /** Default true: one piece is removed when used. */
    consumed?: boolean;
  };
}

/** A named number owned by the story, e.g. gold or score. */
export interface CounterDef {
  id: CounterId;
  name: string;
  start: number;
  min?: number;
  max?: number;
  /** Show the counter in the status bar during play. */
  show?: boolean;
  /** Short symbol (emoji) shown next to the value. */
  icon?: string;
}

export interface Page {
  id: PageId;
  /** Optional heading; the editor also uses it as the label of the page on the map. */
  title?: string;
  /** Paragraphs separated by an empty line. `**bold**` and `*italic*` are supported. */
  text: string;
  image?: AssetRef;
  /** Extra paragraphs shown only when their condition holds. */
  extraTexts?: ConditionalText[];
  /** Runs the first time the hero enters the page (typical place for pick-ups). */
  onFirstVisit?: Effect[];
  /** Runs every time the hero enters the page. */
  onEveryVisit?: Effect[];
  /** A fight that must be resolved before the actions become available. */
  combat?: Combat;
  actions: Action[];
  /** Marks the page as an ending of the story. */
  ending?: 'victory' | 'defeat' | 'neutral';
  /** Position on the editor map; ignored by the player. */
  pos?: { x: number; y: number };
}

export interface ConditionalText {
  when: Condition;
  text: string;
}

export interface Action {
  /** Unique within the whole story, so that "did action X" conditions can refer to it. */
  id: ActionId;
  label: string;
  /** Page to go to. Without a target the hero stays on the page (e.g. "take the key"). */
  target?: PageId;
  /** The action is offered only when the condition holds. */
  when?: Condition;
  /** If set, an unavailable action is shown greyed out with this explanation instead of hidden. */
  lockedHint?: string;
  effects?: Effect[];
  /** The action disappears after it was used once. */
  once?: boolean;
}

export interface Combat {
  enemy: Enemy;
  /** What happens after a victory. Without a target the page's actions are shown. */
  onWin?: Outcome;
  /** What happens after a defeat. Without a target the game is over. */
  onLose?: Outcome;
  /** If set, the hero may run away between rounds. */
  flee?: { target: PageId; effects?: Effect[] };
}

export interface Enemy {
  name: string;
  image?: AssetRef;
  hp: number;
  attack: number;
  defense: number;
}

export interface Outcome {
  effects?: Effect[];
  target?: PageId;
}

/** A number used in comparisons. */
export type Value =
  | number
  | { stat: StatName }
  | { counter: CounterId }
  | { itemCount: ItemId };

export type CompareOp = '<' | '<=' | '=' | '!=' | '>=' | '>';

export type Condition =
  | { type: 'hasItem'; item: ItemId; count?: number }
  | { type: 'did'; action: ActionId }
  | { type: 'visited'; page: PageId }
  /** The fight on the given page was won. */
  | { type: 'won'; page: PageId }
  | { type: 'profession'; profession: ProfessionId }
  | { type: 'compare'; left: Value; op: CompareOp; right: Value }
  | { type: 'and'; all: Condition[] }
  | { type: 'or'; any: Condition[] }
  | { type: 'not'; cond: Condition };

export type Effect =
  | { type: 'giveItem'; item: ItemId; count?: number }
  | { type: 'takeItem'; item: ItemId; count?: number }
  | { type: 'changeStat'; stat: StatName; by: number }
  | { type: 'setStat'; stat: StatName; to: number }
  | { type: 'changeCounter'; counter: CounterId; by: number }
  | { type: 'setCounter'; counter: CounterId; to: number }
  /** Shows a short note to the player. */
  | { type: 'message'; text: string }
  /** Jumps to a page and skips the remaining effects; overrides the action's target. */
  | { type: 'goto'; page: PageId }
  | { type: 'if'; when: Condition; then: Effect[]; else?: Effect[] }
  /** Luck: runs `then` with the given probability (0-100), otherwise `else`. */
  | { type: 'chance'; percent: number; then: Effect[]; else?: Effect[] };
