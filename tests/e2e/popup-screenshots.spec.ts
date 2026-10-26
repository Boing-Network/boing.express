import { skipClaimNameIfShown, confirmBackupInPopup } from './helpers/popup';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, chromium } from '@playwright/test';
import { getChromeExtensionId } from './helpers/extension';
import { installBoingNetworkMocks } from './helpers/boingRouteMocks';
import { extensionE2EHeadless, getExtensionChromeArgs } from './helpers/e2eEnv';

/**
 * Not a test: captures popup screenshots at the toolbar width (380px) for design review.
 * Run with EXTENSION_E2E=1 POPUP_SCREENSHOTS_DIR=<dir> POPUP_SCREENSHOTS_PREFIX=before|after.
 */
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
/** POPUP_SCREENSHOTS_EXTENSION_DIR lets you shoot an older unpacked build (e.g. `git archive HEAD extension`). */
const extensionPathArg = path
  .resolve(process.env.POPUP_SCREENSHOTS_EXTENSION_DIR || path.join(root, 'extension'))
  .replace(/\\/g, '/');
const outDir = process.env.POPUP_SCREENSHOTS_DIR ?? '';
const prefix = process.env.POPUP_SCREENSHOTS_PREFIX ?? 'shot';
const PASSWORD = 'TestWallet99!';

(outDir ? test : test.skip)('capture popup screenshots', async () => {
  test.setTimeout(180_000);
  fs.mkdirSync(outDir, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boing-e2e-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: extensionE2EHeadless(),
    args: getExtensionChromeArgs(extensionPathArg),
  });
  await installBoingNetworkMocks(context);
  try {
    const boot = await context.newPage();
    await boot.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
    const extensionId = await getChromeExtensionId(context);
    await boot.close();
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popup.getByTestId('wallet-landing-create').click();
    await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password"]').fill(PASSWORD);
    await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password-confirm"]').fill(PASSWORD);
    await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-method-key"]').check();
    await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-submit"]').click();
    await confirmBackupInPopup(popup);
    await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-continue"]').click();
    await skipClaimNameIfShown(popup);
    await expect(popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-header-lock"]')).toBeVisible({ timeout: 45_000 });
    await popup.waitForTimeout(1500);
    const tabs = popup.locator('.tab-bar .tab-btn');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const t = tabs.nth(i);
      if (!(await t.isVisible())) continue;
      const name = ((await t.getAttribute('data-tab')) ?? `tab${i}`).trim();
      await t.click();
      await popup.waitForTimeout(400);
      await popup.screenshot({ path: path.join(outDir, `${prefix}-${String(i + 1).padStart(2, '0')}-${name}.png`), fullPage: true });
    }
    const gear = popup.getByTestId('wallet-header-settings');
    if (await gear.count()) {
      await gear.click();
      await popup.waitForTimeout(400);
      await popup.screenshot({ path: path.join(outDir, `${prefix}-90-settings.png`), fullPage: true });
    }
  } finally {
    await Promise.race([context.close(), new Promise<void>((r) => setTimeout(r, 12_000))]);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
