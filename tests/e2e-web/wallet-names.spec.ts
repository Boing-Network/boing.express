import { expect, test, type Page } from '@playwright/test';
import { ALICE, decode, nameMocks } from '../e2e/helpers/nameMocks';

const WALLET = 'http://127.0.0.1:4174';
const PASSWORD = 'e2e-password-123';
const TEST_KEY = '11'.repeat(32);
const SHOTS = process.env.NAMES_SHOTS; // directory for after-14-*.png

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-14-${name}.png`, fullPage: true });
}

test.describe('.boing names (mocked RPC)', () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test('create wallet → pick a name → claimed after funding (commit, register, primary)', async ({ context, page }) => {
    const submitted: string[] = [];
    const me = { hex: '' };
    await nameMocks(context, submitted, me);
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-create').click();
    await page.getByTestId('wallet-create-password').fill(PASSWORD);
    await page.getByTestId('wallet-create-password-confirm').fill(PASSWORD);
    await page.getByTestId('wallet-create-submit').click();
    const backupKey = ((await page.getByTestId('wallet-backup-key').textContent()) ?? '').trim();
    await page.getByTestId('wallet-backup-confirm').fill(backupKey.slice(-6));
    await page.getByTestId('wallet-backup-ack').check();
    await page.getByTestId('wallet-backup-continue').click();
    await expect(page.getByTestId('wallet-claim-name')).toBeVisible();
    await page.getByTestId('wallet-claim-name-input').fill('alice');
    await expect(page.getByTestId('wallet-claim-name-status')).toHaveText('alice.boing is taken');
    await page.getByTestId('wallet-claim-name-input').fill('Nico-Test');
    await expect(page.getByTestId('wallet-claim-name-status')).toContainText('nico-test.boing is available: 1 BOING / year');
    await shot(page, 'create-claim-name');
    // Address is known once the dashboard opens; the mock binds names to it.
    page.on('request', (r) => {
      if (r.method() === 'POST' && !me.hex) {
        const body = r.postData() ?? '';
        const m = body.match(/"boing_getAccount","params":\["(?:0x)?([0-9a-f]{64})"/);
        if (m) me.hex = m[1]!;
      }
    });
    await page.getByTestId('wallet-claim-name-reserve').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wallet-primary-name')).toHaveText('nico-test.boing', { timeout: 30_000 });
    await expect(page.getByTestId('pending-name')).toHaveCount(0);
    expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
    expect(decode(submitted[1]!).name).toBe('nico-test');
    await shot(page, 'wallet-primary-name');
  });

  test('send to a name shows the resolved address on review and re-resolves on confirm', async ({ context, page }) => {
    const submitted: string[] = [];
    await nameMocks(context, submitted, { hex: '' });
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('send-to').fill('bob.boing');
    await page.getByTestId('send-amount').fill('5');
    await page.getByTestId('send-submit').click();
    await expect(page.getByTestId('send-error')).toHaveText('bob.boing is not registered (or has expired)');
    await page.getByTestId('send-to').fill('Alice.boing');
    await page.getByTestId('send-submit').click();
    await expect(page.getByTestId('send-confirm-to-name')).toHaveText('alice.boing');
    await expect(page.getByTestId('send-confirm-to')).toHaveText(`0x${ALICE.slice(0, 10)}…${ALICE.slice(-8)}`);
    await expect(page.getByTestId('send-confirm-to')).toHaveAttribute('title', `0x${ALICE}`);
    await shot(page, 'send-to-name-review');
    await page.getByTestId('send-confirm-submit').click();
    await expect(page.getByTestId('send-success')).toContainText('Sent', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
    // Transfer payload (variant 0) to alice's resolved address.
    expect(submitted[0]!.replace(/^0x/, '').slice(80, 88)).toBe('00000000');
    expect(submitted[0]!).toContain(ALICE);
  });

  test('Settings → Names lists owned names and manages them', async ({ context, page }) => {
    const submitted: string[] = [];
    const me = { hex: '' };
    await nameMocks(context, submitted, me);
    page.on('request', (r) => {
      const m = (r.postData() ?? '').match(/"boing_getAccount","params":\["(?:0x)?([0-9a-f]{64})"/);
      if (m && !me.hex) me.hex = m[1]!;
    });
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wallet-header-settings').click();
    const panel = page.getByTestId('settings-names');
    await expect(panel.getByTestId('names-empty')).toBeVisible();
    await panel.getByTestId('names-query').fill('boingfan');
    await expect(panel.getByTestId('names-availability')).toContainText('boingfan.boing is available: 1 BOING for 1 year');
    await panel.getByTestId('names-claim').click();
    await expect(panel.getByTestId('names-ok')).toContainText('boingfan.boing is yours', { timeout: 30_000 });
    await expect(panel.getByTestId('names-row')).toHaveCount(1);
    await expect(panel.getByTestId('names-row')).toContainText('primary');
    expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
    await panel.scrollIntoViewIfNeeded();
    await shot(page, 'settings-names');
  });
});