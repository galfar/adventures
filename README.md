# Adventures

**Try it live:** [play the adventures](https://galfar.github.io/adventures/) ·
[open the editor](https://galfar.github.io/adventures/editor.html)

A framework for making and playing gamebook-style adventures, aimed at young authors
(about 10–15 years old) who know Scratch- or Blockly-style tools.

An adventure is a set of pages with text, an optional picture and choices that lead to
other pages. Choices can depend on conditions ("has the key", "already visited the cave"),
pages can hold dice-roll fights, and the hero carries items, stats and counters such as gold.

It has three parts that share one story format:

- **Player**: a web app that plays an adventure. It works on phones, saves progress in the
  browser, and offers fantasy, neutral and sci-fi looks.
- **Editor**: a web app where authors lay out pages on a map, connect them with arrows, and
  build rules from snap-together blocks. Every change saves itself and can be undone.
- **Story format**: one `story.json` plus picture files, shared as a ZIP or as a single HTML
  file that plays by double-click.

The interface is in Czech and English. Everything is static files; there is no server.

## Quick start

Requires [Node.js](https://nodejs.org/) 24 or newer (the tests run TypeScript directly in Node).

```bash
npm install
npm run dev
```

Then open:

- Player: http://localhost:5173
- Editor: http://localhost:5173/editor.html

In the editor, "Start from an example" copies one of the sample adventures so there is
something to look at straight away.

### Where the editor's work is stored

The editor saves projects in the browser's own storage (IndexedDB), not in project files.
They are kept separately for each browser and each address, so `localhost:5173` and
`localhost:5174` have different projects, and clearing the site's data removes them. Editing
never changes anything in `public/`.

To take a project out, use "Save as a file" (⬇) in the editor to get a ZIP or a single HTML
file. To turn it into a bundled sample, unpack the ZIP into `public/adventures/<name>/` and
list it in `public/adventures/index.json`.

`public/` is the source of the bundled adventures. `dist/` is only the output of
`npm run build` (a copy of `public/` plus the built code) and is not kept in git.

### Writing a conversation

A talk with a character fits on one page. While the hero stays on a page, everything that
happens there stays listed under the text, and each picked choice shows as the hero's line
("➤ Who are you?"). The list starts empty on every page.

- Each thing the hero can say is a choice with no target ("stays on this page").
- The character's answer is a "say" block. Put the name in front: `Grub: Five gold.`
- "This choice can be used only once" stops a question from being asked twice.
- "already picked" unlocks the next question after the previous one.
- The last line can lead to another page. The answer then shows first, with "Continue ➜".

In the editor's text view (`</>`) the trader in the Goblin Cave sample looks like this:

```
# "Have you seen the goblins?"   (only once)
when picked:
    say("Trader: Seen them? They stole my best lamp! ...")

# "Anything else I should know?"   (only once)
available if did("The trader: Have you seen the goblins?")
when picked:
    say("Trader: The king sleeps like a log. ...")
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server for the player and the editor |
| `npm test` | Tests (Node's built-in test runner) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run template` | Rebuild the single-file player used by the HTML export (run by `dev` and `build`) |

## Deploying

`npm run build` produces a folder of static files that works from any path on any static
host, such as GitHub Pages or a school web server.

On GitHub, `.github/workflows/pages.yml` does this by itself: every push to the main branch
runs the tests, builds, and publishes `dist/` on GitHub Pages. Turn it on once with
Settings → Pages → Source: "GitHub Actions" (or `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`).

To add an adventure to the player's built-in library, put its folder (`story.json` and
`images/`) into `public/adventures/` and list it in `public/adventures/index.json`. Any
adventure can also be opened by address: `index.html?story=<folder, story.json or .zip URL>`.

## Project layout

```
src/shared/format/   story format (types.ts is the specification) and validation
src/shared/engine/   game rules, independent of the screen
src/shared/          ZIP reading and writing, editor storage (IndexedDB), small helpers
src/player/          player screens, loading, saving, visual styles
src/editor/          editor: map, page panel, dialogs, undo, export
src/editor/rules/    blocks for conditions and effects (Blockly)
public/adventures/   sample adventures
scripts/             build of the single-file player template
tests/               tests
docs/                architecture report
```

## Tech stack

TypeScript with plain DOM code and no UI framework, built with Vite. The player has no
runtime dependencies. The editor uses [Blockly](https://developers.google.com/blockly) for
its blocks, loaded only when the block editor is first opened.

## Documentation

- [docs/architecture.md](docs/architecture.md): design, story format, engine rules, editor
  internals, what is built and what is still open.
- [CLAUDE.md](CLAUDE.md): conventions for working on the code.
