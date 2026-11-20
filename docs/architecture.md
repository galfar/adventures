# Adventures: architecture of the player and the editor

Status on 2026-11-17: **steps 1 to 4 are built.** Step 1 is the story format, game engine,
player, three sample adventures and three visual styles. Step 2 is the editor's project list,
page map, page panel, autosave, undo, trash, older versions, hints and play-testing. Step 3 is
blocks for conditions and effects, and the lists of items, counters and professions. Step 4 is
saving an adventure as one HTML file or a ZIP, and opening a ZIP. What remains is polish
(section 9). Each section says which state it describes.

## 1. The big picture

Adventures is a gamebook framework for young authors (10 to 15 years old). It has three parts
that share one data format:

| Part | What it is | State |
|---|---|---|
| **Story format** | One `story.json` plus picture files. Packaged as a folder, a ZIP, or embedded in a single HTML file. | built |
| **Player** | Web app that plays a story. No runtime dependencies, works on phones, saves progress in the browser. | built |
| **Editor** | Web app where kids build a story on a map of pages, with blocks for conditions and effects. | built; polish remains (section 7) |

Everything is static files. There is no server, no accounts, and no database outside the browser.

```
            ┌──────────── src/shared ────────────┐
            │  format/   story types, validation │
            │  engine/   game rules (no screen)  │
            │  zip.ts    ZIP reading and writing │
            └───────┬───────────────────┬────────┘
                    │                   │
          ┌─────────▼────────┐  ┌───────▼─────────────────┐
          │ src/player       │  │ src/editor              │
          │ screens, styles, │  │ map, forms, blocks,     │
          │ saving, loading  │  │ autosave, undo, export  │
          └──────────────────┘  └───────┬─────────────────┘
                                        │ embeds the player for
                                        └ "play from this page"
```

The key rule: **the engine knows nothing about the screen, and the screens know nothing about
the rules.** The player and the editor's test mode both drive the same engine, so a story always
behaves the same in both.

### Repository layout (built)

```
index.html                      entry page of the player site
src/shared/format/types.ts      the story format (the "spec", with comments)
src/shared/format/validate.ts   normalizeStory(), validateStory()
src/shared/engine/game.ts       Game class: commands and view
src/shared/engine/conditions.ts condition evaluation, item bonuses
src/shared/engine/rules.ts      fight formula, seeded random numbers
src/shared/engine/state.ts      saved-game shape, events and notices
src/shared/zip.ts               ZIP reader and writer on the browser's own compression
src/shared/db.ts                editor projects in IndexedDB (the player reads them to play-test)
src/shared/dom.ts, i18n.ts      small helpers shared by both apps
src/player/main.ts              start-up: embedded story, ?story= address, or library
src/player/app.ts               title page, hero creation, game screen, bag, menu
src/player/loader.ts            story from a folder, a ZIP, or the page itself
src/player/storage.ts           saved games in localStorage
src/player/i18n/                en.ts, cs.ts, and the lookup
src/player/styles/              base.css + one theme-*.css per visual style
src/editor/                     the editor (layout in section 7)
editor.html                     entry page of the editor
scripts/build-template.mjs      builds the single-file player used by the HTML export
public/adventures/              bundled sample adventures and index.json
public/blockly-media/           Blockly's small picture files
tests/                          engine, ZIP and editor tests (Node's built-in test runner)
```

### Tech stack and commands

TypeScript, no UI framework, Vite for the dev server and the build. Development dependencies:
`typescript`, `vite`, `@types/node`. The only runtime dependency is `blockly`, used by the editor
alone. Before compression the built player is about 32 kB of JavaScript and 13 kB of CSS. The
editor is about 80 kB and 10 kB, plus Blockly (about 640 kB and one 80 kB language file), which
is fetched only when the block editor is first opened.

| Command | What it does |
|---|---|
| `npm run dev` | player at http://localhost:5173, editor at http://localhost:5173/editor.html |
| `npm test` | engine, ZIP, editor and block-conversion tests (41 tests) |
| `npm run template` | rebuild `public/player-template.html` (also run by `dev` and `build`) |
| `npm run build` | type-check, then build the static site into `dist/` |

