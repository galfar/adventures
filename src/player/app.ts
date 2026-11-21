import { Game, type CombatView, type GameView } from '../shared/engine/game.ts';
import { pageNeeds, type TestKit } from '../shared/engine/needs.ts';
import type { Notice, StrikeLog } from '../shared/engine/state.ts';
import type { CounterId, Effect, ItemId, PageId, ProfessionId, StartingKit, StatName, Story } from '../shared/format/types.ts';
import { confirmDialog, h, openDialog, renderText } from '../shared/dom.ts';
import { translator, type Translate } from './i18n/index.ts';
import type { StoryPackage } from './loader.ts';
import { clearSave, readSave, writeSave } from './storage.ts';
import { applyTheme } from './themes.ts';

export interface PlayerOptions {
  /** If given, the player offers "other adventures" and calls this to leave the story. */
  onExit?: () => void;
  /** Overrides the story's visual style (handy for trying styles out). */
  theme?: string;
  /** Play-testing from the editor: nothing is saved, the title page is skipped, test tools appear. */
  preview?: boolean;
  /** Play-testing from this page: the hero screen offers what the page asks about. */
  testPage?: PageId;
}

/** The hero screen's test settings, kept while the author clicks around on that screen. */
interface TestDraft {
  items: Map<ItemId, number>;
  counters: Map<CounterId, number>;
  /** Missing value: the hero's usual number. */
  stats: Map<StatName, number | undefined>;
  flags: { kind: 'did' | 'visited' | 'won'; id: string; on: boolean }[];
}

/**
 * The screens of one adventure: title page, hero creation, and the game itself.
 * Each screen is drawn from scratch from the game's `view()` after every command;
 * the stories are small, so this stays simple and fast enough.
 */
export class PlayerApp {
  private readonly root: HTMLElement;
  private readonly pkg: StoryPackage;
  private readonly story: Story;
  private readonly options: PlayerOptions;
  private readonly t: Translate;
  private readonly game: Game;
  /** The page shown by the previous draw, to scroll up only when the page changes. */
  private shownPage: string | undefined;
  /** Only when play-testing from a page that asks about something. */
  private testDraft: TestDraft | undefined;

  constructor(root: HTMLElement, pkg: StoryPackage, options: PlayerOptions = {}) {
    this.root = root;
    this.pkg = pkg;
    this.story = pkg.story;
    this.options = options;
    this.t = translator(this.story.language);
    this.game = new Game(this.story);
    document.title = this.story.title;
    document.documentElement.lang = this.story.language;
    applyTheme(options.theme ?? this.story.theme);
    if (options.preview && options.testPage !== undefined) this.testDraft = this.makeTestDraft(options.testPage);
    if (options.preview) this.showSetup();
    else this.showTitle();
  }

  // ---- Title page -----------------------------------------------------------------

  private showTitle(): void {
    const { t, story } = this;
    const saved = this.options.preview ? undefined : readSave(story.id);
    const canContinue = saved !== undefined && new Game(story).restore(saved);
    const cover = this.pkg.assetUrl(story.cover);

    const startNew = async () => {
      if (canContinue && !(await confirmDialog(t('newGameConfirm'), t('yes'), t('no')))) return;
      this.showSetup();
    };
    this.draw(
      null,
      h(
        'article',
        { class: 'page title-page' },
        cover && h('figure', { class: 'page-image' }, h('img', { src: cover, alt: '' })),
        h('h1', null, story.title),
        story.author && h('p', { class: 'byline' }, t('author', { author: story.author })),
        story.description && h('div', { class: 'page-text' }, renderText(story.description)),
        h('div', { class: 'divider' }),
        h(
          'nav',
          { class: 'actions' },
          canContinue &&
            h(
              'button',
              {
                class: 'action primary',
                onclick: () => {
                  this.game.restore(saved!);
                  this.showGame();
                },
              },
              t('continueGame'),
            ),
          h('button', { class: canContinue ? 'action' : 'action primary', onclick: startNew }, t('newGame')),
          this.options.onExit && h('button', { class: 'action', onclick: this.options.onExit }, t('otherAdventures')),
        ),
      ),
    );
  }

