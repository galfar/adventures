/**
 * Text lookup shared by the player and the editor. Each app keeps its own texts
 * (one file per language); `{name}` parts are filled in from `params`.
 */
export function makeTranslator<M extends Record<string, string>>(
  languages: Record<string, M>,
  fallback: M,
  language: string,
): (key: keyof M, params?: Record<string, string | number>) => string {
  // `cs-CZ` and `cs` both select Czech; an unknown language falls back.
  const messages = languages[language.toLowerCase().split('-')[0]!] ?? fallback;
  return (key, params = {}) =>
    (messages[key] ?? fallback[key]).replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}
