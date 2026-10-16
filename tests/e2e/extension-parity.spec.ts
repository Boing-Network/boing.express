import { test, expect, type Page } from '@playwright/test';
import { nonceOfSignedHex, openPopupWithNewWallet } from './helpers/popup';

/** Parity with the web wallet (0.1.12): Validator tab, chain Tx history, atomic bulk batch, dApp batch approval. */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;

const A = '22'.repeat(32);
const B = '33'.repeat(32);
const C = '44'.repeat(32);
const FAUCET = '0x' + 'fa'.repeat(32);
const REGISTRY = '0x' + 'eb'.repeat(32);
const NODE_ID = '0xea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const ANCHOR = '0x' + 'ab'.repeat(32);
const h = (b: string) => '0x' + b.repeat(32);

function variantOf(hex: string): number {
  const x = hex.replace(/^0x/i, '').slice(80, 88);
  return parseInt(x.slice(6, 8) + x.slice(4, 6) + x.slice(2, 4) + x.slice(0, 2), 16);
}

async function myAddress(popup: Page): Promise<string> {
  return ((await popup.locator('#address').textContent()) ?? '').trim();
}

const OPEN = {
  activation_height: 300, activated_at: 300, bond: '100', deregister_delay: 100, epoch_len: 100,
  next_epoch_height: 600, max_open_validators: 20, liveness_window: 1000, miss_threshold_bps: 1000,
  min_liveness_samples: 10, jail_cooldown: 500, anchors: [ANCHOR],
};
const anchorEntry = {
  id: ANCHOR, kind: 'anchor', status: 'active', in_set: true, owner: null, bond: '0', registered_at: null,
  jailed_until: null, jail_count: 0, scheduled_proposals: 40, missed_proposals: 0, uptime_pct: 100,
};

