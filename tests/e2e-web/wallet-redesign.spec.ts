import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';
import { nonceOfSignedHex } from '../e2e/helpers/popup';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const A = '22'.repeat(32);
const B = '33'.repeat(32);
const C = '44'.repeat(32);

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('assets-composition')).toContainText('1000000', { timeout: 30_000 });
}

test.describe('web wallet redesign (mocked RPC)', () => {
  test.use({ viewport: { width: 380, height: 760 } });

  test('settings gear: connected sites + export key moved there', async ({ context, page }) => {
    await installBoingNetworkMocks(context);
    await importWallet(page);
    await expect(page.getByTestId('wallet-tab-transactions')).toHaveText('Tx');
    await expect(page.getByTestId('wallet-tab-transfer')).toHaveText('Transfer');
    await expect(page.getByTestId('wallet-tokens')).toBeVisible();
    await expect(page.getByTestId('reveal-private-key')).toHaveCount(0);

    await page.evaluate(() =>
      localStorage.setItem(
        'boing_web_connected_sites',
        JSON.stringify({ 'https://boing.finance': { account: '0x' + '11'.repeat(32), chainId: '0x1b01', connectedAt: 1 } })
      )
    );
    await page.getByTestId('wallet-header-settings').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('connected-site-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Disconnect https://boing.finance' }).click();
    await expect(page.getByTestId('connected-sites-empty')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('boing_web_connected_sites'))).toBe('{}');

    const card = page.getByTestId('reveal-private-key');
    await card.locator('summary').click();
    await card.getByLabel('Wallet password').fill('wrong-password-1');
    await card.getByRole('button', { name: 'Reveal' }).click();
    await expect(card).toContainText(/Incorrect password/);
    await card.getByLabel('Wallet password').fill(PASSWORD);
    await card.getByRole('button', { name: 'Reveal' }).click();
    const key = card.getByLabel('Private key');
    await expect(key).toHaveText('•'.repeat(64));
    await card.getByRole('button', { name: 'Show' }).click();
    await expect(key).toHaveText(new RegExp(TEST_KEY, 'i'));
    // Leaving Settings unmounts the panel and clears the key.
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('settings-panel')).toBeHidden();
    await page.getByTestId('wallet-header-settings').click();
    await expect(page.getByTestId('reveal-private-key').getByLabel('Private key')).toHaveCount(0);
  });

  test('transfer BOING + bulk validation + sequential nonces + stop on failure', async ({ context, page }) => {
    const submitted: string[] = [];
    await installBoingNetworkMocks(context, { submitted, failSubmitAt: 5 });
    await importWallet(page);
    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('send-to').fill(A);
    await page.getByTestId('send-amount').fill('7');
    await page.getByTestId('send-submit').click();
    await expect(page.getByTestId('send-success')).toContainText('Sent', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
    await page.getByTestId('wallet-tab-transactions').click();
    await expect(page.getByTestId('tx-history-row').first()).toContainText('7 BOING');

    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('transfer-mode-bulk').click();
    await page.locator('summary', { hasText: 'Paste CSV' }).click();
    const me = ((await page.getByTestId('assets-composition').locator('code').first().textContent()) ?? '').trim();
    expect(me).toMatch(/^(0x)?[0-9a-f]{64}$/i);
    await page.getByTestId('bulk-csv').fill(`zz,1\n${me},1\n${A},1\n${A},1\n${B},1.5`);
    await page.getByTestId('bulk-csv-import').click();
    await page.getByTestId('bulk-review').click();
    const issues = page.getByTestId('bulk-issues');
    await expect(issues).toContainText('64 hex');
    await expect(issues).toContainText('own address');
    await expect(issues).toContainText('duplicate recipient');
    await expect(issues).toContainText('whole units');
    expect(submitted).toHaveLength(1);

    // Mock nonce stays 0, so the run uses 0,1,2,3. Submit #5 overall (row 4 of the batch) fails.
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByTestId('bulk-csv').fill(`${A},1\n${B},2\n${C},3\n${'55'.repeat(32)},4`);
    await page.getByTestId('bulk-csv-import').click();
    await page.getByTestId('bulk-review').click();
    await expect(page.getByTestId('bulk-review-row')).toHaveCount(4);
    await expect(page.getByTestId('bulk-review-total')).toHaveText('10 BOING');
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-progress-summary')).toHaveText(/Stopped at row 4: 3 of 4 submitted/, { timeout: 60_000 });
    const rows = page.getByTestId('bulk-progress-row');
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'submitted');
    await expect(rows.nth(2)).toHaveAttribute('data-status', 'submitted');
    await expect(rows.nth(3)).toHaveAttribute('data-status', 'failed');
    expect(submitted.slice(1).map(nonceOfSignedHex)).toEqual([0, 1, 2, 3]);
    await page.getByTestId('wallet-tab-transactions').click();
    await expect(page.getByTestId('tx-history-row')).toHaveCount(4);
  });
});
