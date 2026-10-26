import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByTestId('wallet-import-method-key').check();
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
    await expect(ok).toContainText('10 BOING requested from the testnet faucet');
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

  test('one Validate tab: validator path first, bond stake secondary, no 10k minimum claim', async ({ context, page }) => {
    await installBoingNetworkMocks(context, {
      validators: () => ({
        mode: 'open', height: 352, quorum: 1, validator_count: 1,
        open: {
          activation_height: 300, activated_at: 300, bond: '100', deregister_delay: 100, epoch_len: 100,
          next_epoch_height: 400, max_open_validators: 20, liveness_window: 1000, miss_threshold_bps: 1000,
          min_liveness_samples: 10, jail_cooldown: 500, anchors: [],
        },
        validators: [],
      }),
    });
    await importWallet(page);
    await expect(page.getByTestId('wallet-tab-stake')).toHaveCount(0);
    await expect(page.getByTestId('wallet-tab-validator')).toHaveCount(0);
    await page.getByTestId('wallet-tab-validate').click();
    const steps = page.getByTestId('validator-steps');
    await expect(steps).toContainText('100 BOING bond');
    await expect(steps).toContainText('uptime above 90%');
    await expect(page.getByTestId('validator-register-form')).toBeVisible();
    const hint = page.getByTestId('stake-min-hint');
    await expect(hint).toContainText('Not needed to validate today');
    await expect(hint).toContainText('future stake-based');
    // Validator section is above the secondary bond section.
    const vy = (await page.getByTestId('validator-panel').boundingBox())!.y;
    const sy = (await page.getByTestId('stake-secondary').boundingBox())!.y;
    expect(vy).toBeLessThan(sy);
    await expect(page.locator('#panel-validate')).not.toContainText('needs at least 10,000');
    const shot = process.env.VALIDATE_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });
  });
});
