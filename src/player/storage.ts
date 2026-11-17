import type { GameState } from '../shared/engine/state.ts';

/**
 * Saved games live in the browser's localStorage, one per story. All access is guarded:
 * private browsing or a full storage must never break the game, only the "continue later".
 */
const key = (storyId: string) => `adventures.save.${storyId}`;

export function readSave(storyId: string): GameState | undefined {
  try {
    const text = localStorage.getItem(key(storyId));
    return text ? (JSON.parse(text) as GameState) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSave(state: GameState): void {
  try {
    localStorage.setItem(key(state.storyId), JSON.stringify(state));
  } catch {
    // Storage unavailable or full: keep playing without saving.
  }
}

export function clearSave(storyId: string): void {
  try {
    localStorage.removeItem(key(storyId));
  } catch {
    // Nothing to clear.
  }
}