## 2. Story format (built)

The full definition with comments is [src/shared/format/types.ts](../src/shared/format/types.ts).
Summary:

- **Story**: `id`, `title`, `author`, `description`, `language`, `theme`, `cover`, `startPage`,
  `hero`, `professions[]`, `items[]`, `counters[]`, `pages[]`.
- **Page**: `text` and `actions[]` are all a simple page needs. Optional: `title`, `image`,
  `extraTexts[]` (text shown under a condition), `onFirstVisit` / `onEveryVisit` effects,
  `combat`, `ending`, `pos` (place on the editor map).
- **Action**: `label` and `target`. Optional: `when` (condition), `lockedHint` (show the action
  greyed out with an explanation instead of hiding it), `effects`, `once`. An action without a
  target keeps the hero on the page ("take the key", "buy a potion").
- **Combat**: an `enemy` (name, picture, hit points, attack, defense) and what happens on
  `onWin`, `onLose`, and optionally `flee`.
- **Item**: name, description, picture, a passive `bonus` to attack or defense, and optionally
  `use` effects (a potion).
- **Counter**: a named number the author defines, such as gold or score.
- **Hero / profession**: starting stats, fixed items, and "choose X of these items".

Conditions and effects are small JSON trees. Each kind corresponds to exactly one editor block.

| Conditions | Effects |
|---|---|
| `hasItem`, `did` (action used), `visited` (page), `won` (fight on a page), `profession`, `compare` (stat, counter or item count against a number), `and`, `or`, `not` | `giveItem`, `takeItem`, `changeStat`, `setStat`, `changeCounter`, `setCounter`, `message`, `goto`, `if` / else, `chance` (luck in percent) |

Example of a locked door:

```json
{
  "id": "door-open",
  "label": "Open the door",
  "target": "treasury",
  "when": { "type": "hasItem", "item": "key" },
  "lockedHint": "The door is locked.",
  "effects": [{ "type": "takeItem", "item": "key" }]
}
```

Rules that keep the format safe to grow:

- Readers ignore unknown fields and unknown condition or effect kinds. A story made by a newer
  editor still plays in an older player, minus the new feature.
- `format` is a version number. A player refuses a story with a higher format than it knows.
- Picture references must be relative paths inside the package. The loader rejects absolute
  paths, `..`, and addresses such as `http:`.
- Story text is plain text with `**bold**` and `*italic*`. It is never interpreted as HTML.

### Packaging

| Package | Contents | Used for |
|---|---|---|
| Folder | `story.json` + `images/…` | bundled adventures, hosting on any static web host |
| ZIP | the same files, optionally inside one folder | the editor's export and backup file; opened by the player site |
| Single HTML | the player with the story and pictures embedded | sending one file that opens by double-click |

The player loads all three, and the editor produces the ZIP and the HTML. The single HTML embeds
the data as
`<script type="application/json" id="adventure-data">{"story": …, "assets": {"images/a.png": "data:image/png;base64,…"}}</script>`.

## 3. Game engine (built)

`Game` in [src/shared/engine/game.ts](../src/shared/engine/game.ts) is the whole rulebook.

- **Commands** change the game: `start(choice)`, `act(actionId)`, `fightRound()`,
  `finishCombat()`, `flee()`, `useItem(itemId)`, `moveOn()`. A command that is not allowed
  right now does nothing and returns `false`.
- **Results are read where they happen.** When a command's effects say something (a `message`)
  and then lead to another page, the hero does not move yet: `state.moveTo` holds the next page,
  `view()` has status `moving` and no actions, and `moveOn()` goes there. The player shows
  "Continue ➜". So "You hold your breath... and it works!" stays on the throne hall instead of
  appearing under the next page's text. Choices without a message move on at once. Effects of
  arriving at a page (`onFirstVisit` / `onEveryVisit`) do not wait.
- **The page's log** (`state.log`, `view.log`) keeps everything that happened on the current
  page, oldest first: one entry per command, with its notices and, when the hero stayed on the
  page, the picked choice's text as the hero's line. This makes conversations work on one page
  (choices that stay, "only once", "already picked"; speaker names are typed into the "say"
  text). Entering a page empties it; it keeps at most 30 entries. `view.notices` is still only
  the last command. Saves from before the log show their last notices.
