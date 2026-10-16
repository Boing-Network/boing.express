import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = 'http://127.0.0.1:4174';
const PASSWORD = 'e2e-password-123';
const TEST_KEY = '11'.repeat(32);
const ALICE = 'ab'.repeat(32);
const SHOTS = process.env.NAMES_SHOTS; // directory for after-14-*.png

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-14-${name}.png`, fullPage: true });
}

/** Payload variant + leading string field of a signed tx hex (nonce u64, sender 32, then payload). */
function decode(hex: string): { variant: number; name?: string } {
  const h = hex.replace(/^0x/, '');
  const off = (8 + 32) * 2;
  const le = (s: string) => parseInt(s.match(/../g)!.reverse().join(''), 16);
  const variant = le(h.slice(off, off + 8));
  if (variant >= 14 && variant !== 18) {
    const len = le(h.slice(off + 8, off + 24));
    const name = Buffer.from(h.slice(off + 24, off + 24 + len * 2), 'hex').toString('utf8');
    return { variant, name };
  }
  if (variant === 18 && h.slice(off + 8, off + 10) === '01') {
    const len = le(h.slice(off + 10, off + 26));
    return { variant, name: Buffer.from(h.slice(off + 26, off + 26 + len * 2), 'hex').toString('utf8') };
  }
  return { variant };
}

const REGISTRY = {
  enabled: true,
  active: true,
  activation_height: 640,
  blocks_per_year: 15_768_000,
  grace_blocks: 1_296_000,
  commit_min_age: 1,
  commit_max_age: 43_200,
};

/** In-memory name registry driven by the submitted txs. */
function nameMocks(context: BrowserContext, submitted: string[], me: { hex: string }) {
  const names = new Map<string, { owner: string; target: string }>([['alice', { owner: ALICE, target: ALICE }]]);
  let primary: string | null = null;
  let seen = 0;
  const sync = () => {
    for (; seen < submitted.length; seen++) {
      const d = decode(submitted[seen]!);
      if (d.variant === 14 && d.name) names.set(d.name, { owner: me.hex, target: me.hex });
      if (d.variant === 18) primary = d.name ?? null;
    }
  };
  const rec = (n: string) => {
    const r = names.get(n)!;
    return { name: n, display: `${n}.boing`, owner: `0x${r.owner}`, target: `0x${r.target}`, registered_at: 700, expires_at: 15_768_700, status: 'active' };
  };
  const label = (raw: unknown) => String(raw ?? '').trim().toLowerCase().replace(/\.boing$/, '');
  return installBoingNetworkMocks(context, {
    submitted,
    simulateGasUsed: 21_000,
    rpc: (method, params) => {
      sync();
      switch (method) {
        case 'boing_getTransactionReceipt':
          return { success: true, block_height: 701 };
        case 'boing_resolveName': {
          const n = label(params[0]);
          return names.has(n) ? rec(n) : null;
        }
        case 'boing_reverseName': {
          const a = String(params[0]).replace(/^0x/, '');
          return primary && a === me.hex ? { name: primary, display: `${primary}.boing`, address: `0x${a}`, verified: true } : null;
        }
        case 'boing_getNameInfo': {
          const n = label(params[0]);
          const reserved = n === 'boing';
          return {
            input: params[0],
            name: n,
            display: `${n}.boing`,
            valid: true,
            reserved,
            available: !reserved && !names.has(n),
            status: names.has(n) ? 'active' : null,
            rent_per_year: n.length >= 6 ? '1' : n.length === 5 ? '2' : n.length === 4 ? '5' : '10',
            ...(names.has(n) ? { record: rec(n) } : {}),
            registry: REGISTRY,
            head_height: 700,
          };
        }
        case 'boing_namesOwnedBy': {
          const a = String(params[0]).replace(/^0x/, '');
          return [...names.keys()].filter((n) => names.get(n)!.owner === a).map(rec);
        }
        default:
          return undefined;
      }
    },
  });
}

test.describe('.boing names (mocked RPC)', () => {
  test.use({ viewport: { width: 400, height: 860 } });

  test('create wallet → pick a name → claimed after funding (commit, register, primary)', async ({ context, page }) => {
    const submitted: string[] = [];
    const me = { hex: '' };
    await nameMocks(context, submitted, me);
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-create').click();
    await page.getByTestId('wallet-create-password').fill(PASSWORD);
    await page.getByTestId('wallet-create-password-confirm').fill(PASSWORD);
    await page.getByTestId('wallet-create-submit').click();
    await page.getByTestId('wallet-backup-ack').check();
    await page.getByTestId('wallet-backup-continue').click();
    await expect(page.getByTestId('wallet-claim-name')).toBeVisible();
    await page.getByTestId('wallet-claim-name-input').fill('alice');
    await expect(page.getByTestId('wallet-claim-name-status')).toHaveText('alice.boing is taken');
    await page.getByTestId('wallet-claim-name-input').fill('Nico-Test');
    await expect(page.getByTestId('wallet-claim-name-status')).toContainText('nico-test.boing is available: 1 BOING / year');
    await shot(page, 'create-claim-name');
    // Address is known once the dashboard opens; the mock binds names to it.
    page.on('request', (r) => {
      if (r.method() === 'POST' && !me.hex) {
        const body = r.postData() ?? '';
        const m = body.match(/"boing_getAccount","params":\["(?:0x)?([0-9a-f]{64})"/);
        if (m) me.hex = m[1]!;
      }
    });
    await page.getByTestId('wallet-claim-name-reserve').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wallet-primary-name')).toHaveText('nico-test.boing', { timeout: 30_000 });
    await expect(page.getByTestId('pending-name')).toHaveCount(0);
    expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
    expect(decode(submitted[1]!).name).toBe('nico-test');
    await shot(page, 'wallet-primary-name');
  });

  test('send to a name shows the resolved address on review and re-resolves on confirm', async ({ context, page }) => {
    const submitted: string[] = [];
    await nameMocks(context, submitted, { hex: '' });
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wallet-tab-transfer').click();
    await page.getByTestId('send-to').fill('bob.boing');
    await page.getByTestId('send-amount').fill('5');
    await page.getByTestId('send-submit').click();
    await expect(page.getByTestId('send-error')).toHaveText('bob.boing is not registered (or has expired)');
    await page.getByTestId('send-to').fill('Alice.boing');
    await page.getByTestId('send-submit').click();
    await expect(page.getByTestId('send-confirm-to-name')).toHaveText('alice.boing');
    await expect(page.getByTestId('send-confirm-to')).toHaveText(`0x${ALICE.slice(0, 10)}…${ALICE.slice(-8)}`);
    await expect(page.getByTestId('send-confirm-to')).toHaveAttribute('title', `0x${ALICE}`);
    await shot(page, 'send-to-name-review');
    await page.getByTestId('send-confirm-submit').click();
    await expect(page.getByTestId('send-success')).toContainText('Sent', { timeout: 30_000 });
    expect(submitted).toHaveLength(1);
    // Transfer payload (variant 0) to alice's resolved address.
    expect(submitted[0]!.replace(/^0x/, '').slice(80, 88)).toBe('00000000');
    expect(submitted[0]!).toContain(ALICE);
  });

  test('Settings → Names lists owned names and manages them', async ({ context, page }) => {
    const submitted: string[] = [];
    const me = { hex: '' };
    await nameMocks(context, submitted, me);
    page.on('request', (r) => {
      const m = (r.postData() ?? '').match(/"boing_getAccount","params":\["(?:0x)?([0-9a-f]{64})"/);
      if (m && !me.hex) me.hex = m[1]!;
    });
    await page.goto(`${WALLET}/wallet`);
    const skip = page.getByRole('button', { name: 'Skip intro' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByTestId('wallet-landing-import').click();
    await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
    await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await page.getByTestId('wallet-import-submit').click();
    await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wallet-header-settings').click();
    const panel = page.getByTestId('settings-names');
    await expect(panel.getByTestId('names-empty')).toBeVisible();
    await panel.getByTestId('names-query').fill('boingfan');
    await expect(panel.getByTestId('names-availability')).toContainText('boingfan.boing is available: 1 BOING for 1 year');
    await panel.getByTestId('names-claim').click();
    await expect(panel.getByTestId('names-ok')).toContainText('boingfan.boing is yours', { timeout: 30_000 });
    await expect(panel.getByTestId('names-row')).toHaveCount(1);
    await expect(panel.getByTestId('names-row')).toContainText('primary');
    expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
    await panel.scrollIntoViewIfNeeded();
    await shot(page, 'settings-names');
  });
});