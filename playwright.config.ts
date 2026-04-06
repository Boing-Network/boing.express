import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyRootDotenv } from './tests/e2e/helpers/e2eEnv';

const root = path.dirname(fileURLToPath(import.meta.url));
applyRootDotenv(root);

export default defineConfig({
  testDir: path.join(root, 'tests/e2e'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  /** Full extension flows (multi-account) need headroom beyond single-popup smoke. */
  timeout: 180_000,
  use: {
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: 'http://127.0.0.1:3333/',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