- **`view()`** returns everything a screen needs to draw the current moment: the texts, the
  available actions, the fight, the hero, the bag, the counters, and the notices
  ("You got: Rusty key").
- **`state`** is plain JSON. Saving is `JSON.stringify(game.state)`; continuing is
  `game.restore(saved)`, which refuses a save that does not fit the story.
- **`onEvent`** reports everything that happens, in order: `pageEnter`, `action`, `combatStart`,
  `combatRound`, `combatEnd`, `ending`, `gameOver`, plus the notices. The player does not use it
  yet. It exists for sound and music (section 6).

### Fight rules

Each round the hero strikes first, then the enemy if it is still standing.

> damage = die roll (1 to 6) + attacker's attack − defender's defense, never below 0.
> A roll of 6 always does at least 1 damage, so no fight can last forever.

The player taps once per round and sees the arithmetic. Items with a bonus count automatically.
Usable items (potions) can be used between rounds. After the last round the player confirms,
and the engine applies the author's outcome:

- **Win**: `onWin` effects run. With a target the hero moves there; without one the page's
  normal actions appear. A won fight does not repeat when the page is visited again.
- **Lose**: with an `onLose` target the hero survives with 1 hit point and moves there.
  Without one the game is over.
- **Flee**: only if the author defined it. The fight starts again on the next visit.

The numbers are constants in [src/shared/engine/rules.ts](../src/shared/engine/rules.ts) and
easy to tune.

### Robustness

- Random numbers come from a small seeded generator whose seed is part of the saved game. Dice
  are repeatable in tests and a reload in the middle of a fight changes nothing.
- A link to a page that does not exist keeps the hero in place and shows "This path is not
  finished yet", so half-built stories stay playable.
- Pages that send the hero around in a circle with `goto` are cut off after 50 jumps.
- Hit points at 0 outside a fight end the game.

### Validation

`validateStory()` returns a list of problems as data (a code and the place), for example
`unknownPage`, `deadEnd`, `unreachablePage`, `unknownItem`, `duplicateId`. Only two things are
errors that stop the player: a missing start page and duplicate ids. Everything else is a
warning. The editor will show these in the author's language and jump to the place.

### Tests

`npm test` covers professions and starting items, movement, conditions, locked and one-time
actions, `goto` / `if` / `chance`, the fight formula, winning, losing, fleeing, items, death,
broken links, save and continue, waiting with "Continue" after a message, the page's log, and 300 random play-throughs of each sample adventure that must
all reach an ending without getting stuck.

## 4. Player (built)

### Where the story comes from

[src/player/main.ts](../src/player/main.ts) tries three sources in order:

1. A story embedded in the page (single HTML export).
2. The `?story=` address: a folder containing `story.json`, a `story.json` file, or a `.zip`.
   Example: `?story=adventures/goblin-cave/`.
3. Otherwise the **library**: the adventures listed in `public/adventures/index.json`, plus a
   button to open a ZIP file from the device.

A story on another website can be played through `?story=https://…`, provided that website
allows cross-origin requests (CORS).

### Screens

[src/player/app.ts](../src/player/app.ts) has three screens and two dialogs:

- **Title page**: cover, title, author, description; "Continue" when a saved game exists, and
  "New adventure" (which asks before discarding a saved game).
- **Hero creation**: pick a profession, pick the starting items. Skipped when the story has
  neither.
- **Game**: status bar (hit points, attack, defense, visible counters, bag), the picture, the
  text, the page's log (what happened here, with "➤" lines for the picked choices), then either the fight, the choices, or "Continue ➜" after a result. Endings and death show a closing block
  with "Play again".
- **Bag**: items with descriptions and bonuses, and "Use" for usable items.
- **Menu**: start again, back to the title page, other adventures.

After every command the game is saved first and the screen is then drawn again from `view()`.
There is no partial updating to get out of sync. Stories are small enough for this to be instant.

### Saving

