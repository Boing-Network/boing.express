import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { getChromeExtensionId } from './extension';
import { installBoingNetworkMocks, type BoingMockOptions } from './boingRouteMocks';
import { extensionE2EHeadless, getExtensionChromeArgs } from './e2eEnv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** E2E_EXTENSION_DIR=extension-unpacked runs against the folder users actually load / the store zip contents. */
const extensionPathArg = path
  .resolve(root, process.env.E2E_EXTENSION_DIR || 'extension')
  .replace(/\\/g, '/');
export const E2E_PASSWORD = 'TestWallet99!';

/** After backup: skip the optional pick-a-name step if it is shown (it is not when adding an account). */
export async function skipClaimNameIfShown(popup: Page): Promise<void> {
  const skip = popup.locator('#screen-claim-name:not(.hidden) [data-testid="wallet-claim-name-skip"]');
  const dash = popup.locator('#screen-dashboard:not(.hidden)');
  await expect(skip.or(dash).first()).toBeVisible({ timeout: 45_000 });
  if (await skip.isVisible()) await skip.click();
}

/** Launch the unpacked extension with mocked RPC and open the popup on the first-run screen (no wallet yet). */
export async function openFreshPopup(
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

/**
 * Launch the unpacked extension with mocked RPC, create a wallet, and land on the dashboard.
 * Default is the classic private-key backup (what most existing specs exercise); `phrase: true` takes the
 * recommended recovery-phrase path and returns the 24 words.
 */
export async function openPopupWithNewWallet(
  mock: BoingMockOptions = {},
  opts: { beforeClaimName?: (popup: Page) => Promise<void>; expectBalance?: string; phrase?: boolean } = {}
): Promise<{ context: BrowserContext; popup: Page; close: () => Promise<void>; phrase: string[] }> {
  const { context, popup, close } = await openFreshPopup(mock);
  await popup.getByTestId('wallet-landing-create').click();
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password"]').fill(E2E_PASSWORD);
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-password-confirm"]').fill(E2E_PASSWORD);
  if (!opts.phrase) await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-method-key"]').check();
  await popup.locator('#screen-create:not(.hidden) [data-testid="wallet-create-submit"]').click();
  let phrase: string[] = [];
  if (opts.phrase) phrase = await confirmPhraseBackupInPopup(popup);
  else await confirmBackupInPopup(popup);
  await popup.locator('#screen-backup:not(.hidden) [data-testid="wallet-backup-continue"]').click();
  if (opts.beforeClaimName) await opts.beforeClaimName(popup);
  else await skipClaimNameIfShown(popup);
  await expect(popup.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-header-lock"]')).toBeVisible({ timeout: 45_000 });
  await expect(popup.locator('#balance')).toHaveText(opts.expectBalance ?? '1000000', { timeout: 30_000 });
  return { context, popup, close, phrase };
}

/** Nonce of a signed Boing tx hex (bincode: u64 LE nonce first). */
export function nonceOfSignedHex(hex: string): number {
  const h = hex.replace(/^0x/i, '');
  let n = 0;
  for (let i = 7; i >= 0; i--) n = n * 256 + parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return n;
}

/**
 * Connect a dApp page the way a user does: `boing_requestAccounts` opens a "Connect to this site?" approval
 * window; click Connect and return the accounts the dApp receives.
 */
export async function connectDapp(context: BrowserContext, dapp: Page): Promise<string[]> {
  const approvalP = context.waitForEvent('page', { timeout: 30_000 });
  const accountsP = dapp.evaluate(() =>
    (window as unknown as { boing: { request: (a: unknown) => Promise<string[]> } }).boing.request({ method: 'boing_requestAccounts' })
  );
  const approval = await approvalP;
  await approval.waitForLoadState('domcontentloaded');
  await expect(approval.locator('#approval-title')).toHaveText('Connect to this site?');
  await approval.locator('#btn-approve').click();
  return accountsP;
}

/** Backup screen: type the last 6 characters of the shown key (the confirmation step), then tick the acknowledgement. */
export async function confirmBackupInPopup(popup: Page): Promise<void> {
  const scope = popup.locator('#screen-backup:not(.hidden)');
  const key = ((await scope.locator('#backup-key').textContent()) ?? '').trim();
  await scope.locator('[data-testid="wallet-backup-confirm"]').fill(key.slice(-6));
  await scope.locator('[data-testid="wallet-backup-ack"]').check();
}

/** Phrase backup screen: read the 24 words, answer the 3 "which word is #N" checks, tick the acknowledgement. Returns the words. */
export async function confirmPhraseBackupInPopup(popup: Page): Promise<string[]> {
  const scope = popup.locator('#screen-backup:not(.hidden)');
  await expect(scope.locator('[data-testid="wallet-phrase-words"] li').nth(23)).toBeVisible({ timeout: 45_000 });
  const raw = await scope.locator('[data-testid="wallet-phrase-words"] li').allTextContents();
  const words = raw.map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());
  for (let i = 0; i < 3; i++) {
    const ph = (await scope.locator(`[data-testid="wallet-phrase-confirm-${i}"]`).getAttribute('placeholder')) ?? '';
    const pos = Number(ph.replace(/\D/g, ''));
    await scope.locator(`[data-testid="wallet-phrase-confirm-${i}"]`).fill(words[pos - 1] ?? '');
  }
  await scope.locator('[data-testid="wallet-backup-ack"]').check();
  return words;
}
