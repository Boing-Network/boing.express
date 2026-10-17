import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';

/** dApp approval popup shows native amounts as BOING (18-decimal base units after the redenomination height). */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;

const TO = '0x' + '55'.repeat(32);
const NATIVE = { symbol: 'BOING', decimals: 18, base_unit_decimals: 18, base_units_from_height: 1050 };

describe('Extension dApp approval amounts (E2E, mocked RPC)', () => {
  test('20 BOING transfer shows "20 BOING", the base units and the fee', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    // Advertise the base-unit ledger only once the wallet is on its dashboard (the shared helper expects the
    // plain mocked balance text on the dashboard).
    let redenominated = false;
    const { context, close } = await openPopupWithNewWallet({
      submitted,
      rpc: (method) => {
        if (!redenominated) return undefined;
        if (method === 'boing_getNetworkInfo') return { head_height: 1100, chain_height: 1100, native_currency: NATIVE };
        if (method === 'boing_simulateTransaction') {
          return { success: true, gas_used: 21000, network_fee: '21000000000000000', network_fee_decimals: 18 };
        }
        return undefined;
      },
    });
    try {
      redenominated = true;
      const dapp = await context.newPage();
      await dapp.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await dapp.waitForFunction(() => !!(window as unknown as { boing?: unknown }).boing, null, { timeout: 30_000 });
      const accounts = await dapp.evaluate(() =>
        (window as unknown as { boing: { request: (a: unknown) => Promise<string[]> } }).boing.request({ method: 'boing_requestAccounts' })
      );
      expect(accounts).toHaveLength(1);
      const approvalP = context.waitForEvent('page', { timeout: 30_000 });
      const sendP = dapp.evaluate(
        ([to]) =>
          (window as unknown as { boing: { request: (x: unknown) => Promise<unknown> } }).boing.request({
            method: 'boing_sendTransaction',
            params: [{ type: 'transfer', to, amount: '20000000000000000000' }],
          }),
        [TO]
      );
      const approval = await approvalP;
      await approval.waitForLoadState('domcontentloaded');
      await expect(approval.locator('#approval-title')).toHaveText('Approve transaction');
      const body = approval.locator('#approval-tx-tbody');
      await expect(body).toContainText('20 BOING');
      await expect(body.locator('tr', { hasText: 'Amount (base units)' })).toContainText('20000000000000000000');
      await expect(body.locator('tr', { hasText: 'Network fee' })).toContainText('0.021 BOING');
      await expect(body).not.toContainText('smallest units');
      const shotDir = process.env.E2E_SHOT_DIR ?? path.join('test-results', 'shots');
      fs.mkdirSync(shotDir, { recursive: true });
      // The tx table scrolls inside the window; expand it so the screenshot shows every row (incl. the fee).
      await approval.addStyleTag({ content: '.tx-table-wrap{max-height:none !important;overflow:visible !important}' });
      await approval.screenshot({ path: path.join(shotDir, 'approval-20-boing.png'), fullPage: true });
      await approval.locator('#btn-approve').click();
      const res = await sendP;
      const hash = typeof res === 'string' ? res : (res as { tx_id?: string; tx_hash?: string }).tx_id ?? (res as { tx_hash?: string }).tx_hash;
      expect(String(hash)).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(submitted).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
