import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';
import { nonceOfSignedHex } from '../e2e/helpers/popup';

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const A = '22'.repeat(32);
const B = '33'.repeat(32);
const C = '44'.repeat(32);

/** Payload discriminant of a signed tx hex (after nonce u64 + sender 32 bytes). */
function variantOf(hex: string): number {
  const h = hex.replace(/^0x/i, '').slice(80, 88);
  return parseInt(h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2), 16);
}

async function importWallet(page: Page) {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByTestId('wallet-import-method-key').check();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('assets-composition')).toContainText('1000000', { timeout: 30_000 });
}

async function openBulk(page: Page, csv: string) {
  await page.getByTestId('wallet-tab-transfer').click();
  await page.getByTestId('transfer-mode-bulk').click();
  await page.locator('details', { has: page.getByTestId('bulk-csv') }).locator('summary').click();
  await page.getByTestId('bulk-csv').fill(csv);
  await page.getByTestId('bulk-csv-import').click();
  await page.getByTestId('bulk-review').click();
}

test.describe('bulk transfer: native atomic batch (mocked RPC)', () => {
  test.use({ viewport: { width: 380, height: 760 } });

  test('batch-capable node: one approval, one fee, one tx, one history entry', async ({ context, page }) => {
    const submitted: string[] = [];
    await installBoingNetworkMocks(context, { submitted, batchSupport: true, simulateGasUsed: 49_000 });
    await importWallet(page);
    await openBulk(page, `${A},1\n${B},2\n${C},3`);

    const review = page.getByTestId('bulk-review-screen');
    await expect(review).toHaveAttribute('data-mode', 'batch');
    await expect(page.getByTestId('bulk-review-mode')).toContainText('One atomic batch');
    await expect(page.getByTestId('bulk-review-row')).toHaveCount(3);
    await expect(page.getByTestId('bulk-review-total')).toHaveText('6 BOING');
    // 49 000 gas → ceil(49000 / 21000) = 3 BOING, exact (simulated).
    await expect(page.getByTestId('bulk-review-fee')).toHaveText('Network fee: 3 BOING for the whole batch');
    await expect(page.getByTestId('bulk-review-atomic')).toContainText('All-or-nothing');
    const shot = process.env.BULK_REVIEW_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });

    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-progress-summary')).toContainText('Batch of 3 submitted as one transaction', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
    expect(variantOf(submitted[0]!)).toBe(9);
    expect(nonceOfSignedHex(submitted[0]!)).toBe(0);
    await expect(page.locator('[data-testid="bulk-progress-row"][data-status="submitted"]')).toHaveCount(3);

    await page.getByTestId('wallet-tab-transactions').click();
    const rows = page.getByTestId('tx-history-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Batch');
    await expect(rows.first()).toContainText('Batch of 3 (atomic)');
    await rows.first().getByTestId('tx-history-steps').locator('summary').click();
    await expect(rows.first().getByTestId('tx-history-steps').locator('li')).toHaveCount(3);
  });

  test('node that cannot decode batches: falls back to sequential before anything is sent', async ({ context, page }) => {
    const submitted: string[] = [];
    await installBoingNetworkMocks(context, { submitted, batchSupport: true, rejectBatchDecode: true });
    await importWallet(page);
    await openBulk(page, `${A},1\n${B},2`);
    await expect(page.getByTestId('bulk-review-screen')).toHaveAttribute('data-mode', 'sequential');
    await expect(page.getByTestId('bulk-mode-note')).toContainText('does not support batch');
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-progress-summary')).toHaveText(/All 2 transfers submitted/, { timeout: 60_000 });
    expect(submitted.map(variantOf)).toEqual([0, 0]);
    expect(submitted.map(nonceOfSignedHex)).toEqual([0, 1]);
  });

  test('node without the capability flag, or more than 16 rows: sequential', async ({ context, page }) => {
    await installBoingNetworkMocks(context, { batchSupport: true });
    await importWallet(page);
    const many = Array.from({ length: 17 }, (_, i) => `${(0x50 + i).toString(16).repeat(32)},1`).join('\n');
    await openBulk(page, many);
    await expect(page.getByTestId('bulk-review-screen')).toHaveAttribute('data-mode', 'sequential');
    await expect(page.getByTestId('bulk-mode-note')).toContainText('More than 16 rows');
    await expect(page.getByTestId('bulk-review-fee')).toHaveCount(0);
  });
});

const TOK = 'ab'.repeat(32);
const COLL = 'cd'.repeat(32);

/** Mocked holdings: 1000.00 TKN (2 decimals) and every token id in COLL owned by `owner()`. */
function holdingsMocks(owner: () => string) {
  return {
    dexTokens: [{ id: `0x${TOK}`, symbol: 'TKN', decimals: 2 }],
    storage: (contract: string, _key: string) => {
      if (contract === TOK) return (100_000).toString(16);
      if (contract === COLL) return owner();
      return null;
    },
  };
}

