import type {
  Action,
  ActionId,
  CounterDef,
  CounterId,
  Effect,
  Enemy,
  ItemDef,
  ItemId,
  Page,
  PageId,
  Profession,
  ProfessionId,
  StartingKit,
  StatName,
  Story,
} from '../format/types.ts';
import { buildIndex, effectiveStat, test, type StoryIndex } from './conditions.ts';
import { DIE_SIDES, nextRandom, strike } from './rules.ts';
import { isNotice, STATE_VERSION, type GameEvent, type GameState, type Notice, type RoundLog } from './state.ts';

/** What the player chose on the "create your hero" screen. */
export interface SetupChoice {
  profession?: ProfessionId;
  /** Items picked from the kit's "choose X of these" list. */
  items?: ItemId[];
}

/** Everything the player needs to draw the current moment of the game. */
export interface GameView {
  page: Page;
  /** `deadEnd`: a page with nothing to do that the author did not mark as an ending. */
  status: 'playing' | 'combat' | 'ending' | 'deadEnd' | 'dead';
  /** The page text followed by the extra texts whose condition holds. */
  texts: string[];
  actions: ActionView[];
  combat?: CombatView;
  hero: HeroView;
  items: ItemView[];
  counters: { def: CounterDef; value: number }[];
  notices: Notice[];
}

export interface ActionView {
  id: ActionId;
  label: string;
  enabled: boolean;
  /** Why a disabled action cannot be used. */
  hint?: string;
}

export interface CombatView {
  enemy: Enemy;
  enemyHp: number;
  round: number;
  last?: RoundLog;
  outcome?: 'win' | 'lose';
  canFlee: boolean;
}

export interface HeroView {
  profession?: Profession;
  hp: number;
  maxHp: number;
  /** Including item bonuses. */
  attack: number;
  defense: number;
}

export interface ItemView {
  def: ItemDef;
  count: number;
  usable: boolean;
}

/** Protects against stories where pages send the hero around in a circle forever. */
const MAX_JUMPS = 50;

/**
 * The game rules. Knows nothing about the screen: the player calls the commands
 * (`act`, `fightRound`, ...) and then draws what `view()` returns.
 */
export class Game {
  readonly story: Story;
  readonly index: StoryIndex;
  state!: GameState;
  /** Called for everything that happens; meant for things like sound effects. */
  onEvent: ((event: GameEvent) => void) | undefined;

  constructor(story: Story) {
    this.story = story;
    this.index = buildIndex(story);
  }

  /** Starts a new game. The seed makes the dice repeatable (used by tests). */
  start(choice: SetupChoice = {}, seed: number = (Math.random() * 2 ** 32) | 0): void {
    const story = this.story;
    const profession = story.professions.find((p) => p.id === choice.profession) ?? story.professions[0];
    const kit: StartingKit = profession ?? story.hero;
    this.state = {
      version: STATE_VERSION,
      storyId: story.id,
      profession: profession?.id,
      stats: { hp: kit.stats.hp, maxHp: kit.stats.hp, attack: kit.stats.attack, defense: kit.stats.defense },
      items: {},
      counters: Object.fromEntries(story.counters.map((c) => [c.id, c.start])),
      visits: {},
      done: {},
      won: {},
      pageId: story.startPage,
      rng: seed,
      notices: [],
    };
    for (const grant of kit.items ?? []) this.changeItem(grant.item, grant.count ?? 1, true);
    if (kit.choose) {
      const picked = (choice.items ?? []).filter((id) => kit.choose!.from.includes(id));
      for (const id of new Set(picked.slice(0, kit.choose.count))) this.changeItem(id, 1, true);
    }
    this.enterPage(story.startPage);
  }

  /** Continues a saved game. Returns false when the save does not fit this story. */
  restore(saved: GameState): boolean {
    if (
      saved?.version !== STATE_VERSION ||
      saved.storyId !== this.story.id ||
      !this.index.pages.has(saved.pageId) ||
      (saved.combat !== undefined && !this.index.pages.get(saved.pageId)!.combat)
    ) {
      return false;
    }
    this.state = saved;
    return true;
  }

  // ---- Commands -------------------------------------------------------------------

  /** The player picked an action on the current page. */
  act(actionId: ActionId): boolean {
    const action = this.page().actions.find((a) => a.id === actionId);
    if (!action || this.state.combat || !this.isAvailable(action) || !this.begin()) return false;
    this.state.done[action.id] = (this.state.done[action.id] ?? 0) + 1;
    this.emit({ kind: 'action', action: action.id });
    this.leaveTo(this.runEffects(action.effects) ?? action.target);
    return true;
  }

