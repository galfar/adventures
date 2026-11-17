/**
 * Holds the document being edited and its undo history.
 *
 * Every edit goes through `change()`, which copies the document, lets the caller modify
 * the copy, and keeps the previous version for undo. Documents are small (text only;
 * pictures live elsewhere), so whole copies are simple and fast enough.
 */

/** How many steps can be undone. */
const HISTORY_LIMIT = 60;
/** Edits with the same merge key become one undo step while typing continues... */
const MERGE_PAUSE_MS = 1500;
/** ...but a step never swallows more than this much typing. */
const MERGE_MAX_MS = 8000;

export interface ChangeOptions {
  /**
   * Groups rapid edits of the same thing (typing in one text field) into one undo step.
   */
  merge?: string;
  /** The form that made the change already shows it, so forms need not be rebuilt. */
  quiet?: boolean;
}

export class Store<T> {
  current: T;
  past: T[];
  future: T[];
  /** Called after every change, undo and redo. */
  onChange: (info: { quiet: boolean }) => void = () => {};

  private group: { key: string; started: number; last: number } | undefined;

  constructor(current: T, past: T[] = [], future: T[] = []) {
    this.current = current;
    this.past = past;
    this.future = future;
  }

  change(mutate: (draft: T) => void, options: ChangeOptions = {}, now: number = Date.now()): void {
    const draft = structuredClone(this.current);
    mutate(draft);

    const group = this.group;
    const merging =
      options.merge !== undefined &&
      group?.key === options.merge &&
      now - group.last < MERGE_PAUSE_MS &&
      now - group.started < MERGE_MAX_MS;
    if (!merging) {
      this.past.push(this.current);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.group =
      options.merge === undefined ? undefined : { key: options.merge, started: merging ? group!.started : now, last: now };

    this.future = [];
    this.current = draft;
    this.onChange({ quiet: options.quiet ?? false });
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.current);
    this.current = previous;
    this.group = undefined;
    this.onChange({ quiet: false });
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.current = next;
    this.group = undefined;
    this.onChange({ quiet: false });
    return true;
  }
}