async function seedNftWatchlist(page: Page, me: string, ids: number[]) {
  const owner = me.replace(/^0x/i, '').toLowerCase();
  await page.evaluate(
    ([key, entries]) => localStorage.setItem(key as string, entries as string),
    [
      `boing-express-nft-watchlist:${owner}:boing-testnet`,
      JSON.stringify(ids.map((n) => ({ collectionHex: COLL, tokenIdHex: n.toString(16).padStart(64, '0'), addedAt: 1 }))),
    ]
  );
}

async function myAddress(page: Page): Promise<string> {
  return ((await page.getByTestId('wallet-header-copy').getAttribute('title')) ?? '').trim().replace(/^0x/i, '').toLowerCase();
}

test.describe('bulk transfer: mixed BOING + token + NFT (mocked holdings)', () => {
  test.use({ viewport: { width: 380, height: 900 } });

  test('one atomic batch with NFT steps; review + Tx history list them', async ({ context, page }) => {
    const submitted: string[] = [];
    let me = '';
    await installBoingNetworkMocks(context, { submitted, batchSupport: true, simulateGasUsed: 98_000, ...holdingsMocks(() => me) });
    await importWallet(page);
    me = await myAddress(page);
    await seedNftWatchlist(page, me, [7, 8]);
    await openBulk(page, `${A},5\n${B},12.5,TKN\n${C},nft:${COLL}:7\n${A},,nft:${COLL}:8`);

    await expect(page.getByTestId('bulk-review-screen')).toHaveAttribute('data-mode', 'batch');
    const list = page.getByTestId('bulk-review-row');
    await expect(list).toHaveCount(4);
    await expect(list.nth(1)).toContainText('12.5 TKN');
    await expect(list.nth(2)).toContainText('NFT');
    await expect(list.nth(2)).toContainText('#7');
    await expect(list.nth(3)).toContainText('#8');
    await expect(page.getByTestId('bulk-review-total')).toHaveText('5 BOING + 12.5 TKN + 2 NFTs');
    await expect(page.getByTestId('bulk-review-fee')).toHaveText('Network fee: 5 BOING for the whole batch');
    const shot = process.env.BULK_MIXED_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });

    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-progress-summary')).toContainText('Batch of 4 submitted as one transaction', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
    expect(variantOf(submitted[0]!)).toBe(9);

    await page.getByTestId('wallet-tab-transactions').click();
    const row = page.getByTestId('tx-history-row').first();
    await expect(row).toContainText('2 NFTs');
    await row.getByTestId('tx-history-steps').locator('summary').click();
    const steps = row.getByTestId('tx-history-steps').locator('li');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(2)).toContainText('NFT');
  });

  test('guards: same NFT twice, sending to yourself, NFT you do not hold', async ({ context, page }) => {
    let me = '';
    await installBoingNetworkMocks(context, { batchSupport: true, ...holdingsMocks(() => me) });
    await importWallet(page);
    me = await myAddress(page);
    await seedNftWatchlist(page, me, [7]);
    await openBulk(page, `${A},nft:${COLL}:7\n${B},nft:${COLL}:7\n${me},nft:${COLL}:9`);
    const issues = page.getByTestId('bulk-issues');
    await expect(issues).toContainText('same NFT as Row 1');
    await expect(issues).toContainText('cannot send to your own address');
    await expect(issues).toContainText('you do not hold this NFT (#9)');
    await expect(page.getByTestId('bulk-review-screen')).toHaveCount(0);
  });

  test('sequential fallback sends NFT rows as contract calls', async ({ context, page }) => {
    const submitted: string[] = [];
    let me = '';
    await installBoingNetworkMocks(context, { submitted, ...holdingsMocks(() => me) });
    await importWallet(page);
    me = await myAddress(page);
    await seedNftWatchlist(page, me, [7]);
    await openBulk(page, `${A},nft:${COLL}:7\n${B},2,TKN\n${C},3`);
    await expect(page.getByTestId('bulk-review-screen')).toHaveAttribute('data-mode', 'sequential');
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-progress-summary')).toHaveText(/All 3 transfers submitted/, { timeout: 60_000 });
    expect(submitted.map(variantOf)).toEqual([1, 1, 0]);
    expect(submitted.map(nonceOfSignedHex)).toEqual([0, 1, 2]);
    // NFT calldata: selector 0x04, recipient A, token id 7.
    expect(submitted[0]).toContain(`${'00'.repeat(31)}04${A}${(7).toString(16).padStart(64, '0')}`);
  });
});
