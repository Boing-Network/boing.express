/**
 * Builds only the inpage provider script as IIFE so it can run in the page context
 * when injected via <script src="inpage.js"> (no module support).
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const manifestVersion: string = JSON.parse(readFileSync(resolve(__dirname, 'extension/manifest.base.json'), 'utf8')).version;

export default defineConfig({
  // Website public/ files (favicons, _headers, sitemap...) don't belong in the extension.
  publicDir: false,
  // provider.version / boing_getCapabilities (dApps gate native-value calls on it).
  define: { __BOING_EXPRESS_VERSION__: JSON.stringify(manifestVersion) },
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