One saved game per story in `localStorage` under `adventures.save.<story id>`, written after
every command, including the middle of a fight. Reloading the page, closing the tab, or pressing
Back loses nothing: the title page offers "Continue". If storage is unavailable (private
browsing), the game still plays and only continuing later is lost.

### Language

Interface texts live in [src/player/i18n/en.ts](../src/player/i18n/en.ts) and `cs.ts`. The
player uses the story's `language`, so a Czech story gets Czech buttons. The library uses the
browser's language until the reader picks one with its language button; the choice is
remembered in the browser, and adventures in that language are listed first. Adding a language is one new file and one line in `i18n/index.ts`.

### Phones

Layout is one column up to 44 rem wide, tap targets are at least 44 px high, the status bar
sticks to the top and wraps on narrow screens, and safe-area insets are respected. Checked at
375 × 812.

## 5. Visual styles (built)

A story picks a style with `"theme": "fantasy" | "neutral" | "scifi"`. Fantasy is the default.
Adding `?theme=scifi` to the address overrides it, which is handy for trying styles out.

| Style | Look |
|---|---|
| `fantasy` | Parchment page with a paper texture and darker edges on dark leather, a bookish serif font, small-caps headings, a red drop cap, a double frame with corner studs, a diamond ornament before the choices. |
| `neutral` | Clean and modern, no genre. Light, or dark when the device is in dark mode. |
| `scifi` | Dark panels on a faint grid, glowing cyan, cut-off corners, monospace headings in capitals. |

How it is put together, so styles are easy to edit by hand:

- [base.css](../src/player/styles/base.css) holds all layout and contains no colours or fonts.
  It only uses variables such as `--paper-bg`, `--ink`, `--accent`, `--font-body`,
  `--button-border`, `--divider-mask`.
- Each `theme-*.css` sets those variables under `[data-theme='name']` and may add decorations of
  its own below (the fantasy frame and drop cap, the sci-fi cut corners).
- To add a style: copy a theme file, rename the selector, and add the name to the list in
  [themes.ts](../src/player/themes.ts).

Two deliberate choices:

- **Fonts are system fonts.** The fantasy style uses Palatino, Book Antiqua and their
  equivalents, which exist on Windows, macOS, Linux and Android and include Czech letters. No
  font file is downloaded, so the single HTML export works offline. A real medieval display font
  would have to be bundled and embedded; that is possible later but not done.
- **Decorations are CSS and inline SVG**, not image files, for the same reason.

Later options, not built: per-story colour tweaks on top of a style, and a style picker in the
editor with a live preview.

## 6. Sound and music (planned, prepared for)

Nothing plays sound yet. The design leaves room for it without changing what exists:

- **Format**: a `sounds/` folder in the package and a list of named sounds and music tracks in
  the story. New effects such as "play sound X" on an action, and music per story, per page, and
  for fights. Older players skip the unknown effects and fields.
- **Engine**: already emits `combatStart`, `combatEnd`, `pageEnter`, `action`, `ending` and
  `gameOver` through `onEvent`. Switching between normal and fight music needs no engine change.
- **Player**: a small audio module subscribes to `onEvent`, with a mute button in the status bar
  and the choice remembered. Browsers only allow sound after the first tap, which the title page
  provides.
- **Loader**: the picture lookup becomes a general file lookup that also covers audio.
- **Editor**: a sound library per project like the picture library, and a "play sound" block.

## 7. Editor (partly built)

### What is built and what is not

| Built (steps 2 and 3) | Not built yet |
|---|---|
| Project list: new, open, copy, delete to a list it can be put back from, start from an example | "Save as a file": one HTML file or a ZIP; "open an adventure file" on the project list |
| Map: pages and arrows, pan, zoom, drag pages, drag-to-connect, drag-to-create | Test panel to set the bag and counters before play-testing |
| Page panel: name, text, picture, choices, fight, ending, start page, extra texts | "Tidy up" automatic layout of the map |
| Blocks for the rules of a choice, arrival effects, fight outcomes, extra-text conditions and item use | Backup reminder |
| Lists of items, counters, and the hero with professions (top bar: 🎒 🔢 🧙) | "New item…" directly from a block's drop-down list |
| Story settings: name, author, description, language, look, cover | |
| Autosave, undo and redo that survive a reload, trash for pages, older versions | |
| Hints with jump-to-page; play-testing from the start or from a page | |
| Czech and English texts, including the blocks; one-tab-at-a-time lock | |

