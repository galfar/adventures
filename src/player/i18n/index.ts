import { makeTranslator } from '../../shared/i18n.ts';
import { cs } from './cs.ts';
import { en, type Messages } from './en.ts';

/** To add a language: copy `en.ts`, translate it, and register it here. */
const LANGUAGES: Record<string, Messages> = { en, cs };
const STORAGE_KEY = 'adventures.player.language';

export type Translate = (key: keyof Messages, params?: Record<string, string | number>) => string;

/**
 * The language of the library page: the one chosen with its language button, else the
 * browser's. (Inside an adventure the player always speaks the story's own language.)
 */
export function libraryLanguage(): string {
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem(STORAGE_KEY);
  } catch {
    // No storage: follow the browser.
  }
  const language = (chosen ?? navigator.language).toLowerCase().split('-')[0]!;
  return language in LANGUAGES ? language : 'en';
}

export function setLibraryLanguage(language: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice just will not be remembered.
  }
}

/** Returns the text lookup for a language such as `cs` or `en-GB` (English if unknown). */
export function translator(language: string): Translate {
  return makeTranslator(LANGUAGES, en, language);
}
