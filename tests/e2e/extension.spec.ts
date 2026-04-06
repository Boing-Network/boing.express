import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, chromium } from '@playwright/test';
import { installBoingNetworkMocks } from './helpers/boingRouteMocks';
import { extensionE2EHeadless, getExtensionChromeArgs } from './helpers/e2eEnv';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const extensionPath = path.resolve(path.join(root, 'extension'));
/** Chrome/Chromium on Windows expects forward slashes in --load-extension. */
const extensionPathArg = extensionPath.replace(/\\/g, '/');
const extensionProfileDir = path.join(root, '.playwright-extension-profile');

const runExtensionE2E = process.env.EXTENSION_E2E === '1';

test.describe('Boing extension (window.boing)', () => {
  test.skip(!runExtensionE2E, 'Set EXTENSION_E2E=1 and run after pnpm run build:extension');

  test('injects provider: boing_chainId + multi-account listener API', async () => {
    const context = await chromium.launchPersistentContext(extensionProfileDir, {
      headless: extensionE2EHeadless(),
      args: getExtensionChromeArgs(extensionPathArg),
    });
    await installBoingNetworkMocks(context);
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const w = window as Window & { __E2E_RESULT__?: unknown };
        return w.__E2E_RESULT__ != null;
      }, null, { timeout: 90_000 });
      const result = await page.evaluate(() => {
        return (window as unknown as { __E2E_RESULT__: Record<string, unknown> }).__E2E_RESULT__;
      });

      expect(result.hasBoing).toBe(true);
      expect(result.isBoing).toBe(true);
      expect(result.supportsBoingNativeRpc).toBe(true);
      expect(result.hasRequest).toBe(true);
      expect(result.hasOn).toBe(true);
      expect(result.hasRemoveListener).toBe(true);
      expect(result.chainErr).toBeNull();
      expect(typeof result.chainId).toBe('string');
      expect(result.chainId === '0x1b01' || result.chainId === '0x1b02').toBe(true);
    } finally {
      await context.close();
    }
  });
});