describe('Extension parity with web wallet (E2E, mocked RPC)', () => {
  test('Validator tab: jailed row with last_jail stats, unjail submits', async () => {
    test.setTimeout(120_000);
    const submitted: string[] = [];
    let owner = '';
    const { popup, close } = await openPopupWithNewWallet({
      submitted,
      validators: () => ({
        mode: 'open', height: 512, quorum: 1, validator_count: 1, open: OPEN,
        validators: [anchorEntry, {
          id: NODE_ID, kind: 'open', status: 'jailed', in_set: false, owner, bond: '100', registered_at: 352,
          jailed_until: 500, jail_count: 1, scheduled_proposals: 0, missed_proposals: 0, uptime_pct: 100,
          last_jail: { jailed_at: 400, scheduled_proposals: 25, missed_proposals: 25, uptime_pct: 0 },
        }],
      }),
    });
    try {
      const me = await myAddress(popup);
      owner = me.startsWith('0x') ? me.toLowerCase() : `0x${me.toLowerCase()}`;
      await expect(popup.getByTestId('wallet-tab-validate')).toBeVisible();
      await popup.getByTestId('wallet-tab-validate').click();
      await expect(popup.getByTestId('validator-steps')).toContainText('100 BOING bond');
      await expect(popup.getByTestId('stake-min-hint')).toContainText('future stake-based');
      await expect(popup.getByRole('button', { name: 'Claim unbond' })).toHaveCount(0);
      await expect(popup.getByTestId('validator-summary')).toContainText('next epoch at block 600');
      const row = popup.getByTestId('validator-row-ea4a6c63').first();
      await expect(row).toContainText('jailed until block 500');
      await expect(row.getByTestId('validator-last-jail')).toContainText('At jailing (block 400)');
      await popup.getByTestId('validator-unjail').click();
      await expect(popup.getByTestId('validator-success')).toContainText('Unjail submitted');
      expect(submitted.map(variantOf)).toEqual([12]);
      await popup.getByTestId('wallet-tab-transactions').click();
      await expect(popup.getByTestId('tx-history-row').first()).toBeVisible();
    } finally {
      await close();
    }
  });

  test('Tx tab: on-chain history (faucet, dApp call, batch) with paging', async () => {
    test.setTimeout(120_000);
    const seen: unknown[][] = [];
    const { popup, close } = await openPopupWithNewWallet({
      accountTransactions: (params) => {
        seen.push(params);
        const me = String(params[0]);
        const all = [
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
        const cursor = (params[1] as { cursor?: string | null } | undefined)?.cursor ?? null;
        if (!cursor) return { account: me, head_height: 200, transactions: all.slice(0, 2), next_cursor: '80:0' };
        return { account: me, head_height: 200, transactions: all.slice(2), next_cursor: null };
      },
    });
    try {
      await popup.getByTestId('wallet-tab-transactions').click();
      const list = popup.getByTestId('tx-history-row');
      await expect(list).toHaveCount(2);
      await expect(list.first()).toContainText('Batch');
      await list.first().getByTestId('tx-history-steps').locator('summary').click();
      await expect(list.first().getByTestId('tx-history-steps').locator('li')).toHaveCount(3);
      await expect(list.nth(1)).toContainText('Contract call');
      await popup.getByTestId('tx-history-more').click();
      await expect(list).toHaveCount(3);
      await expect(list.nth(2)).toContainText('Receive BOING');
      await expect(popup.getByTestId('tx-history-more')).toBeHidden();
      expect(seen.some((p) => (p[1] as { cursor?: string } | undefined)?.cursor === '80:0')).toBe(true);
    } finally {
      await close();
    }
  });

  test('bulk transfer on a batch-capable node: one atomic tx, one history entry', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    const { popup, close } = await openPopupWithNewWallet({ submitted, batchSupport: true, simulateGasUsed: 49_000 });
    try {
      await popup.getByTestId('wallet-tab-transfer').click();
      await popup.getByTestId('transfer-mode-bulk').click();
      await popup.locator('details:has([data-testid="bulk-csv"]) summary').click();
      await popup.getByTestId('bulk-csv').fill(`${A},1\n${B},2\n${C},3`);
      await popup.getByTestId('bulk-csv-import').click();
      await popup.getByTestId('bulk-review').click();
      await expect(popup.getByTestId('bulk-review-screen')).toHaveAttribute('data-mode', 'batch');
      await expect(popup.getByTestId('bulk-review-total')).toHaveText('6 BOING');
      await popup.getByTestId('bulk-confirm').click();
      await expect(popup.getByTestId('bulk-progress-summary')).toContainText('Batch of 3 submitted as one transaction', { timeout: 30_000 });
      expect(submitted).toHaveLength(1);
      expect(variantOf(submitted[0]!)).toBe(9);
      expect(nonceOfSignedHex(submitted[0]!)).toBe(0);
      await popup.getByTestId('wallet-tab-transactions').click();
      const rows = popup.getByTestId('tx-history-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('Batch of 3');
      await rows.first().getByTestId('tx-history-steps').locator('summary').click();
      await expect(rows.first().getByTestId('tx-history-steps').locator('li')).toHaveCount(3);
    } finally {
      await close();
    }
  });

  test('dApp batch request: approval window lists the steps; approve sends one tx', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    const { context, popup, close } = await openPopupWithNewWallet({ submitted, batchSupport: true });
    try {
      const dapp = await context.newPage();
      await dapp.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await dapp.waitForFunction(() => !!(window as unknown as { boing?: unknown }).boing, null, { timeout: 30_000 });
      const accounts = await dapp.evaluate(() =>
        (window as unknown as { boing: { request: (a: unknown) => Promise<string[]> } }).boing.request({ method: 'boing_requestAccounts' })
      );
      expect(accounts).toHaveLength(1);
      const approvalP = context.waitForEvent('page', { timeout: 30_000 });
      const sendP = dapp.evaluate(
        ([a, b]) =>
          (window as unknown as { boing: { request: (x: unknown) => Promise<unknown> } }).boing.request({
            method: 'boing_sendTransaction',
            params: [{ type: 'batch', calls: [{ type: 'transfer', to: a, amount: '5' }, { type: 'transfer', to: b, amount: '7' }] }],
          }),
        [`0x${A}`, `0x${B}`]
      );
      const approval = await approvalP;
      await approval.waitForLoadState('domcontentloaded');
      await expect(approval.locator('#approval-title')).toHaveText('Approve transaction');
      await expect(approval.locator('#approval-tx-tbody')).toContainText(/batch/i);
      await expect(approval.locator('#approval-tx-tbody')).toContainText('Transfer 5');
      await expect(approval.locator('#approval-tx-tbody')).toContainText('Transfer 7');
      await approval.locator('#btn-approve').click();
      const res = await sendP;
      const hash = typeof res === 'string' ? res : (res as { tx_id?: string; tx_hash?: string }).tx_id ?? (res as { tx_hash?: string }).tx_hash;
      expect(String(hash)).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(submitted).toHaveLength(1);
      expect(variantOf(submitted[0]!)).toBe(9);
      void popup;
    } finally {
      await close();
    }
  });
});
