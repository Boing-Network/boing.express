/**
 * Builds only the inpage provider script as IIFE so it can run in the page context
 * when injected via <script src="inpage.js"> (no module support).
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Website public/ files (favicons, _headers, sitemap...) don't belong in the extension.
  publicDir: false,
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    lib: undefined,
    rollupOptions: {
      input: resolve(__dirname, 'extension/inpage.ts'),
      output: {
        entryFileNames: 'inpage.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    target: 'esnext',
    minify: true,
  },
});
