import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site can be hosted in any folder of any static web host.
  base: './',
  build: {
    target: 'es2022',
    // Two pages: the player (index.html) and the editor (editor.html).
    rollupOptions: { input: ['index.html', 'editor.html'] },
    // Blockly is one big file (about 640 kB). It is loaded only when the block editor
    // is first opened, so the size is expected and not a problem to warn about.
    chunkSizeWarningLimit: 800,
  },
});
