# Adventures

Gamebook-style adventure framework for young authors (10–15 years old): a story format,
a web player, and a web editor. Everything is static files; there is no server.

Full design, status and remaining build order: [docs/architecture.md](docs/architecture.md).
Keep that document up to date when behaviour or structure changes.

## Commands

- `npm run dev` — player at http://localhost:5173, editor at http://localhost:5173/editor.html
- `npm test` — Node's built-in test runner over `tests/**/*.test.ts`
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — type-check, then build both pages into `dist/`

Run tests and the type-check after changes. UI changes also need a look in the browser.

## Layout

- `src/shared/format/` — story format (`types.ts` is the spec) and validation
- `src/shared/engine/` — game rules; no DOM, plain-JSON state
- `src/shared/` — also `zip.ts`, `db.ts` (editor projects in IndexedDB), `dom.ts`, `i18n.ts`
- `src/player/` — player screens, loading, saving, `styles/` (one `theme-*.css` per look)
- `src/editor/` — editor: `workspace.ts`, `map.ts`, `panel.ts`, `dialogs.ts`, `tables.ts`, `store.ts`, `ops.ts`
- `src/editor/rules/` — blocks: `convert.ts` (format ↔ block data, no Blockly), `blocks.ts`, `dialog.ts`
- `public/adventures/` — sample adventures, listed in `index.json`

## Rules of the codebase

- TypeScript, vanilla DOM (`h()` in `src/shared/dom.ts`), no UI framework. Do not add runtime
  dependencies without asking. Blockly is the only one; it is editor-only and must stay lazily
  imported (`rules/dialog.ts`). The player has none.
- A new condition or effect needs: the type in `format/types.ts`, the engine, a block in
  `rules/blocks.ts`, both directions in `rules/convert.ts`, and block texts in both languages.
- Tests run TypeScript directly in Node: imports need the `.ts` extension, and only erasable
  syntax is allowed (no enums, no constructor parameter properties).
- The engine must stay free of DOM and browser APIs. The player and the editor's play-test
  both drive it through commands and `view()`.
- Story format changes must stay backward compatible: readers ignore unknown fields and
  unknown condition/effect types. Bump `FORMAT_VERSION` only for breaking changes.
- Story text is never inserted as HTML. Picture references are relative paths only.
- Every user-facing string goes through the translation files (`i18n/en.ts` and `cs.ts`) in
  both languages; `cs.ts` is typed against `en.ts`, so a missing key fails the type-check.
- Editor: every edit goes through `ctx.change(doc => …)` with operations from `ops.ts`.
  Never modify `ctx.story` directly. Use `{ merge, quiet }` for typing in a field.
- Editor: nothing the author does may lose work. Prefer undo and trash over confirmation
  dialogs; problems are hints, never blocking errors.
- Player look: `base.css` holds layout only; colours and fonts are variables set per theme.
- Comments explain why, in plain language. The audience for the product is children, so
  interface texts are short and friendly.
