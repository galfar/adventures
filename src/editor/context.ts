import type { EditorDoc } from '../shared/db.ts';
import type { Page, PageId, Story } from '../shared/format/types.ts';
import type { Problem } from '../shared/format/validate.ts';
import type { Translate } from './i18n/index.ts';
import type { ChangeOptions } from './store.ts';

/**
 * What the parts of the editor (map, page panel, dialogs) may use from the workspace.
 * They read the story from here and change it only through `change()`.
 */
export interface EditorContext {
  readonly t: Translate;
  /** The editor's own language (not the story's). */
  readonly language: string;
  readonly projectId: string;
  readonly doc: EditorDoc;
  readonly story: Story;
  /** The page open in the page panel. */
  readonly selected: PageId | undefined;
  readonly problems: Problem[];

  /** The only way to edit: modify the copy you are given. Undo, saving and redrawing follow. */
  change(mutate: (doc: EditorDoc) => void, options?: ChangeOptions): void;
  /** Opens a page in the panel. `focus` names a field to put the cursor in; `reveal` scrolls the map to it. */
  select(pageId: PageId | undefined, options?: { focus?: string; reveal?: boolean }): void;
  /** Puts the cursor in a field of the page panel (fields are named by their `data-key`). */
  focusField(key: string): void;

  /** Name of a page for the map and lists. */
  label(page: Page): string;
  /** URL of one of the project's pictures. */
  assetUrl(path: string | undefined): string | undefined;
  /** Shrinks a picture, stores it in the project and returns its path; undefined if it is not a usable picture. */
  importImage(file: Blob): Promise<string | undefined>;
  /** Writes pending changes to storage now. */
  flush(): Promise<void>;
  /** Text of a hint in the editor's language. */
  problemText(problem: Problem): string;
}
