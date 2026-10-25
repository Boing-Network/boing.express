import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The wallet's release version is the extension manifest version (package.json stays 0.1.0 and is not the release number).
const walletVersion = (JSON.parse(readFileSync(new URL('./extension/manifest.base.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '';

export default defineConfig({
  plugins: [react()],
  define: { __WALLET_VERSION__: JSON.stringify(walletVersion) },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
