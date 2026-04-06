import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, chromium } from '@playwright/test';
import { getChromeExtensionId } from './helpers/extension';
import { installBoingNetworkMocks } from './helpers/boingRouteMocks';
import { extensionE2EHeadless, getExtensionChromeArgs } from './helpers/e2eEnv';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const extensionPath = path.resolve(path.join(root, 'extension'));
const extensionPathArg = extensionPath.replace(/\\/g, '/');

const runPopupSuite = process.env.EXTENSION_E2E_FULL === '1';

const chromeExtensionArgs = getExtensionChromeArgs(extensionPathArg);

const E2E_PASSWORD = 'TestWallet99!';

async function launchExtensionContextWithMocks(userDataDir: string) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: extensionE2EHeadless(),
    args: chromeExtensionArgs,
  });
  await installBoingNetworkMocks(context);
  return context;
}

const describePopup = runPopupSuite ? test.describe : test.describe.skip;

describePopup('Extension popup (E2E)', () => {
  test('popup.html exposes wallet-* testids', async () => {
    test.setTimeout(90_000);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boing-e2e-popup-'));
    const context = await launchExtensionContextWithMocks(userDataDir);

    try {
      const boot = await context.newPage();
      await boot.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const extensionId = await getChromeExtensionId(context);
      await boot.close();

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      await expect(popup.getByTestId('wallet-landing-create')).toBeVisible({ timeout: 45_000 });
      await expect(popup.getByTestId('wallet-landing-import')).toBeVisible();
    } finally {
      await Promise.race([
        context.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Best-effort
      }
    }
  });

  test('full flow: two accounts in account switcher', async () => {
    test.setTimeout(180_000);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boing-e2e-multi-'));
    const context = await launchExtensionContextWithMocks(userDataDir);

    try {
      const boot = await context.newPage();
      await boot.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const extensionId = await getChromeExtensionId(context);
      await boot.close();

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      await expect(popup.getByTestId('wallet-landing-create')).toBeVisible({ timeout: 45_000 });

      await popup.getByTestId('wallet-landing-create').click();
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password"]').fill(E2E_PASSWORD);
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password-confirm"]').fill(E2E_PASSWORD);
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-submit"]').click();
      await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-ack"]').check();
      await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-continue"]').click();

      await expect(popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-header-lock"]')).toBeVisible({
        timeout: 45_000,
      });

      await popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-dashboard-add-account"]').click();
      await expect(popup.locator('#screen-add-pick:not(.hidden)')).toBeVisible({ timeout: 15_000 });
      await popup.locator('#screen-add-pick:not(.hidden) [data-testid="wallet-add-pick-create"]').click();
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password"]').fill(E2E_PASSWORD);
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password-confirm"]').fill(E2E_PASSWORD);
      await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-submit"]').click();
      await expect(popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-ack"]')).toBeVisible({
        timeout: 20_000,
      });
      await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-ack"]').check();
      await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-continue"]').click();

      await expect(popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-account-switch"] option')).toHaveCount(
        2,
        { timeout: 60_000 }
      );
    } finally {
      await Promise.race([
        context.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Best-effort
      }
    }
  });
});
