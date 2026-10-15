import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { getChromeExtensionId } from './extension';
import { installBoingNetworkMocks, type BoingMockOptions } from './boingRouteMocks';
import { extensionE2EHeadless, getExtensionChromeArgs } from './e2eEnv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extensionPathArg = path.resolve(path.join(root, 'extension')).replace(/\\/g, '/');
export const E2E_PASSWORD = 'TestWallet99!';

/** Launch the unpacked extension with mocked RPC, create a wallet, and land on the dashboard. */
export async function openPopupWithNewWallet(
  mock: BoingMockOptions = {}
): Promise<{ context: BrowserContext; popup: Page; close: () => Promise<void> }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boing-e2e-redesign-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: extensionE2EHeadless(),
    args: getExtensionChromeArgs(extensionPathArg),
  });
  await installBoingNetworkMocks(context, mock);
  const boot = await context.newPage();
  await boot.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const extensionId = await getChromeExtensionId(context);
  await boot.close();
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(popup.getByTestId('wallet-landing-create')).toBeVisible({ timeout: 45_000 });
  await popup.getByTestId('wallet-landing-create').click();
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password"]').fill(E2E_PASSWORD);
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password-confirm"]').fill(E2E_PASSWORD);
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-submit"]').click();
  await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-ack"]').check();
  await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-continue"]').click();
  await expect(popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-header-lock"]')).toBeVisible({ timeout: 45_000 });
  await expect(popup.locator('#balance')).toHaveText('1000000', { timeout: 30_000 });
  const close = async () => {
    await Promise.race([context.close(), new Promise<void>((r) => setTimeout(r, 12_000))]);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  return { context, popup, close };
}

/** Nonce of a signed Boing tx hex (bincode: u64 LE nonce first). */
export function nonceOfSignedHex(hex: string): number {
  const h = hex.replace(/^0x/i, '');
  let n = 0;
  for (let i = 7; i >= 0; i--) n = n * 256 + parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return n;
}
