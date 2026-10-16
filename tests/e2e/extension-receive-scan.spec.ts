import { test, expect } from '@playwright/test';
import path from 'path';
import qrcode from 'qrcode-generator';
import { openPopupWithNewWallet } from './helpers/popup';

const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;
const SHOTS = process.env.SEND_RECEIVE_SHOTS;
const A = '0x' + '44'.repeat(32);

describe('Extension popup receive + scan (E2E, mocked RPC)', () => {
  test('native row, receive QR, scan tab fills send-to', async () => {
    const { context, popup, close } = await openPopupWithNewWallet({});
    try {
      await expect(popup.getByTestId('token-row-native')).toBeVisible();
      if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'after-12-popup-wallet.png'), fullPage: true });
      const me = ((await popup.locator('#address').textContent()) ?? '').trim();
      await popup.getByTestId('wallet-receive').click();
      await expect(popup.getByTestId('receive-panel')).toBeVisible();
      await expect(popup.getByTestId('receive-qr')).toHaveAttribute('data-value', '0x' + me.toLowerCase().replace(/^0x/, ''));
      if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'after-12-popup-receive.png'), fullPage: true });
      await popup.getByTestId('receive-back').click();

      const scan = await context.newPage();
      await scan.goto(popup.url().replace(/[^/]*$/, 'scan.html?field=send-to'));
      const qr = qrcode(0, 'M');
      qr.addData(A);
      qr.make();
      const gif = Buffer.from(qr.createDataURL(8, 4).split(',')[1], 'base64');
      await scan.getByTestId('qr-scan-upload').setInputFiles({ name: 'qr.gif', mimeType: 'image/gif', buffer: gif });
      await expect(scan.getByTestId('qr-scan-done')).toBeVisible({ timeout: 15_000 });

      await popup.reload();
      const pw = popup.getByTestId('wallet-unlock-password');
      await expect(pw.or(popup.getByTestId('send-to'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
      if (await pw.isVisible()) {
        await pw.fill('TestWallet99!');
        await popup.getByTestId('wallet-unlock-submit').click();
      }
      await popup.getByTestId('wallet-tab-transfer').click();
      await expect(popup.getByTestId('send-to')).toHaveValue(A, { timeout: 15_000 });
    } finally {
      await close();
    }
  });
});