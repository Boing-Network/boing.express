import { test, expect } from '@playwright/test';
import { nonceOfSignedHex, openPopupWithNewWallet } from './helpers/popup';

const RUN = process.env.EXTENSION_E2E_FULL === '1';
const A = '11'.repeat(32);
const B = '22'.repeat(32);
const C = '33'.repeat(32);

const describe = RUN ? test.describe : test.describe.skip;

describe('Extension popup redesign (E2E, mocked RPC)', () => {
  test('tabs + settings gear navigation', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet();
    try {
      await expect(popup.getByTestId('wallet-tab-wallet')).toHaveText('Wallet');
      await expect(popup.getByTestId('wallet-tab-transactions')).toHaveText('Tx');
      await expect(popup.getByTestId('wallet-tab-transfer')).toHaveText('Transfer');
      await expect(popup.getByTestId('wallet-tab-assets')).toHaveCount(0);
      // Wallet tab = assets: balance, tokens, collectibles. No key export / connected sites here.
      await expect(popup.getByTestId('assets-composition')).toBeVisible();
      await expect(popup.getByTestId('wallet-tokens')).toBeVisible();
      await expect(popup.locator('#nft-list')).toBeAttached();
      await expect(popup.getByTestId('reveal-private-key')).toBeHidden();
      await expect(popup.locator('#connected-sites-list')).toBeHidden();

      await popup.getByTestId('wallet-tab-transfer').click();
      await expect(popup.getByTestId('transfer-pane-boing')).toBeVisible();
      await popup.getByTestId('wallet-header-settings').click();
      await expect(popup.getByTestId('settings-panel')).toBeVisible();
      await expect(popup.getByTestId('settings-connected-sites')).toBeVisible();
      await expect(popup.getByTestId('reveal-private-key')).toBeVisible();
      await expect(popup.getByTestId('wallet-header-settings')).toHaveAttribute('aria-expanded', 'true');
      // Back returns to the tab you came from.
      await popup.getByTestId('settings-back').click();
      await expect(popup.getByTestId('settings-panel')).toBeHidden();
      await expect(popup.getByTestId('transfer-pane-boing')).toBeVisible();
      // Gear toggles too.
      await popup.getByTestId('wallet-header-settings').click();
      await popup.getByTestId('wallet-header-settings').click();
      await expect(popup.getByTestId('settings-panel')).toBeHidden();
    } finally {
      await close();
    }
  });

  test('connected sites are listed in Settings and can be disconnected', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet();
    try {
      await popup.evaluate(
        () =>
          new Promise<void>((r) =>
            chrome.storage.local.set({ boing_connected_sites: JSON.stringify(['https://boing.finance', 'https://example.org']) }, () => r())
          )
      );
      await popup.getByTestId('wallet-header-settings').click();
      const list = popup.locator('#connected-sites-list');
      await expect(list.locator('li')).toHaveCount(2);
      await popup.getByRole('button', { name: 'Disconnect https://example.org' }).click();
      await expect(list.locator('li')).toHaveCount(1);
      await expect(list).toContainText('https://boing.finance');
      const stored = await popup.evaluate(
        () => new Promise<string>((r) => chrome.storage.local.get(['boing_connected_sites'], (x) => r(String(x.boing_connected_sites))))
      );
      expect(JSON.parse(stored)).toEqual(['https://boing.finance']);
    } finally {
      await close();
    }
  });

  test('Transfer tab sends BOING and the Tx tab records it', async () => {
    test.setTimeout(120_000);
    const submitted: string[] = [];
    const { popup, close } = await openPopupWithNewWallet({ submitted });
    try {
      await popup.getByTestId('wallet-tab-transfer').click();
      // self-transfer guard
      const me = ((await popup.locator('#address').textContent()) ?? '').trim();
      await popup.getByTestId('send-to').fill(me);
      await popup.getByTestId('send-amount').fill('5');
      await popup.getByTestId('send-submit').click();
      await expect(popup.locator('#send-error')).toHaveText(/yourself/);
      await popup.getByTestId('send-to').fill(A);
      await popup.getByTestId('send-submit').click();
      await expect(popup.locator('#send-success')).toContainText('Sent!', { timeout: 30_000 });
      expect(submitted).toHaveLength(1);
      await popup.getByTestId('wallet-tab-transactions').click();
      const rows = popup.getByTestId('tx-history-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('Send BOING');
      await expect(rows.first()).toContainText('5 BOING');
      // Token pane exists; no tokens held in the mock, so sending is disabled.
      await popup.getByTestId('wallet-tab-transfer').click();
      await popup.getByTestId('transfer-mode-token').click();
      await expect(popup.getByTestId('transfer-pane-token')).toBeVisible();
      await expect(popup.getByTestId('token-send-submit')).toBeDisabled();
      await popup.getByTestId('transfer-mode-nft').click();
      await expect(popup.getByTestId('transfer-pane-nft')).toBeVisible();
      await expect(popup.getByTestId('nft-transfer-submit')).toBeDisabled();
    } finally {
      await close();
    }
  });

  test('bulk transfer: validation, review, sequential nonces', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    const { popup, close } = await openPopupWithNewWallet({ submitted });
    try {
      const me = ((await popup.locator('#address').textContent()) ?? '').trim();
      await popup.getByTestId('wallet-tab-transfer').click();
      await popup.getByTestId('transfer-mode-bulk').click();
      // Invalid batch: bad address, self, duplicate, bad amount, over balance.
      await popup.locator('details:has([data-testid="bulk-csv"]) summary').click();
      await popup.getByTestId('bulk-csv').fill(`address,amount\nnothex,1\n${me},1\n${A},1\n${A},2\n${B},0\n${C},2000000`);
      await popup.getByTestId('bulk-csv-import').click();
      await expect(popup.getByTestId('bulk-row')).toHaveCount(6);
      await popup.getByTestId('bulk-review').click();
      const issues = popup.getByTestId('bulk-issues');
      await expect(issues).toBeVisible();
      await expect(issues).toContainText('64 hex');
      await expect(issues).toContainText('own address');
      await expect(issues).toContainText('duplicate recipient');
      await expect(issues).toContainText('positive');
      await expect(issues).toContainText('exceeds balance');
      expect(submitted).toHaveLength(0);

      // Fix: clear, then 3 valid rows (2 manual + 1 CSV).
      await popup.locator('#btn-bulk-clear').click();
      await popup.getByTestId('bulk-row-to').first().fill(A);
      await popup.getByTestId('bulk-row-amount').first().fill('10');
      await popup.getByTestId('bulk-add-row').click();
      await popup.getByTestId('bulk-row-to').nth(1).fill(`0x${B}`);
      await popup.getByTestId('bulk-row-amount').nth(1).fill('20');
      await popup.getByTestId('bulk-csv').fill(`${C};30`);
      await popup.getByTestId('bulk-csv-import').click();
      await popup.getByTestId('bulk-review').click();
      await expect(popup.getByTestId('bulk-review-screen')).toBeVisible();
      await expect(popup.getByTestId('bulk-review-row')).toHaveCount(3);
      await expect(popup.getByTestId('bulk-review-total')).toHaveText('60 BOING');
      expect(submitted).toHaveLength(0);
      await popup.getByTestId('bulk-confirm').click();
      await expect(popup.getByTestId('bulk-progress-summary')).toHaveText(/All 3 transfers submitted/, { timeout: 60_000 });
      await expect(popup.locator('[data-testid="bulk-progress-row"][data-status="submitted"]')).toHaveCount(3);
      expect(submitted.map(nonceOfSignedHex)).toEqual([0, 1, 2]);
      await popup.getByTestId('wallet-tab-transactions').click();
      await expect(popup.getByTestId('tx-history-row')).toHaveCount(3);
    } finally {
      await close();
    }
  });

  test('bulk transfer stops at the first failure and reports it (no retry)', async () => {
    test.setTimeout(150_000);
    const submitted: string[] = [];
    const { popup, close } = await openPopupWithNewWallet({ submitted, failSubmitAt: 2 });
    try {
      await popup.getByTestId('wallet-tab-transfer').click();
      await popup.getByTestId('transfer-mode-bulk').click();
      await popup.locator('details:has([data-testid="bulk-csv"]) summary').click();
      await popup.getByTestId('bulk-csv').fill(`${A},1\n${B},2\n${C},3`);
      await popup.getByTestId('bulk-csv-import').click();
      await popup.getByTestId('bulk-review').click();
      await popup.getByTestId('bulk-confirm').click();
      await expect(popup.getByTestId('bulk-progress-summary')).toHaveText(/Stopped at row 2: 1 of 3 submitted/, { timeout: 60_000 });
      const st = popup.getByTestId('bulk-progress-row');
      await expect(st.nth(0)).toHaveAttribute('data-status', 'submitted');
      await expect(st.nth(1)).toHaveAttribute('data-status', 'failed');
      await expect(st.nth(1)).toContainText('insufficient balance for fee');
      await expect(st.nth(2)).toHaveAttribute('data-status', 'not_sent');
      expect(submitted.map(nonceOfSignedHex)).toEqual([0, 1]);
      await expect(popup.getByTestId('bulk-done')).toBeVisible();
    } finally {
      await close();
    }
  });
});