The rest of this section describes the design; where the built part differs, it says so.

### Principles

1. **A simple page takes seconds.** Write the text, drag an arrow, type "go north". No blocks,
   no ids, no dialogs.
2. **Nothing the author does can lose work.** Every change is saved at once, everything can be
   undone, deleting is never final, and the app never refuses to save an unfinished story.
3. **Mistakes are hints, not errors.** Problems appear as a friendly list that jumps to the
   place. They never block editing or testing.

### Screen layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ My adventure ▾   ↶ Undo  ↷ Redo        Saved ✓     ▶ Play    ⬇ Export    │
├───────────────────────────────────────────────┬──────────────────────────┤
│                                               │ Page: Forest path        │
│   [Village] ──go to forest──▶ [Forest]        │ Picture  [choose]        │
│       │                          │            │ Text     [............]  │
│    visit trader            look in bushes     │ Choices                  │
│       ▼                          ▼            │  Go north    → Cave      │
│   [Trader]                   [Wolf ⚔]         │  Look in…    → Wolf  ◆   │
│                                               │  [+ add a choice]        │
│   ⚠ 2 hints                                   │ Fight   [+ add]          │
├───────────────────────────────────────────────┴──────────────────────────┤
│ Tabs: Map · Items · Counters · Hero and professions · Story settings     │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Map** (centre): pages are boxes, choices are labelled arrows. Dragging from a page into
  empty space creates a new page and the choice leading to it in one move. Dragging onto another
  page links them. Badges mark the start page, endings, fights and hints. Pan, zoom, and an
  "tidy up" button. Built with SVG and pointer events so it works with mouse and touch.
  Arrows bend away from each other, and further out where needed so that each arrow's text
  is clear of every page box and of the texts already drawn (pages standing side by side get
  one arc above and one below).
- **Page panel** (right): text, picture, choices, and optional sections for fight, extra texts
  and "when the hero arrives" effects. A choice is a label and a target page chosen from a list.
  A small ◆ button on a choice opens its blocks.
- **Copying** (on trial): ⧉ on a choice puts a copy right after it, rules included.
  "Make a copy of this page" copies a page with all its choices next to it; whatever inside
  it referred to the page itself or to its own choices now refers to the copy. In the block
  editor, Copy and Paste carry whole rules from one place to another: pasting adds to what is
  there (conditions must both hold, effects run one after the other), only the parts that
  fit, and as one undo step. Copied rules are kept in the browser, so they survive a reload.
- **Other tabs**: tables for items, counters, the hero and professions, and story settings
  (title, author, language, visual style with preview).
- On a phone the map and the page panel become two screens instead of two columns.

### Blocks for conditions and effects

Blocks appear only where logic is needed: on a choice, on an extra text, on arrival effects, on
fight outcomes, and on usable items. They are built with **Blockly**, the editor's only planned
runtime dependency, which the audience already knows from Scratch-style tools and which ships
Czech and English texts.

Each block corresponds to one condition or effect of the format (the table in section 2):

```
┌ if   [has item (key ▾)]  and  [did (pull the lever ▾)]
└ then [take item (key ▾)]
       [say "The door creaks open."]
```

- The story JSON is the single source of truth. Opening the block editor builds the blocks from
  the JSON, and every block change writes JSON straight back. Block positions are not stored.
- Drop-down lists are filled from the story (items, pages, counters, choices), so an author
  never types an id. Creating a new item from inside a list is planned; for now items are added
  in the items list first.
- Blocks that refer to something deleted stay visible, marked "deleted", and are reported as a
  hint.

How it is built:

- A "◆" button opens the block editor wherever logic can go. The number on it shows how much is
  already there. The editor is one full-screen dialog holding one fixed yellow root block that
  the author fills in: a question slot, a slot for a stack of effects, or both for a choice.
  Blocks left lying loose outside the root block are not part of the rule.
