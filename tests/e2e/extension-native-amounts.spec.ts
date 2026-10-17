import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';

/** Native BOING surfaces in the popup use 18 decimals (base units) after the redenomination height. */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;
const shotDir = process.env.E2E_SHOT_DIR ?? path.join('test-results', 'shots');
const E18 = 10n ** 18n;

describe('Extension native amounts (E2E, mocked RPC)', () => {
  test('168e18 balance shows 168 BOING; faucet says 20 BOING; Max leaves the fee', async () => {
    test.setTimeout(150_000);
    fs.mkdirSync(shotDir, { recursive: true });
    const { popup, close } = await openPopupWithNewWallet(
      {
        submitted: [],
        account: () => ({ balance: (168n * E18).toString(), decimals: 18, nonce: '0', stake: '0' }),
        rpc: (method) =>
          method === 'boing_faucetRequest'
            ? // Raw ledger amount only (no amount_boing): the wallet must convert it itself.
              { ok: true, amount: (20n * E18).toString(), decimals: 18, tip_height: 1100, connected_peers: 1, message: 'ok' }
            : undefined,
      },
      { expectBalance: '168' }
    );
    try {
      const native = popup.getByTestId('token-row-native');
      await expect(native).toContainText('BOING');
      await expect(popup.locator('#balance')).toHaveText('168');
      const rowText = `${(await popup.locator('#balance').textContent())?.trim()} ${(await popup.locator('#symbol').textContent())?.trim()}`;
      expect(rowText).toBe('168 BOING');
      await expect(native).not.toContainText('000000000');
      await popup.screenshot({ path: path.join(shotDir, 'native-168-boing.png') });

      await popup.locator('#tab-transfer').click();
      await popup.locator('#btn-send-max').click();
      await expect(popup.locator('#send-amount')).toHaveValue('167.979');

      await popup.locator('#tab-faucet').click();
      await popup.getByRole('button', { name: /Request testnet BOING/i }).click();
      const ok = popup.locator('#faucet-success');
      await expect(ok).toContainText('20 BOING requested from the testnet faucet');
      await expect(ok).toContainText('network fee about 0.021 BOING');
      await expect(ok).not.toContainText('000000000');
      await popup.screenshot({ path: path.join(shotDir, 'faucet-20-boing.png') });
    } finally {
      await close();
    }
  });
});