  // ---- Hero creation --------------------------------------------------------------

  private showSetup(profession?: ProfessionId, picked: ItemId[] = []): void {
    const { t, story } = this;
    const hasProfessions = story.professions.length > 0;
    const chosen = story.professions.find((p) => p.id === profession) ?? story.professions[0];
    const kit: StartingKit = chosen ?? story.hero;
    profession = chosen?.id;
    const toPick = Math.min(kit.choose?.count ?? 0, kit.choose?.from.length ?? 0);

    if (!hasProfessions && toPick === 0 && !this.testDraft) {
      this.startGame({});
      return;
    }
    const itemName = (id: ItemId) => this.game.index.items.get(id)?.name ?? id;
    const kitSummary = (k: StartingKit) => [
      h(
        'div',
        { class: 'stat-row' },
        this.stat('❤️', t('hp'), k.stats.hp),
        this.stat('⚔️', t('attack'), k.stats.attack),
        this.stat('🛡️', t('defense'), k.stats.defense),
      ),
      (k.items?.length ?? 0) > 0 &&
        h('p', { class: 'kit-items' }, k.items!.map((g) => itemName(g.item) + ((g.count ?? 1) > 1 ? ` ×${g.count}` : '')).join(', ')),
    ];
    const togglePick = (id: ItemId) => {
      const next = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
      // Picking one more than allowed replaces the oldest pick instead of doing nothing.
      this.showSetup(profession, next.slice(-toPick));
    };

    this.draw(
      null,
      h(
        'article',
        { class: 'page setup-page' },
        h('h2', null, hasProfessions ? t('chooseProfession') : t('yourHero')),
        hasProfessions
          ? h(
              'div',
              { class: 'cards' },
              story.professions.map((p) =>
                h(
                  'button',
                  {
                    class: 'card',
                    'aria-pressed': String(p.id === profession),
                    onclick: () => this.showSetup(p.id, []),
                  },
                  h('strong', { class: 'card-title' }, p.name),
                  p.description && h('span', { class: 'card-text' }, p.description),
                  kitSummary(p),
                ),
              ),
            )
          : h('div', { class: 'card static' }, kitSummary(kit)),
        toPick > 0 && h('h2', null, t('chooseItems', { count: toPick })),
        toPick > 0 &&
          h(
            'div',
            { class: 'cards' },
            kit.choose!.from.map((id) => {
              const def = this.game.index.items.get(id);
              return h(
                'button',
                { class: 'card', 'aria-pressed': String(picked.includes(id)), onclick: () => togglePick(id) },
                h('strong', { class: 'card-title' }, itemName(id)),
                def?.description && h('span', { class: 'card-text' }, def.description),
              );
            }),
          ),
        this.testDraft && this.testSection(this.testDraft),
        h('div', { class: 'divider' }),
        h(
          'nav',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'action primary',
              disabled: picked.length < toPick,
              onclick: () => this.startGame({ profession, items: picked }),
            },
            t('begin'),
          ),
        ),
      ),
    );
  }

  private startGame(choice: { profession?: ProfessionId; items?: ItemId[] }): void {
    this.game.start(choice, undefined, this.testDraft && this.testKit(this.testDraft));
    this.shownPage = undefined;
    this.afterCommand();
  }

  // ---- Play-testing ---------------------------------------------------------------

  /** What the tested page asks about, ready to change. Undefined when it asks about nothing. */
  private makeTestDraft(pageId: PageId): TestDraft | undefined {
    const needs = pageNeeds(this.story, pageId);
    const draft: TestDraft = {
      items: new Map(needs.items),
      counters: new Map([...needs.counters].map(([id, value]) => [id, value ?? this.game.index.counters.get(id)?.start ?? 0])),
      stats: new Map(needs.stats),
      flags: [
        ...[...needs.did].map((id) => ({ kind: 'did' as const, id, on: true })),
        ...[...needs.visited].map((id) => ({ kind: 'visited' as const, id, on: true })),
        ...[...needs.won].map((id) => ({ kind: 'won' as const, id, on: true })),
      ],
    };
    // Only things the story still has: a deleted item cannot be given.
    for (const id of draft.items.keys()) if (!this.game.index.items.has(id)) draft.items.delete(id);
    for (const id of draft.counters.keys()) if (!this.game.index.counters.has(id)) draft.counters.delete(id);
    const empty = draft.items.size + draft.counters.size + draft.stats.size + draft.flags.length === 0;
    return empty ? undefined : draft;
  }

  private testKit(draft: TestDraft): TestKit {
    const on = (kind: TestDraft['flags'][number]['kind']) => draft.flags.filter((f) => f.kind === kind && f.on).map((f) => f.id);
    return {
      items: Object.fromEntries(draft.items),
      counters: Object.fromEntries(draft.counters),
      stats: Object.fromEntries([...draft.stats].filter(([, value]) => value !== undefined)),
      did: on('did'),
      visited: on('visited'),
      won: on('won'),
    };
  }

  private pageName(id: PageId): string {
    const page = this.game.index.pages.get(id);
    return page ? page.title || '?' : id;
  }

  private actionName(id: string): string {
    for (const page of this.story.pages) {
      const action = page.actions.find((a) => a.id === id);
      if (action) return `${page.title || '?'}: ${action.label}`;
    }
    return id;
  }

  /** A number field that reports a whole number (or undefined when emptied). */
  private numberField(label: string, value: number | undefined, onChange: (value: number | undefined) => void, placeholder?: string): HTMLElement {
    const input = h('input', { type: 'number', step: '1', value: value === undefined ? '' : String(value), placeholder: placeholder ?? '' });
    input.addEventListener('change', () => {
      const parsed = Number.parseInt(input.value, 10);
      onChange(Number.isFinite(parsed) ? parsed : undefined);
    });
    return h('label', { class: 'test-row' }, h('span', null, label), input);
  }

  /** On the hero screen: what the tested page asks about. */
  private testSection(draft: TestDraft): HTMLElement {
    const { t } = this;
    const index = this.game.index;
    return h(
      'section',
      { class: 'test-kit' },
      h('h2', null, t('testTitle')),
      h('p', { class: 'muted' }, t('testIntro')),
      [...draft.items].map(([id, count]) =>
        this.numberField(`🎒 ${index.items.get(id)?.name ?? id}`, count, (value) => draft.items.set(id, Math.max(0, value ?? 0))),
      ),
      [...draft.counters].map(([id, value]) => {
        const def = index.counters.get(id);
        return this.numberField(`${def?.icon ?? ''} ${def?.name ?? id}`.trim(), value, (next) => draft.counters.set(id, next ?? def?.start ?? 0));
      }),
      [...draft.stats].map(([stat, value]) => this.numberField(t(stat), value, (next) => draft.stats.set(stat, next), t('testAsUsual'))),
      draft.flags.map((flag) => {
        const box = h('input', { type: 'checkbox' });
        box.checked = flag.on;
        box.addEventListener('change', () => (flag.on = box.checked));
        const name = flag.kind === 'did' ? this.actionName(flag.id) : this.pageName(flag.id);
        const text = flag.kind === 'did' ? t('testDid', { name }) : flag.kind === 'visited' ? t('testVisited', { name }) : t('testWon', { name });
        return h('label', { class: 'test-row test-flag' }, box, h('span', null, text));
      }),
    );
  }

  /** The 🛠 dialog during a play-test: change the hero and the world right away. */
  private openTestTools(): void {
    const { t } = this;
    const game = this.game;
    const dialog = openDialog('dialog sheet', () => []);
    const body = dialog.firstElementChild!;
    const apply = (effect: Effect) => {
      if (!game.testEffect(effect)) return;
      this.afterCommand();
      fill();
    };
    const fill = () => {
      const view = game.view();
      const state = game.state;
      const pageSelect = h(
        'select',
        null,
        this.story.pages.map((page) => h('option', { value: page.id, selected: page.id === view.page.id }, page.title || '?')),
      );
      body.replaceChildren(
        h('h3', null, `🛠 ${t('testTools')}`),
        h('p', { class: 'muted' }, t('testToolsIntro')),
        view.combat && !view.combat.outcome ?
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                class: 'action',
                onclick: () => {
                  if (!game.testWinFight()) return;
                  this.afterCommand();
                  dialog.close();
                },
              },
              `⚔️ ${t('testWinFight')}`,
            ),
          ) : '',
        h(
          'div',
          { class: 'test-kit' },
          this.numberField(`❤️ ${t('hp')}`, state.stats.hp, (value) => {
            if (value === undefined) return;
            // Above the maximum, raise the maximum too, or the hit points would be cut back.
            if (value > state.stats.maxHp) game.testEffect({ type: 'setStat', stat: 'maxHp', to: value });
            apply({ type: 'setStat', stat: 'hp', to: value });
          }),
          (['attack', 'defense'] as const).map((stat) =>
            this.numberField(`${stat === 'attack' ? '⚔️' : '🛡️'} ${t(stat)}`, state.stats[stat], (value) => {
              if (value !== undefined) apply({ type: 'setStat', stat, to: value });
            }),
          ),
          view.counters.map(({ def, value }) =>
            this.numberField(`${def.icon ?? ''} ${def.name}`.trim(), value, (next) => {
              if (next !== undefined) apply({ type: 'setCounter', counter: def.id, to: next });
            }),
          ),
        ),
        this.story.items.length > 0 ? h('h4', null, t('testItems')) : '',
        this.story.items.length === 0 ? '' :
          h(
            'ul',
            { class: 'test-items' },
            this.story.items.map((def) => {
              const count = state.items[def.id] ?? 0;
              return h(
                'li',
                { class: 'test-row' },
                h('span', null, def.name || '?'),
                h('button', { class: 'action small', 'aria-label': `− ${def.name}`, disabled: count === 0, onclick: () => apply({ type: 'takeItem', item: def.id }) }, '−'),
                h('strong', { class: 'test-count' }, count),
                h('button', { class: 'action small', 'aria-label': `+ ${def.name}`, onclick: () => apply({ type: 'giveItem', item: def.id }) }, '+'),
              );
            }),
          ),
        h(
          'div',
          { class: 'test-row' },
          h('span', null, t('testGoTo')),
          pageSelect,
          h(
            'button',
            {
              class: 'action small',
              onclick: () => {
                if (!game.testEffect({ type: 'goto', page: pageSelect.value })) return;
                this.afterCommand();
                dialog.close();
              },
            },
            t('testGo'),
          ),
        ),
        h('div', { class: 'dialog-buttons' }, h('button', { class: 'action', onclick: () => dialog.close() }, t('close'))),
      );
    };
    fill();
  }

  // ---- The game -------------------------------------------------------------------

  /** Called after every game command: save first, then draw. */
  private afterCommand(): void {
    if (!this.options.preview) writeSave(this.game.state);
    this.showGame();
  }

  private showGame(): void {
    const view = this.game.view();
    const image = this.pkg.assetUrl(view.page.image);
    const newPage = view.page.id !== this.shownPage;
    this.shownPage = view.page.id;

    this.draw(
      this.hud(view),
      h(
        'article',
        { class: newPage ? 'page page-enter' : 'page' },
        image && h('figure', { class: 'page-image' }, h('img', { src: image, alt: '' })),
        view.page.title && h('h2', { class: 'page-title' }, view.page.title),
        h('div', { class: 'page-text lead' }, view.texts.flatMap(renderText)),
        // Everything that happened on this page, so a conversation stays readable.
        view.log.length > 0 &&
          h(
            'ul',
            { class: 'notices' },
            view.log.flatMap((entry) => [
              entry.choice !== undefined && h('li', { class: 'notice-choice' }, `➤ ${entry.choice}`),
              ...entry.notices.map((n) => this.notice(n)),
            ]),
          ),
        view.combat && this.combat(view, view.combat),
        (view.status === 'playing' || view.status === 'moving') && h('div', { class: 'divider' }),
        view.status === 'moving' &&
          h(
            'nav',
            { class: 'actions' },
            h('button', { class: 'action primary', onclick: () => this.run(() => this.game.moveOn()) }, `${this.t('next')} ➜`),
          ),
        view.actions.length > 0 &&
          h(
            'nav',
            { class: 'actions' },
            view.actions.map((action) =>
              h(
                'button',
                { class: 'action', disabled: !action.enabled, onclick: () => this.run(() => this.game.act(action.id)) },
                h('span', null, action.label, action.hint && h('small', { class: 'hint' }, action.hint)),
              ),
            ),
          ),
        (view.status === 'ending' || view.status === 'deadEnd' || view.status === 'dead') && this.finale(view),
      ),
      newPage,
    );
    // On the same page the log grows; keep the newest line on screen (phones).
    if (!newPage) this.root.querySelector('.notices > :last-child')?.scrollIntoView({ block: 'nearest' });
  }

  private run(command: () => boolean): void {
    if (command()) this.afterCommand();
  }

  private hud(view: GameView): HTMLElement {
    const { t } = this;
    const itemCount = view.items.reduce((sum, item) => sum + item.count, 0);
    return h(
      'header',
      { class: 'hud' },
      h('button', { class: 'icon-button', 'aria-label': t('menu'), title: t('menu'), onclick: () => this.openMenu() }, '☰'),
      h(
        'div',
        { class: 'hud-stats' },
        h(
          'span',
          { class: 'stat', title: t('hp') },
          h('span', { 'aria-hidden': 'true' }, '❤️'),
          this.bar(view.hero.hp, view.hero.maxHp, 'hp'),
          h('span', { 'aria-label': t('hp') }, `${view.hero.hp}/${view.hero.maxHp}`),
        ),
        this.stat('⚔️', t('attack'), view.hero.attack),
        this.stat('🛡️', t('defense'), view.hero.defense),
        view.counters.filter((c) => c.def.show).map((c) => this.stat(c.def.icon ?? '', c.def.name, c.value)),
      ),
      this.options.preview &&
        h('button', { class: 'icon-button', 'aria-label': t('testTools'), title: t('testTools'), onclick: () => this.openTestTools() }, '🛠'),
      h(
        'button',
        { class: 'icon-button', 'aria-label': t('bag'), title: t('bag'), onclick: () => this.openBag() },
        '🎒',
        itemCount > 0 && h('span', { class: 'badge' }, itemCount),
      ),
    );
  }

  private stat(icon: string, label: string, value: number): HTMLElement {
    return h(
      'span',
      { class: 'stat', title: label },
      icon ? h('span', { 'aria-hidden': 'true' }, icon) : h('span', { class: 'stat-label' }, label),
      h('span', { 'aria-label': label }, value),
    );
  }

  private bar(value: number, max: number, kind: 'hp' | 'enemy'): HTMLElement {
    const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    const fill = h('span');
    fill.style.width = `${percent}%`;
    return h('span', { class: `bar bar-${kind}` }, fill);
  }

  private notice(notice: Notice): HTMLElement {
    const { t } = this;
    const index = this.game.index;
    const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
    const itemText = (id: ItemId, count = 1) => (index.items.get(id)?.name ?? id) + (count > 1 ? ` ×${count}` : '');
    let text: string;
    let tone = 'neutral';
    switch (notice.kind) {
      case 'itemGained':
        text = t('itemGained', { item: itemText(notice.item, notice.count) });
        tone = 'good';
        break;
      case 'itemLost':
        text = t('itemLost', { item: itemText(notice.item, notice.count) });
        break;
      case 'itemUsed':
        text = t('itemUsed', { item: itemText(notice.item) });
        break;
      case 'statChanged':
        text = `${t(notice.stat)} ${signed(notice.by)}`;
        tone = notice.by > 0 ? 'good' : 'bad';
        break;
      case 'counterChanged': {
        const def = index.counters.get(notice.counter);
        text = `${def?.icon ?? ''} ${def?.name ?? notice.counter} ${signed(notice.by)}`.trim();
        tone = notice.by > 0 ? 'good' : 'bad';
        break;
      }
      case 'message':
        text = notice.text;
        break;
      case 'brokenLink':
        text = t('brokenLink');
        tone = 'bad';
        break;
    }
    return h('li', { class: `notice notice-${tone}` }, text);
  }

  private combat(view: GameView, combat: CombatView): HTMLElement {
    const { t } = this;
    const enemyImage = this.pkg.assetUrl(combat.enemy.image);
    const strikeLine = (who: string, s: StrikeLog) =>
      h(
        'div',
        { class: 'strike' },
        h('span', { class: 'strike-who' }, who),
        h('span', { class: 'die', 'aria-label': String(s.roll) }, s.roll),
        h('span', { class: 'strike-math' }, `+ ${s.attack} − ${s.defense}`),
        h('span', { class: s.damage > 0 ? 'strike-result hit' : 'strike-result' }, '→ ', s.damage > 0 ? t('hit', { n: s.damage }) : t('noDamage')),
      );
    return h(
      'section',
      { class: 'combat' },
      h('h3', null, t('fight')),
      h(
        'div',
        { class: 'fighters' },
        h(
          'div',
          { class: 'fighter' },
          h('strong', null, view.hero.profession?.name ?? t('you')),
          this.bar(view.hero.hp, view.hero.maxHp, 'hp'),
          h('span', null, `❤️ ${view.hero.hp}/${view.hero.maxHp}`),
          h('span', { class: 'fighter-stats' }, `⚔️ ${view.hero.attack}  🛡️ ${view.hero.defense}`),
        ),
        h('div', { class: 'versus', 'aria-hidden': 'true' }, '⚔️'),
        h(
          'div',
          { class: 'fighter' },
          enemyImage && h('img', { class: 'enemy-image', src: enemyImage, alt: '' }),
          h('strong', null, combat.enemy.name),
          this.bar(combat.enemyHp, combat.enemy.hp, 'enemy'),
          h('span', null, `❤️ ${combat.enemyHp}/${combat.enemy.hp}`),
          h('span', { class: 'fighter-stats' }, `⚔️ ${combat.enemy.attack}  🛡️ ${combat.enemy.defense}`),
        ),
      ),
      combat.last &&
        h(
          'div',
          { class: 'round-log', 'aria-live': 'polite' },
          h('div', { class: 'round-number' }, t('round', { n: combat.round })),
          strikeLine(t('you'), combat.last.hero),
          combat.last.enemy && strikeLine(combat.enemy.name, combat.last.enemy),
        ),
      combat.outcome && h('p', { class: `combat-outcome ${combat.outcome}` }, t(combat.outcome === 'win' ? 'fightWon' : 'fightLost')),
      h(
        'nav',
        { class: 'actions' },
        combat.outcome
          ? h('button', { class: 'action primary', onclick: () => this.run(() => this.game.finishCombat()) }, t('next'))
          : h(
              'button',
              { class: 'action primary', onclick: () => this.run(() => this.game.fightRound()) },
              t(combat.round === 0 ? 'rollDice' : 'nextRound'),
            ),
        combat.canFlee && h('button', { class: 'action', onclick: () => this.run(() => this.game.flee()) }, t('flee')),
      ),
    );
  }

  /** The block under the last page: the end of the story, or the hero's death. */
  private finale(view: GameView): HTMLElement {
    const { t } = this;
    const dead = view.status === 'dead';
    const title = dead
      ? t('deadTitle')
      : view.page.ending === 'victory'
        ? t('victory')
        : view.page.ending === 'defeat'
          ? t('defeat')
          : t('theEnd');
    return h(
      'section',
      { class: `finale finale-${dead ? 'dead' : (view.page.ending ?? 'neutral')}` },
      h('div', { class: 'divider' }),
      h('h3', null, title),
      dead && h('p', null, t('deadText')),
      view.status === 'deadEnd' && h('p', null, t('deadEnd')),
      h(
        'nav',
        { class: 'actions' },
        h('button', { class: 'action primary', onclick: () => this.restart() }, t(dead ? 'tryAgain' : 'playAgain')),
        this.options.onExit && h('button', { class: 'action', onclick: this.options.onExit }, t('otherAdventures')),
      ),
    );
  }

  private restart(): void {
    if (!this.options.preview) clearSave(this.story.id);
    this.showSetup();
  }

  // ---- Dialogs --------------------------------------------------------------------

  private openBag(): void {
    const { t } = this;
    const dialog = openDialog('dialog sheet', () => []);
    const body = dialog.firstElementChild!;
    const fill = () => {
      const view = this.game.view();
      body.replaceChildren(
        h('h3', null, t('bag')),
        h(
          'div',
          { class: 'stat-row' },
          view.hero.profession && h('strong', null, view.hero.profession.name),
          this.stat('❤️', t('hp'), view.hero.hp),
          this.stat('⚔️', t('attack'), view.hero.attack),
          this.stat('🛡️', t('defense'), view.hero.defense),
          view.counters.map((c) => this.stat(c.def.icon ?? '', c.def.name, c.value)),
        ),
        view.items.length === 0
          ? h('p', { class: 'muted' }, t('bagEmpty'))
          : h(
              'ul',
              { class: 'bag-items' },
              view.items.map((item) => {
                const image = this.pkg.assetUrl(item.def.image);
                const bonus = [
                  item.def.bonus?.attack ? `⚔️ +${item.def.bonus.attack}` : '',
                  item.def.bonus?.defense ? `🛡️ +${item.def.bonus.defense}` : '',
                ]
                  .filter(Boolean)
                  .join('  ');
                return h(
                  'li',
                  { class: 'bag-item' },
                  image && h('img', { src: image, alt: '' }),
                  h(
                    'div',
                    { class: 'bag-item-text' },
                    h('strong', null, item.def.name, item.count > 1 && ` ×${item.count}`, bonus && h('span', { class: 'bonus' }, bonus)),
                    item.def.description && h('span', { class: 'muted' }, item.def.description),
                  ),
                  item.usable &&
                    h(
                      'button',
                      {
                        class: 'action small',
                        onclick: () => {
                          const page = this.game.state.pageId;
                          if (!this.game.useItem(item.def.id)) return;
                          this.afterCommand();
                          // Stay in the bag unless using the item changed the scene.
                          if (this.game.state.over || this.game.state.pageId !== page) dialog.close();
                          else fill();
                        },
                      },
                      t('use'),
                    ),
                );
              }),
            ),
        h('div', { class: 'dialog-buttons' }, h('button', { class: 'action', onclick: () => dialog.close() }, t('close'))),
      );
    };
    fill();
  }

  private openMenu(): void {
    const { t } = this;
    openDialog('dialog', (dialog) => [
      h('h3', null, this.story.title),
      h(
        'nav',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'action',
            onclick: async () => {
              dialog.close();
              if (await confirmDialog(t('restartConfirm'), t('yes'), t('no'))) this.restart();
            },
          },
          t('restart'),
        ),
        h(
          'button',
          {
            class: 'action',
            onclick: () => {
              dialog.close();
              this.showTitle();
            },
          },
          t('toTitle'),
        ),
        this.options.onExit && h('button', { class: 'action', onclick: this.options.onExit }, t('otherAdventures')),
        h('button', { class: 'action primary', onclick: () => dialog.close() }, t('close')),
      ),
    ]);
  }

  // ---- Drawing --------------------------------------------------------------------

  private draw(header: HTMLElement | null, page: HTMLElement, scrollToTop = true): void {
    this.root.replaceChildren(...(header ? [header] : []), h('main', { class: 'book' }, page));
    if (scrollToTop) window.scrollTo(0, 0);
  }
}