  /** Plays one round of the current fight: the hero strikes, then the enemy. */
  fightRound(): boolean {
    const combat = this.state.combat;
    const def = this.page().combat;
    if (!combat || !def || combat.outcome || !this.begin()) return false;
    const { state, index } = this;
    combat.round++;
    const round: RoundLog = {
      hero: strike(this.rollDie(), effectiveStat(state, index, 'attack'), def.enemy.defense),
    };
    combat.enemyHp = Math.max(0, combat.enemyHp - round.hero.damage);
    if (combat.enemyHp === 0) {
      combat.outcome = 'win';
    } else {
      round.enemy = strike(this.rollDie(), def.enemy.attack, effectiveStat(state, index, 'defense'));
      state.stats.hp = Math.max(0, state.stats.hp - round.enemy.damage);
      if (state.stats.hp === 0) combat.outcome = 'lose';
    }
    combat.last = round;
    this.emit({ kind: 'combatRound', round });
    return true;
  }

  /** After the fight is decided: applies the win/lose outcome defined by the author. */
  finishCombat(): boolean {
    const page = this.page();
    const combat = this.state.combat;
    const def = page.combat;
    if (!combat?.outcome || !def || !this.begin()) return false;
    const outcome = combat.outcome;
    this.state.combat = undefined;
    this.emit({ kind: 'combatEnd', page: page.id, outcome });
    if (outcome === 'win') {
      this.state.won[page.id] = true;
      this.leaveTo(this.runEffects(def.onWin?.effects) ?? def.onWin?.target);
    } else {
      // A lost fight that leads somewhere is survived with the last hit point.
      if (def.onLose?.target !== undefined) this.state.stats.hp = 1;
      this.leaveTo(this.runEffects(def.onLose?.effects) ?? def.onLose?.target);
    }
    return true;
  }

  /** Runs away from the current fight, if the author allowed it. */
  flee(): boolean {
    const page = this.page();
    const combat = this.state.combat;
    const flee = page.combat?.flee;
    if (!combat || combat.outcome || !flee || !this.begin()) return false;
    this.state.combat = undefined;
    this.emit({ kind: 'combatEnd', page: page.id, outcome: 'fled' });
    this.leaveTo(this.runEffects(flee.effects) ?? flee.target);
    return true;
  }

  /** Uses an item from the bag (e.g. drinks a potion). Also possible between fight rounds. */
  useItem(itemId: ItemId): boolean {
    const def = this.index.items.get(itemId);
    if (!def || !this.isUsable(def) || !this.begin()) return false;
    this.emit({ kind: 'itemUsed', item: def.id });
    if (def.use!.consumed !== false) this.changeItem(def.id, -1, true);
    const jump = this.runEffects(def.use!.effects);
    // A fight cannot be escaped by an item that jumps to another page.
    this.leaveTo(this.state.combat ? undefined : jump);
    return true;
  }

  // ---- View -----------------------------------------------------------------------

  view(): GameView {
    const { state, index } = this;
    const page = this.page();
    const texts = [page.text, ...(page.extraTexts ?? []).filter((t) => test(t.when, state, index)).map((t) => t.text)];

    const actions: ActionView[] = [];
    if (!state.combat && !state.over) {
      for (const action of page.actions) {
        if (action.once && state.done[action.id]) continue;
        if (test(action.when, state, index)) actions.push({ id: action.id, label: action.label, enabled: true });
        else if (action.lockedHint) {
          actions.push({ id: action.id, label: action.label, enabled: false, hint: action.lockedHint });
        }
      }
    }

    let status: GameView['status'];
    if (state.over) status = 'dead';
    else if (state.combat) status = 'combat';
    else if (page.ending) status = 'ending';
    else status = actions.some((a) => a.enabled) ? 'playing' : 'deadEnd';

    const items: ItemView[] = [];
    for (const def of this.story.items) {
      const count = state.items[def.id] ?? 0;
      if (count > 0) items.push({ def, count, usable: this.isUsable(def) });
    }

    return {
      page,
      status,
      texts,
      actions,
      combat:
        state.combat && page.combat
          ? {
              enemy: page.combat.enemy,
              enemyHp: state.combat.enemyHp,
              round: state.combat.round,
              last: state.combat.last,
              outcome: state.combat.outcome,
              canFlee: !!page.combat.flee && !state.combat.outcome,
            }
          : undefined,
      hero: {
        profession: state.profession ? index.professions.get(state.profession) : undefined,
        hp: state.stats.hp,
        maxHp: state.stats.maxHp,
        attack: effectiveStat(state, index, 'attack'),
        defense: effectiveStat(state, index, 'defense'),
      },
      items,
      counters: this.story.counters.map((def) => ({ def, value: state.counters[def.id] ?? def.start })),
      notices: state.notices,
    };
  }

  // ---- Internals ------------------------------------------------------------------

  private page(): Page {
    return this.index.pages.get(this.state.pageId)!;
  }

  /** Every command starts here: nothing works after the game is over, old notices go away. */
  private begin(): boolean {
    if (this.state.over) return false;
    this.state.notices = [];
    return true;
  }

  private emit(event: GameEvent): void {
    if (isNotice(event)) this.state.notices.push(event);
    this.onEvent?.(event);
  }

  private isAvailable(action: Action): boolean {
    return !(action.once && this.state.done[action.id]) && test(action.when, this.state, this.index);
  }

