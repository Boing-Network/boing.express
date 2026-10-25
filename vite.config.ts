import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const walletVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '';

export default defineConfig({
  plugins: [react()],
  define: { __WALLET_VERSION__: JSON.stringify(walletVersion) },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
