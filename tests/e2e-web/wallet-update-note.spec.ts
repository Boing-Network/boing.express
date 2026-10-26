import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '22'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const KEY = 'boing_update_note_dismissed_version';
const NEWER = { client_hints: { min_wallet_version: '0.1.15', recommended_wallet_version: '9.9.9' } };

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
}

test.describe('update-available note is advisory and dismissible (mocked RPC)', () => {
  test.use({ viewport: { width: 380, height: 760 } });

  test('shows when the node recommends a newer wallet; Dismiss hides it for that version', async ({ context, page }) => {
    await installBoingNetworkMocks(context, { healthExtra: NEWER });
    await importWallet(page);
    const banner = page.getByTestId('node-compat-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('Boing Express 9.9.9 is available');
    // Advisory only: the wallet stays fully usable.
    await expect(page.getByTestId('wallet-header-settings')).toBeEnabled();
    await page.getByTestId('compat-dismiss-update').click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), KEY)).toBe('9.9.9');
  });

  test('no note when the wallet is already on the recommended version', async ({ context, page }) => {
    await installBoingNetworkMocks(context);
    await importWallet(page);
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible();
    await expect(page.getByTestId('node-compat-banner')).toHaveCount(0);
  });
});