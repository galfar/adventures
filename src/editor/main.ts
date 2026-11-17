import './editor.css';
import { showHome } from './home.ts';
import { editorLanguage, translator } from './i18n/index.ts';
import { Workspace } from './workspace.ts';

/**
 * Start-up of the editor. The address decides what is shown, so a reload or the Back
 * button always lands somewhere sensible:
 *   #/                      the list of adventures
 *   #/p/<project>           one adventure
 *   #/p/<project>/<page>    one adventure with a page open
 */

const root = document.getElementById('app')!;
let workspace: Workspace | undefined;
/** Counts navigations, so a slow one that was overtaken does not draw over a newer one. */
let navigation = 0;

async function route(): Promise<void> {
  const mine = ++navigation;
  await workspace?.dispose();
  workspace = undefined;
  if (mine !== navigation) return;

  const language = editorLanguage();
  const t = translator(language);
  document.documentElement.lang = language;
  document.title = t('appTitle');

  const match = /^#\/p\/([^/]+)(?:\/(.+))?$/.exec(location.hash);
  if (!match) {
    await showHome(root, t, language, () => void route());
    return;
  }
  const opened = await Workspace.open(root, decodeURIComponent(match[1]!), t, language, match[2] && decodeURIComponent(match[2]));
  if (mine === navigation) workspace = opened;
  else await opened?.dispose();
}

Workspace.onReplace = (opened) => {
  workspace = opened;
};
window.addEventListener('hashchange', () => void route());
void route();
