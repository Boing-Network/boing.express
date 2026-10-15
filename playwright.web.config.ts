import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/** E2E for the web signing flow (/connect): built wallet preview on :4174 + static test dApp on :3333. */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(root, 'tests/e2e-web'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    viewport: { width: 1280, height: 800 },
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: [
    {
      command: 'pnpm exec vite preview --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node tests/e2e/serve.mjs',
      url: 'http://127.0.0.1:3333/',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