- `rules/convert.ts` translates between the format and Blockly's saved-workspace data. It has
  no dependency on Blockly, so it is tested in Node: every rule of the sample adventures must
  survive the round trip unchanged.
- `rules/blocks.ts` defines how each block looks and what the palette offers. One block type per
  condition or effect (`cond_*`, `fx_*`).
- When the dialog is at least 640 px wide, the palette stays open: the first group of blocks is
  shown at once, and dragging a block out or clicking the workspace does not close it (a small
  `Toolbox` subclass in `rules/dialog.ts`). Narrower screens keep Blockly's pop-out menu.
- For experienced authors, a quiet "</>" button shows the rule as short Python-like text beside
  the blocks (`rules/text.ts`), with a Copy button, for example
  `available if Gold >= 8` / `when picked:` / `give("Wooden shield")`. Things appear by name,
  deleted ones as `?id`. It is read-only and follows every block change; whether it is open
  is remembered in the browser. Nothing parses the text back (yet).
- Conditions or effects this editor does not know (from a newer version) become a grey
  "cannot show" block that carries the original JSON along, so nothing is lost.
- "a and b and c" is drawn as nested two-slot blocks and stored flat again. A comparison written
  as "5 < gold" is shown as "gold > 5". Effects after "go to page" are dropped, since they could
  never run.
- "Only once" and the greyed-out explanation of a choice are ordinary form fields above its blocks.
- Blockly's small picture files are served from `public/blockly-media/`, so nothing is fetched
  from another website.

### Data and saving

- **Document**: the editor's document is the story JSON itself, plus picture files. Authors
  never see ids; they are generated.
- **One door for changes**: every edit goes through `store.change(doc => …)`, which copies the
  document, lets the caller modify the copy, and keeps the previous version. Documents are text
  only (pictures live elsewhere), so whole copies are cheap enough and cannot be corrupted by a
  stray modification.
- **Undo and redo**: the history is the list of past documents, up to 60 steps. Typing in one
  field is grouped into one step until a pause. The history is saved with the project, so it
  survives a reload. The trash is part of the document, so undoing a delete also takes the page
  out of the trash.
- **Autosave**: projects live in the browser's **IndexedDB**, in three stores: projects (story
  JSON), pictures (binary files), and snapshots. Each change is written within a fraction of a
  second, and again when the tab is hidden or closed. A "Saved ✓" indicator shows the state.
- **Snapshots**: an automatic copy every few minutes of work and before risky operations
  (import, deleting many pages). The last 20 or so are kept, and any can be restored.
- **Trash**: deleted pages and items move to a trash and can be put back. Links to a deleted
  page become hints instead of being removed.
- **Reload and Back**: the address holds the open project and page (`#/project/…/page/…`), so a
  reload or a mistaken Back returns to the same place.
- **Two tabs**: a lock stops two tabs from editing the same project at once; the second one
  offers to take over.
- **Storage loss**: the editor asks the browser for persistent storage and regularly reminds the
  author to download a backup ZIP, because browser storage can be cleared by the user or the
  school's device policy. This is the one risk a web editor cannot fully remove.

### Pictures

Chosen from a file, pasted from the clipboard, or taken with the device camera. The editor
shrinks them (long side about 1280 px) and compresses them before storing, so exports stay small
enough to send. Each project has a picture library; a picture can be reused on several pages.

### Hints

`validateStory()` runs after every change. The results are shown as a list in the author's
language ("Page *Cave* leads nowhere", "Nobody can reach page *Tower*") and as badges on the
map. Clicking a hint opens the place.

### Testing a story

"Play" opens the real player in a frame over the editor, reading the project straight from
IndexedDB (`index.html?preview=<project>&page=<page>`). It starts from the open page, or from
the start. Test games are not saved and do not touch the saved game of the real player. Still
planned: a small panel to set the bag, counters and stats before a test.

### Export and import

Built. "Save as a file" (⬇ in the top bar) offers two files; both can be saved while the story
still has hints.

- **ZIP**: `story.json` and the pictures the story uses. This is the backup, the file another
  author opens in their editor, and what the player site opens. `writeZip` in
  `src/shared/zip.ts` uses the browser's own compression, so there is no ZIP library. Text is
  compressed; pictures are stored as they are.