  private isUsable(def: ItemDef): boolean {
    const { state } = this;
    return !!def.use && (state.items[def.id] ?? 0) > 0 && !state.over && !state.combat?.outcome;
  }

  private rollDie(): number {
    const { value, seed } = nextRandom(this.state.rng);
    this.state.rng = seed;
    return 1 + Math.floor(value * DIE_SIDES);
  }

  /** After a command's effects: the hero may have died, or moves on to another page. */
  private leaveTo(target: PageId | undefined): void {
    if (this.checkDeath()) return;
    if (target !== undefined) this.enterPage(target);
  }

  private checkDeath(): boolean {
    if (this.state.over) return true;
    if (this.state.stats.hp > 0) return false;
    this.state.over = 'dead';
    this.emit({ kind: 'gameOver' });
    return true;
  }

  private enterPage(target: PageId): void {
    const state = this.state;
    let next: PageId | undefined = target;
    for (let jumps = 0; next !== undefined && jumps < MAX_JUMPS; jumps++) {
      const page = this.index.pages.get(next);
      if (!page) {
        // Unfinished story: stay where we are and tell the player.
        this.emit({ kind: 'brokenLink', target: next });
        return;
      }
      state.pageId = page.id;
      state.combat = undefined;
      const visits = (state.visits[page.id] ?? 0) + 1;
      state.visits[page.id] = visits;
      this.emit({ kind: 'pageEnter', page: page.id });
      next = (visits === 1 ? this.runEffects(page.onFirstVisit) : undefined) ?? this.runEffects(page.onEveryVisit);
      if (this.checkDeath()) return;
      if (next !== undefined) continue;
      if (page.combat && !state.won[page.id]) {
        state.combat = { enemyHp: page.combat.enemy.hp, round: 0 };
        this.emit({ kind: 'combatStart', page: page.id });
      } else if (page.ending) {
        this.emit({ kind: 'ending', page: page.id, ending: page.ending });
      }
    }
  }

  /** Runs effects in order. Returns the page of a `goto`, which also ends the list. */
  private runEffects(effects: Effect[] | undefined): PageId | undefined {
    for (const effect of effects ?? []) {
      const jump = this.runEffect(effect);
      if (jump !== undefined) return jump;
    }
    return undefined;
  }

  private runEffect(effect: Effect): PageId | undefined {
    const state = this.state;
    switch (effect.type) {
      case 'giveItem':
        this.changeItem(effect.item, effect.count ?? 1);
        return undefined;
      case 'takeItem':
        this.changeItem(effect.item, -(effect.count ?? 1));
        return undefined;
      case 'changeStat':
        this.setStat(effect.stat, state.stats[effect.stat] + effect.by);
        return undefined;
      case 'setStat':
        this.setStat(effect.stat, effect.to);
        return undefined;
      case 'changeCounter':
        this.setCounter(effect.counter, (state.counters[effect.counter] ?? 0) + effect.by);
        return undefined;
      case 'setCounter':
        this.setCounter(effect.counter, effect.to);
        return undefined;
      case 'message':
        this.emit({ kind: 'message', text: effect.text });
        return undefined;
      case 'goto':
        return effect.page;
      case 'if':
        return this.runEffects(test(effect.when, state, this.index) ? effect.then : effect.else);
      case 'chance': {
        const { value, seed } = nextRandom(state.rng);
        state.rng = seed;
        return this.runEffects(value * 100 < effect.percent ? effect.then : effect.else);
      }
      default:
        // An effect from a newer version of the format (e.g. a sound): skip it.
        return undefined;
    }
  }

  private changeItem(id: ItemId, by: number, silent = false): void {
    if (!this.index.items.has(id)) return;
    const before = this.state.items[id] ?? 0;
    const after = Math.max(0, before + by);
    if (after === before) return;
    if (after === 0) delete this.state.items[id];
    else this.state.items[id] = after;
    if (silent) return;
    if (after > before) this.emit({ kind: 'itemGained', item: id, count: after - before });
    else this.emit({ kind: 'itemLost', item: id, count: before - after });
  }

  private setStat(stat: StatName, value: number): void {
    const stats = this.state.stats;
    const before = stats[stat];
    if (stat === 'hp') value = Math.min(stats.maxHp, Math.max(0, value));
    else if (stat === 'maxHp') value = Math.max(1, value);
    else value = Math.max(0, value);
    if (!Number.isFinite(value) || value === before) return;
    stats[stat] = value;
    if (stat === 'maxHp') stats.hp = Math.min(stats.hp, value);
    this.emit({ kind: 'statChanged', stat, by: value - before });
  }

  private setCounter(id: CounterId, value: number): void {
    const def = this.index.counters.get(id);
    if (!def || !Number.isFinite(value)) return;
    const before = this.state.counters[id] ?? def.start;
    if (def.min !== undefined) value = Math.max(def.min, value);
    if (def.max !== undefined) value = Math.min(def.max, value);
    if (value === before) return;
    this.state.counters[id] = value;
    this.emit({ kind: 'counterChanged', counter: id, by: value - before });
  }
}
