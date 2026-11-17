import './styles/base.css';
import './styles/theme-fantasy.css';
import './styles/theme-neutral.css';
import './styles/theme-scifi.css';

/**
 * The predefined visual styles a story can choose with its `theme` field.
 * Each style is one CSS file in `styles/` that sets the variables used by `base.css`
 * (colours, fonts, borders) and may add its own decorations.
 * To add a style: copy a theme file, change `[data-theme='…']`, and list it here.
 */
export const THEMES = ['fantasy', 'neutral', 'scifi'] as const;
export const DEFAULT_THEME = 'fantasy';

export function applyTheme(theme: string | undefined): void {
  const known = (THEMES as readonly string[]).includes(theme ?? '');
  document.documentElement.dataset.theme = known ? theme : DEFAULT_THEME;
}
