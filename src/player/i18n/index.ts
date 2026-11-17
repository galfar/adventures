import { makeTranslator } from '../../shared/i18n.ts';
import { cs } from './cs.ts';
import { en, type Messages } from './en.ts';

/** To add a language: copy `en.ts`, translate it, and register it here. */
const LANGUAGES: Record<string, Messages> = { en, cs };

export type Translate = (key: keyof Messages, params?: Record<string, string | number>) => string;

/** Returns the text lookup for a language such as `cs` or `en-GB` (English if unknown). */
export function translator(language: string): Translate {
  return makeTranslator(LANGUAGES, en, language);
}
