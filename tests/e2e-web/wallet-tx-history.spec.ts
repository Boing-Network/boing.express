import { expect, test } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = process.env.WALLET_URL ?? 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const FAUCET = '0x' + 'fa'.repeat(32);
const REGISTRY = '0x' + 'eb'.repeat(32);
const h = (b: string) => '0x' + b.repeat(32);

function rows(me: string) {
  return [
    { tx_id: h('03'), block_height: 145, tx_index: 0, timestamp: 1_760_000_300, sender: me, nonce: 2, direction: 'out',
      payload: { kind: 'batch', steps: [
        { kind: 'contract_call', contract: REGISTRY, calldata_len: 64 },
        { kind: 'contract_call', contract: REGISTRY, calldata_len: 64 },
        { kind: 'contract_call', contract: REGISTRY, calldata_len: 96 },
      ] }, success: true, error: null, gas_used: 30 },
    { tx_id: h('02'), block_height: 80, tx_index: 0, timestamp: 1_760_000_200, sender: me, nonce: 1, direction: 'out',
      payload: { kind: 'contract_call', contract: REGISTRY, calldata_len: 64 }, success: true, error: null, gas_used: 10 },
    { tx_id: h('01'), block_height: 60, tx_index: 0, timestamp: 1_760_000_100, sender: FAUCET, nonce: 0, direction: 'in',
      payload: { kind: 'transfer', to: me, amount: '1000' }, success: true, error: null, gas_used: 0 },
  ];
}

test.describe('tx tab loads on-chain history', () => {
  test.use({ viewport: { width: 380, height: 900 } });

  test('chain rows (faucet, dApp call, batch) with paging', async ({ context, page }) => {
    const seen: unknown[][] = [];
    await installBoingNetworkMocks(context, {
      accountTransactions: (params) => {
        seen.push(params);
        const me = String(params[0]);
        const all = rows(me);
        const cursor = (params[1] as { cursor?: string | null } | undefined)?.cursor ?? null;
        if (!cursor) return { account: me, head_height: 200, transactions: all.slice(0, 2), next_cursor: '80:0' };
        return { account: me, head_height: 200, transactions: all.slice(2), next_cursor: null };
      },
    });
    await page.goto(`${WALLET}/wallet`);
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('wallet-tab-transactions').click();
    const list = page.getByTestId('tx-history-row');
    await expect(list).toHaveCount(2);
    await expect(list.first()).toContainText('Batch');
    await list.first().getByTestId('tx-history-steps').locator('summary').click();
    await expect(list.first().getByTestId('tx-history-steps').locator('li')).toHaveCount(3);
    await expect(list.nth(1)).toContainText('Contract call');
    await page.getByTestId('tx-history-more').click();
    await expect(list).toHaveCount(3);
    await expect(list.nth(2)).toContainText('Receive BOING');
    await expect(list.nth(2)).toContainText('1,000 BOING from 0xfafa');
    await expect(page.getByTestId('tx-history-more')).toHaveCount(0);
    expect(seen.some((p) => (p[1] as { cursor?: string }).cursor === '80:0')).toBe(true);
  });
});

test.describe('tx tab shows failed txs as not transferred', () => {
  test.use({ viewport: { width: 380, height: 900 } });

  test('failed 1e30 transfer: Failed badge, nothing moved', async ({ context, page }) => {
    await installBoingNetworkMocks(context, {
      accountTransactions: (params) => {
        const me = String(params[0]);
        return {
          account: me, head_height: 930, next_cursor: null, transactions: [
            { tx_id: h('ee'), block_height: 925, tx_index: 0, timestamp: 1_760_000_400, sender: me, nonce: 7, direction: 'out',
              payload: { kind: 'transfer', to: h('42'), amount: '1' + '0'.repeat(30) }, success: false,
              error: 'Insufficient balance', gas_used: 21000 },
            { tx_id: h('01'), block_height: 60, tx_index: 0, timestamp: 1_760_000_100, sender: FAUCET, nonce: 0, direction: 'in',
              payload: { kind: 'transfer', to: me, amount: '40' }, success: true, error: null, gas_used: 21000 },
          ],
        };
      },
    });
    await page.goto(`${WALLET}/wallet`);
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wallet-tab-transactions').click();
    const list = page.getByTestId('tx-history-row');
    await expect(list).toHaveCount(2);
    const failed = list.first();
    await expect(failed).toHaveAttribute('data-status', 'failed');
    await expect(failed.getByTestId('tx-failed-badge')).toHaveText('Failed');
    await expect(failed).toContainText('Not transferred (failed)');
    await expect(failed).toContainText('only the fee was charged');
    const box = await failed.boundingBox();
    expect(box && box.width).toBeLessThanOrEqual(380);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/express-tx-tab-failed.png`, fullPage: true });
  });
});
