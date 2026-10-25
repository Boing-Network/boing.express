import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet, connectDapp } from './helpers/popup';

/**
 * dApp approval for a native BOING swap batch (boing.finance auto-wrap): the first step sends 1 BOING to wBOING as
 * call value; the approval must show "BOING sent to contracts: 1 BOING" and the step line "sending 1 BOING".
 */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;

const WBOING = '0x35555ffee114ba1698dcb6cd5f6d0ce56bf264dc6f386991c00cab22020d9c55';
const POOL = '0x23e9b02c3ee1600197e1a3d1c08feaa758b967f7ff1513f62991257a3b970069';
const NATIVE = { symbol: 'BOING', decimals: 18, base_unit_decimals: 18, base_units_from_height: 1050 };
const word = (n: bigint) => n.toString(16).padStart(64, '0');

describe('Extension dApp approval: native BOING value on contract calls (E2E, mocked RPC)', () => {
  test('wrap + approve + swap batch shows 1 BOING sent to contracts', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    let ready = false;
    const { context, close } = await openPopupWithNewWallet({
      submitted,
      rpc: (method) => {
        if (!ready) return undefined;
        if (method === 'boing_getNetworkInfo') return { head_height: 1170, chain_height: 1170, native_currency: NATIVE };
        if (method === 'boing_simulateTransaction') {
          return { success: true, gas_used: 90000, network_fee: '90000000000000000', network_fee_decimals: 18 };
        }
        return undefined;
      },
    });
    try {
      ready = true;
      const dapp = await context.newPage();
      await dapp.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await dapp.waitForFunction(() => !!(window as unknown as { boing?: unknown }).boing, null, { timeout: 30_000 });
      const [account] = await connectDapp(context, dapp);
      const approve = `0x${word(0x02n)}${word(BigInt(POOL))}${word(10n ** 18n)}`;
      const swap = `0x${word(0x10n)}${word(0n)}${word(10n ** 18n)}${word(89n)}${word(0n)}`;
      const ids = [account.toLowerCase(), WBOING, POOL];
      const approvalP = context.waitForEvent('page', { timeout: 30_000 });
      const sendP = dapp.evaluate(
        (tx) => (window as unknown as { boing: { request: (x: unknown) => Promise<unknown> } }).boing.request({ method: 'boing_sendTransaction', params: [tx] }),
        {
          type: 'batch',
          calls: [
            { type: 'contract_call', contract: WBOING, calldata: `0x${word(0x20n)}`, value: '1000000000000000000' },
            { type: 'contract_call', contract: WBOING, calldata: approve },
            { type: 'contract_call', contract: POOL, calldata: swap },
          ],
          access_list: { read: ids, write: ids },
        }
      );
      const approval = await approvalP;
      await approval.waitForLoadState('domcontentloaded');
      await expect(approval.locator('#approval-title')).toHaveText('Approve transaction');
      const body = approval.locator('#approval-tx-tbody');
      await expect(body.locator('tr', { hasText: 'BOING sent to contracts' }).first()).toContainText('1 BOING');
      await expect(body).toContainText('sending 1 BOING');
      const shotDir = process.env.E2E_SHOT_DIR ?? path.join('test-results', 'shots');
      fs.mkdirSync(shotDir, { recursive: true });
      await approval.addStyleTag({ content: '.tx-table-wrap{max-height:none !important;overflow:visible !important}' });
      await approval.screenshot({ path: path.join(shotDir, 'express-approval-native-swap-1-boing.png'), fullPage: true });
      await approval.locator('#btn-approve').click();
      await sendP;
      expect(submitted).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
