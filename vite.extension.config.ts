import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { DEFAULT_TESTNET_RPC, resolveMainnetRpcUrl, resolveTestnetRpcUrl } from './src/networks/rpcConfig';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const testnetRpc = resolveTestnetRpcUrl(env.VITE_BOING_TESTNET_RPC || DEFAULT_TESTNET_RPC);
  const mainnetRpc = resolveMainnetRpcUrl(env.VITE_BOING_MAINNET_RPC);

  return {
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
      'import.meta.env.VITE_BOING_TESTNET_RPC': JSON.stringify(testnetRpc),
      'import.meta.env.VITE_BOING_MAINNET_RPC': JSON.stringify(mainnetRpc),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  };
});
