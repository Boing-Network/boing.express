import { expect, test, type Page } from '@playwright/test';
import qrcode from 'qrcode-generator';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const A = '22'.repeat(32);
const TBOING = '6fce9d3e3f13df9fc17e3fd947148a4e6ce6966538b7dd9bf2a891d3b9699c6b';
const SHOTS = process.env.SEND_RECEIVE_SHOTS; // directory for after-12-*.png

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-12-${name}.png`, fullPage: true });
}

/** GIF of a QR code for `text` (qrcode-generator's own data URL), for the upload fallback. */
export function qrGif(text: string): Buffer {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return Buffer.from(qr.createDataURL(8, 4).split(',')[1]!, 'base64');
}

async function importWallet(page: Page) {
  await page.getByTestId('wallet-landing-import').click();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
}

test.describe('welcome, send review, receive, scan (mocked RPC)', () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test('welcome screen, native BOING first, tBOING label, header copy, add account in Settings', async ({ context, page }) => {
    await installBoingNetworkMocks(context, { storage: (contract) => (contract.replace(/^0x/, '') === TBOING ? (40).toString(16) : null) });
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(page.getByRole('heading', { name: 'Welcome to Boing Express' })).toBeVisible();
    await expect(page.getByText('Your non-custodial wallet for Boing Network')).toBeVisible();
    await expect(page.getByTestId('wallet-landing-create')).toHaveText('Create New Wallet');
    await expect(page.getByTestId('wallet-landing-import')).toHaveText('Import Existing Wallet');
    await expect(page.getByTestId('wallet-keys-note')).toHaveText(/Your keys never leave your device/);
    await shot(page, 'welcome');
    await importWallet(page);

    const native = page.getByTestId('token-row-native');
    await expect(native).toContainText('BOING');
    await expect(page.getByTestId('native-balance')).toHaveText('1000000', { timeout: 30_000 });
    const rows = page.getByTestId('token-row');
    await expect(rows.filter({ hasText: 'tBOING' })).toContainText('40');
    // A contract token never shows as plain "BOING".
    for (const t of await rows.locator('span').first().allTextContents()) expect(t.trim()).not.toBe('BOING');
    await expect(page.getByText('Balance', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('wallet-header-copy')).toBeVisible();
    await expect(page.getByTestId('wallet-dashboard-add-account')).toBeHidden();
    await shot(page, 'wallet');
    await page.getByTestId('wallet-header-settings').click();
    await expect(page.getByTestId('settings-accounts').getByTestId('wallet-dashboard-add-account')).toBeVisible();
  });

  test('send review shows recipient, amount, simulated fee; back edits; confirm sends', async ({ context, page }) => {
    const submitted: string[] = [];
    await installBoingNetworkMocks(context, { submitted, simulateGasUsed: 42_000 });
    await page.goto(`${WALLET}/wallet`);
    await importWallet(page);
    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('send-to').fill(A);
    await page.getByTestId('send-amount').fill('12');
    await page.getByTestId('send-submit').click();
    const card = page.getByTestId('send-confirm');
    await expect(card.getByRole('heading', { name: 'Send BOING' })).toBeVisible();
    await expect(page.getByTestId('send-confirm-to')).toHaveText('0x22222222…222222');
    await expect(page.getByTestId('send-confirm-amount')).toHaveText('12 BOING');
    await expect(page.getByTestId('send-confirm-fee')).toHaveText('2 BOING');
    await expect(page.getByTestId('send-confirm-fee')).toHaveAttribute('data-exact', 'true');
    await shot(page, 'send-confirm');
    await page.getByTestId('send-confirm-back').click();
    await expect(page.getByTestId('send-amount')).toHaveValue('12');
    expect(submitted).toHaveLength(0);
    await page.getByTestId('send-submit').click();
    await page.getByTestId('send-confirm-submit').click();
    await expect(page.getByTestId('send-success')).toContainText('Sent', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
  });

  test('receive QR encodes the address; scan QR (image upload) fills the recipient', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WALLET });
    await installBoingNetworkMocks(context);
    await page.goto(`${WALLET}/wallet`);
    await importWallet(page);
    await page.getByTestId('wallet-receive').click();
    const qr = page.getByTestId('receive-qr');
    await expect(qr).toBeVisible();
    const addr = (await qr.getAttribute('data-value')) ?? '';
    expect(addr).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(page.getByTestId('receive-address')).toHaveText(`${addr.slice(0, 10)}…${addr.slice(-6)}`);
    await expect(page.getByText('Share this address to receive BOING tokens')).toBeVisible();
    await page.getByTestId('receive-copy').click();
    await expect(page.getByTestId('receive-copy')).toHaveText('Copied');
    await shot(page, 'receive');
    await page.getByTestId('receive-back').click();

    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('send-to-scan').click();
    await expect(page.getByTestId('qr-scanner')).toBeVisible();
    await page.getByTestId('qr-scan-upload').setInputFiles({ name: 'qr.gif', mimeType: 'image/gif', buffer: qrGif(`boing:0x${A}?amount=3`) });
    await expect(page.getByTestId('qr-scanner')).toHaveCount(0);
    await expect(page.getByTestId('send-to')).toHaveValue(`0x${A}`);
    // Not an address: clear error, scanner stays open.
    await page.getByTestId('send-to-scan').click();
    await page.getByTestId('qr-scan-upload').setInputFiles({ name: 'qr.gif', mimeType: 'image/gif', buffer: qrGif('hello world') });
    await expect(page.getByTestId('qr-scan-error')).toContainText('does not contain a Boing address');
  });
});
