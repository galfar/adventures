import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site can be hosted in any folder of any static web host.
  base: './',
  build: {
    target: 'es2022',
    // Two pages: the player (index.html) and the editor (editor.html).
    rollupOptions: { input: ['index.html', 'editor.html'] },
  },
});
