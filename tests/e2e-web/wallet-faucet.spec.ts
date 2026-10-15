import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
}

test.describe('testnet faucet + staking guidance (mocked RPC)', () => {
  test.use({ viewport: { width: 380, height: 760 } });

  test('success shows the amount, explorer link and next step', async ({ context, page }) => {
    await installBoingNetworkMocks(context, { faucet: 'ok' });
    await importWallet(page);
    await page.getByTestId('wallet-tab-faucet').click();
    await page.getByRole('button', { name: 'Request testnet BOING' }).click();
    const ok = page.getByTestId('faucet-success');
    await expect(ok).toContainText('10 testnet BOING requested');
    await expect(ok.getByRole('link', { name: 'View on Boing Observer' })).toHaveAttribute('href', /boing\.observer\/account\//);
    await expect(ok).toContainText('Transfer tab');
    const shot = process.env.FAUCET_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });
  });

  test('faucet cooldown gets a clear error', async ({ context, page }) => {
    await installBoingNetworkMocks(context, { faucet: 'cooldown' });
    await importWallet(page);
    await page.getByTestId('wallet-tab-faucet').click();
    await page.getByRole('button', { name: 'Request testnet BOING' }).click();
    await expect(page.getByText(/Faucet cooldown: try again in 42 seconds\. \(one request per address every 60 seconds\)/)).toBeVisible();
  });

  test('stake tab explains the 10,000 BOING validator minimum', async ({ context, page }) => {
    await installBoingNetworkMocks(context);
    await importWallet(page);
    await page.getByTestId('wallet-tab-stake').click();
    await expect(page.getByTestId('stake-min-hint')).toContainText('10,000 BOING');
  });
});
