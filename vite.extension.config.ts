import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    lib: undefined,
    rollupOptions: {
      input: resolve(__dirname, 'extension/popup.ts'),
      output: {
        entryFileNames: 'popup.js',
        format: 'es',
      },
    },
    sourcemap: true,
    target: 'esnext',
    minify: true,
  },
  define: {
    'import.meta.env.VITE_BOING_TESTNET_RPC': JSON.stringify('https://testnet-rpc.boing.network'),
    'import.meta.env.VITE_BOING_MAINNET_RPC': JSON.stringify('https://rpc.boing.network'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
