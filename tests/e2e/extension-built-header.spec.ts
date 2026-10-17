import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';

/**
 * Header logo, no address line above Assets, failed-tx Tx tab. Run against the built folder users load:
 *   E2E_EXTENSION_DIR=extension-unpacked SHOT_DIR=<dir> npx playwright test extension-built-header
 */
const SHOT_DIR = process.env.SHOT_DIR ?? '';
const h = (b: string) => '0x' + b.repeat(32);

test('built popup: logo renders, no address above Assets, failed tx row', async () => {
  test.setTimeout(180_000);
  const { popup, close } = await openPopupWithNewWallet({
    accountTransactions: (params) => {
      const me = String(params[0]);
      return {
        account: me, head_height: 930, next_cursor: null, transactions: [
          { tx_id: h('ee'), block_height: 925, tx_index: 0, timestamp: 1_760_000_400, sender: me, nonce: 7, direction: 'out',
            payload: { kind: 'transfer', to: h('42'), amount: '1' + '0'.repeat(30) }, success: false,
            error: 'Insufficient balance', gas_used: 21000 },
          { tx_id: h('01'), block_height: 60, tx_index: 0, timestamp: 1_760_000_100, sender: h('fa'), nonce: 0, direction: 'in',
            payload: { kind: 'transfer', to: me, amount: '40' }, success: true, error: null, gas_used: 21000 },
        ],
      };
    },
  });
  try {
    if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
    const shot = (name: string) => (SHOT_DIR ? path.join(SHOT_DIR, name) : undefined);

    // 1) Header logo image actually loads (it was a broken image when logo-mark.svg was not shipped).
    const logo = popup.locator('#screen-dashboard:not(.hidden) .logo-mark, [data-testid="popup-logo"] img').first();
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    const header = popup.locator('[data-testid="popup-logo"]').first();
    if (SHOT_DIR) await header.screenshot({ path: shot('popup-header.png') });

    // 2) Wallet tab: nothing that looks like an address is visible above the Assets heading.
    const above = await popup.evaluate(() => {
      const assets = Array.from(document.querySelectorAll('#panel-wallet h3')).find((e) => /assets/i.test(e.textContent ?? ''));
      if (!assets) return ['<no Assets heading>'];
      const found: string[] = [];
      const walker = document.createTreeWalker(document.getElementById('panel-wallet')!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(assets.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        const el = n.parentElement!;
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        if (visible && /(0x)?[0-9a-f]{8,}|[0-9a-f]{4,}…[0-9a-f]{4,}/i.test(n.textContent ?? '')) found.push(n.textContent!.trim());
      }
      return found;
    });
    expect(above).toEqual([]);
    await expect(popup.getByTestId('wallet-active-address')).toHaveText(/^(0x)?[0-9a-f]{64}$/i);
    if (SHOT_DIR) await popup.screenshot({ path: shot('popup-wallet-tab.png'), fullPage: true });

    // 3) Tx tab: failed row has the badge and 'Not transferred', and rows show date/time but no 'Block N'.
    await popup.getByTestId('wallet-tab-transactions').click();
    const rows = popup.getByTestId('tx-history-row');
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await expect(rows.first()).toHaveAttribute('data-status', 'failed');
    await expect(rows.first().getByTestId('tx-failed-badge')).toHaveText('Failed');
    await expect(rows.first()).toContainText('Not transferred (failed)');
    for (const t of await rows.allInnerTexts()) expect(t).not.toMatch(/Block \d+/);
    if (SHOT_DIR) await popup.screenshot({ path: shot('popup-tx-tab.png'), fullPage: true });
  } finally {
    await close();
  }
});
