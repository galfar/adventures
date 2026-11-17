// Builds `public/player-template.html`: the whole player (script and styles) inside one
// HTML file. The editor's "one file to play" export copies this file and puts the story
// and its pictures into it, so the result opens by double-click with nothing else needed.
//
// Run by `npm run dev` and `npm run build`; the output is not kept in git.

import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'vite';

const result = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/player/main.ts',
      // One classic script without imports, so it also runs from a file on disk.
      output: { format: 'iife' },
    },
  },
});

const output = (Array.isArray(result) ? result[0] : result).output;
const script = output.find((file) => file.type === 'chunk')?.code;
const styles = output
  .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
  .map((file) => String(file.source))
  .join('\n');
if (!script || !styles) throw new Error('The player build produced no script or no styles.');

// Text inside <script> and <style> must not contain their own closing tag.
const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title><!--ADVENTURE-TITLE--></title>
    <link rel="icon" href="data:," />
    <style>${styles.replace(/<\/style/gi, '<\\/style')}</style>
  </head>
  <body>
    <div id="app"></div>
    <!--ADVENTURE-DATA-->
    <script>${script.replace(/<\/script/gi, '<\\/script')}</script>
  </body>
</html>
`;

mkdirSync('public', { recursive: true });
writeFileSync('public/player-template.html', html);
console.log(`player-template.html: ${Math.round(html.length / 1024)} kB`);
