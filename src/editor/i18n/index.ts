import { makeTranslator } from '../../shared/i18n.ts';
import { cs } from './cs.ts';
import { en, type Messages } from './en.ts';

/** To add a language: copy `en.ts`, translate it, and register it here. */
const LANGUAGES: Record<string, Messages> = { en, cs };
const STORAGE_KEY = 'adventures.editor.language';

export type Translate = (key: keyof Messages, params?: Record<string, string | number>) => string;

/** The editor's language: the one chosen with the language button, else the browser's. */
export function editorLanguage(): string {
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem(STORAGE_KEY);
  } catch {
    // No storage: follow the browser.
  }
  const language = (chosen ?? navigator.language).toLowerCase().split('-')[0]!;
  return language in LANGUAGES ? language : 'en';
}

export function setEditorLanguage(language: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice just will not be remembered.
  }
}

export function translator(language: string): Translate {
  return makeTranslator(LANGUAGES, en, language);
}
