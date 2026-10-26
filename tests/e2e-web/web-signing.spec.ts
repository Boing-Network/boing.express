import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const DAPP = 'http://127.0.0.1:3333/web-dapp.html';
// Throwaway test key (never funded).
const TEST_KEY = '11'.repeat(32);
const PASSWORD = 'e2e-password-123';

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByTestId('wallet-import-method-key').check();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await page.waitForURL(/\/wallet/);
}

async function openPopup(dapp: Page, button: string): Promise<Page> {
  const [popup] = await Promise.all([dapp.waitForEvent('popup'), dapp.click(button)]);
  await popup.waitForLoadState();
  await expect(popup.getByTestId('web-sign')).toBeVisible();
  // Each popup is a fresh tab session, so the wallet asks for the password again.
  const pw = popup.getByTestId('web-sign-password');
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill(PASSWORD);
    await popup.getByTestId('web-sign-unlock').click();
  }
  return popup;
}

async function result(dapp: Page): Promise<{ ok?: unknown; error?: { code: number; data?: { boingCode?: string } } }> {
  await expect(dapp.locator('#out')).not.toBeEmpty();
  const r = JSON.parse((await dapp.locator('#out').textContent()) || '{}');
  await dapp.evaluate(() => (document.getElementById('out')!.textContent = ''));
  return r;
}

test('connect + sign from a dApp via boing.express popup', async ({ context }) => {
  // Hermetic: every RPC (and any other external request) is mocked, so the 20 BOING assertion never depends on the
  // live testnet. Only `boing_getNetworkInfo` needs a bespoke answer (native-unit rules).
  const blocked: string[] = [];
  await installBoingNetworkMocks(context, {
    blocked,
    rpc: (method) =>
      method === 'boing_getNetworkInfo'
        ? {
            chain_id: 6913,
            head_height: 5000,
            native_currency: { symbol: 'BOING', decimals: 18, base_unit_decimals: 18, base_units_from_height: 1050 },
          }
        : undefined,
  });  const walletPage = await context.newPage();
  await importWallet(walletPage);

  const dapp = await context.newPage();
  await dapp.goto(DAPP);

  // Sign before connecting: refused (connection is separate from signing).
  let popup = await openPopup(dapp, '#sign-msg');
  await expect(popup.getByTestId('web-sign-not-connected')).toBeVisible();
  await popup.getByRole('button', { name: 'Close' }).click();
  expect((await result(dapp)).error?.data?.boingCode).toBe('BOING_ORIGIN_NOT_CONNECTED');

  // Connect: origin shown, explicit approval.
  popup = await openPopup(dapp, '#connect');
  await expect(popup.getByTestId('web-sign-origin')).toContainText('http://127.0.0.1:3333');
  await popup.getByTestId('web-sign-approve').click();
  const connected = await result(dapp);
  expect(Array.isArray(connected.ok)).toBe(true);
  expect((connected.ok as string[])[0]).toMatch(/^0x[0-9a-f]{64}$/);

  // Reject path returns 4001.
  popup = await openPopup(dapp, '#sign-msg');
  await popup.getByTestId('web-sign-reject').click();
  expect((await result(dapp)).error?.code).toBe(4001);

  // Sign a transfer: decoded details visible, then signed hex returned.
  popup = await openPopup(dapp, '#sign-tx');
  await expect(popup.getByTestId('web-sign-tx')).toContainText(/transfer/i);
  await popup.getByTestId('web-sign-approve').click();
  const signed = await result(dapp);
  expect(signed.ok).toMatch(/^0x[0-9a-f]+$/);

  // Native amounts are shown as BOING (testnet ledger is in 18-decimal base units): 20 BOING, not 20e18.
  popup = await openPopup(dapp, '#sign-20');
  await expect(popup.getByTestId('web-sign-tx')).toContainText('Transfer 20 BOING');
  await expect(popup.getByTestId('web-sign-tx')).toContainText('20000000000000000000');
  if (process.env.E2E_SHOT_DIR) await popup.screenshot({ path: `${process.env.E2E_SHOT_DIR}/web-sign-20-boing.png`, fullPage: true });
  await popup.getByTestId('web-sign-reject').click();
  expect((await result(dapp)).error?.code).toBe(4001);

  // Reference-token self-transfer is refused by the existing guard.
  popup = await openPopup(dapp, '#sign-self');
  await expect(popup.getByTestId('web-sign-prep-error')).toContainText(/own address/i);
  await popup.getByTestId('web-sign-close').click();
  expect((await result(dapp)).error?.data?.boingCode).toBe('BOING_INVALID_TX');
  // Nothing left localhost without a mock.
  expect(blocked).toEqual([]);
});

test('/connect refuses to render when framed and without an opener', async ({ page }) => {
  await page.goto(`${WALLET}/connect?mode=popup`);
  await expect(page.getByTestId('web-sign-fatal')).toBeVisible();
  await page.goto(DAPP);
  await page.evaluate((u) => {
    const f = document.createElement('iframe');
    f.src = u;
    f.id = 'f';
    document.body.appendChild(f);
  }, `${WALLET}/connect?mode=popup`);
  const frame = page.frameLocator('#f');
  await expect(frame.getByText(/can't be shown inside another page/i)).toBeVisible();
});