- **Single HTML**: `scripts/build-template.mjs` builds the player into one file,
  `public/player-template.html` (about 40 kB, script and styles inline). The export copies it
  and puts in the story and the pictures as data. The template is rebuilt by `npm run dev` and
  `npm run build` and is not kept in git. Every "<" in the embedded data is written as
  `\u003c`, so story text can never close the script element.
- **Import**: "Open an adventure file (.zip)" on the project list. A ZIP always becomes a new
  project with a new story id; it never replaces an existing one. Only picture files the story
  refers to are taken from the archive.

### Code structure

```
src/editor/
  main.ts          start-up; the address (#/p/<project>/<page>) decides what is shown
  home.ts          project list
  workspace.ts     one open project: top bar, saving, undo, the one-tab lock
  context.ts       what map, panel and dialogs may use from the workspace
  store.ts         change(), undo/redo history
  ops.ts           editing operations as plain functions (add page, delete page, ...)
  map.ts           the map: HTML boxes, SVG arrows, dragging, zoom
  panel.ts         the page panel and its form helpers
  dialogs.ts       story settings, hints, trash, older versions, play-test
  images.ts        resize and compress
  tables.ts        lists of items, counters, hero and professions
  rules/convert.ts conditions and effects <-> block data (no Blockly needed; tested)
  rules/blocks.ts  what each block looks like, and the palette
  rules/dialog.ts  the block editor dialog; loads Blockly on first use
  i18n/            editor texts in Czech and English
  export.ts        ZIP and single-HTML export, ZIP import
  editor.css       the editor's own look
src/shared/db.ts   IndexedDB: projects, pictures, snapshots
```

It reuses `src/shared` (format, validation, engine, ZIP) and embeds `src/player` for testing.
Vite builds it as a second page, `editor.html`, next to the player.

## 8. Deployment

`npm run build` produces a folder of static files that works from any location on any static
host (GitHub Pages, a school web server, a USB stick with a local server). No server-side code.

Ways an author shares a finished adventure:

1. Export the single HTML and send the file. Nothing needs to be hosted.
2. Export the ZIP; the player opens it with "Open an adventure file".
3. Put the ZIP or folder on the web and share a link: `…/index.html?story=<address>`.
4. Add it to the site's own library: copy the folder into `adventures/` and add an entry to
   `adventures/index.json`.

## 9. Next steps and open points

All four planned steps are built. Remaining polish, in rough order of value:

- a backup reminder in the editor (browser storage can be cleared);
- a test panel to set the bag and counters before play-testing;
- "new item…" directly from a block's drop-down list;
- automatic tidy-up of the map;
- sound and music (section 6).

Known gaps in what is built:

- Exports were checked like this: the HTML file was built in the browser and played inside a
  frame, with pictures; a ZIP was built and opened again as an identical project; a ZIP from the
  same writer was unpacked by Windows' own unzip to identical files. The download step itself,
  and opening an exported HTML file from disk by double-click, were not exercised.
- The player and the editor were checked in the desktop app's browser (Chromium) at desktop and
  phone size. Neither has been tried on real phones, Safari, or Firefox. In the editor, dragging
  was exercised with simulated mouse events; touch dragging and pinch zoom are written but untested,
  and so are choosing, pasting and dropping pictures.
- In the block editor, loading rules, drop-down lists, changing a field and saving were checked.
  Dragging a block out of the open palette, switching groups and reopening were checked with
  simulated mouse events; the block editor opened at phone size with the pop-out menu, but was
  not used there further.
- The map does not draw an arrow for a link to a deleted page; it shows as a hint instead.
- When an author changes a story, an older saved game is kept if its page still exists and
  refused otherwise. There is no finer migration.
- There are no checkpoints: death means starting again.
- Status icons are emoji and look slightly different per device.
- Fight numbers in the samples are a first guess and have not been balanced by playtesting.

Decisions still open:

- Whether dying should offer "go back to the last safe page" instead of only starting again.
- Whether a profession may also change starting counters (a thief starting with more gold).
- Whether to bundle a medieval display font for the fantasy style.
