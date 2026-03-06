import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    lib: undefined,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup.ts'),
        background: resolve(__dirname, 'extension/background.ts'),
        content: resolve(__dirname, 'extension/content.ts'),
        approval: resolve(__dirname, 'extension/approval.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
        chunkFileNames: '[name]-[hash].js',
      },
    },
    sourcemap: true,
    target: 'esnext',
    minify: true,
  },
  define: {
    'import.meta.env.VITE_BOING_TESTNET_RPC': JSON.stringify('https://testnet-rpc.boing.network'),
    // Provisional default until the official public mainnet RPC is published.
    'import.meta.env.VITE_BOING_MAINNET_RPC': JSON.stringify('https://rpc.boing.network'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
