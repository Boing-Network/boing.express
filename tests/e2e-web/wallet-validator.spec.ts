import { expect, test, type Page } from '@playwright/test';
import * as ed from '@noble/ed25519';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

let OWNER = '';
test.beforeAll(async () => {
  const pub = await ed.getPublicKeyAsync(Uint8Array.from(Buffer.from('11'.repeat(32), 'hex')));
  OWNER = '0x' + Buffer.from(pub).toString('hex');
});

const WALLET = 'http://127.0.0.1:4174';
const TEST_KEY = '11'.repeat(32); // throwaway, never funded
const PASSWORD = 'e2e-password-123';
const NODE_KEY = '07'.repeat(32); // throwaway node seed
const NODE_ID = '0xea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const ANCHOR = '0x' + 'ab'.repeat(32);

async function importWallet(page: Page): Promise<string> {
  await page.goto(`${WALLET}/wallet`);
  await page.getByTestId('wallet-landing-import').click();
  await page.getByPlaceholder('0x... or 64 hex chars').fill(TEST_KEY);
  await page.getByPlaceholder('Password (min 8 characters)').fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByTestId('wallet-import-submit').click();
  await expect(page.getByTestId('wallet-header-settings')).toBeVisible({ timeout: 30_000 });
  return '';
}

function variant(hex: string): number {
  const h = hex.replace(/^0x/i, '').slice(80, 88);
  return parseInt(h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2), 16);
}

const OPEN = {
  activation_height: 300, activated_at: 300, bond: '100', deregister_delay: 100, epoch_len: 100,
  next_epoch_height: 400, max_open_validators: 20, liveness_window: 1000, miss_threshold_bps: 1000,
  min_liveness_samples: 10, jail_cooldown: 500, anchors: [ANCHOR],
};
const anchorEntry = {
  id: ANCHOR, kind: 'anchor', status: 'active', in_set: true, owner: null, bond: '0', registered_at: null,
  jailed_until: null, jail_count: 0, scheduled_proposals: 40, missed_proposals: 0, uptime_pct: 100,
};

test.describe('validator tab (mocked RPC)', () => {
  test.use({ viewport: { width: 380, height: 900 } });

  test('shows coming soon when the network is not in open mode', async ({ context, page }) => {
    await installBoingNetworkMocks(context, {
      validators: () => ({ mode: 'static', height: 120, quorum: 1, validator_count: 1, open: null, validators: [anchorEntry] }),
    });
    await importWallet(page);
    await page.getByTestId('wallet-tab-validator').click();
    await expect(page.getByTestId('validator-coming-soon')).toContainText('coming soon');
    await expect(page.getByTestId('validator-register-form')).toHaveCount(0);
  });

  test('older node without boing_getValidators still shows coming soon', async ({ context, page }) => {
    await installBoingNetworkMocks(context);
    await importWallet(page);
    await page.getByTestId('wallet-tab-validator').click();
    await expect(page.getByTestId('validator-coming-soon')).toBeVisible();
    await expect(page.getByTestId('validator-load-error')).toBeVisible();
  });

  test('register with a pasted node key, then pending row with uptime/bond and deregister', async ({ context, page }) => {
    const submitted: string[] = [];
    const bodies: string[] = [];
    page.on('request', (r) => {
      const b = r.postData();
      if (b) bodies.push(b);
    });
    const owner = OWNER;
    await installBoingNetworkMocks(context, {
      submitted,
      validators: () => {
        const mine = submitted.some((h) => variant(h) === 10)
          ? [{
              id: NODE_ID, kind: 'open', status: 'pending', in_set: false, owner, bond: '100', registered_at: 352,
              jailed_until: null, jail_count: 0, scheduled_proposals: 0, missed_proposals: 0, uptime_pct: 100,
            }]
          : [];
        return { mode: 'open', height: 352, quorum: 1, validator_count: 1, open: OPEN, validators: [anchorEntry, ...mine] };
      },
    });
    await importWallet(page);
    await page.getByTestId('wallet-tab-validator').click();
    await expect(page.getByTestId('validator-summary')).toContainText('next epoch at block 400');
    await expect(page.getByTestId('validator-key-warning')).toContainText('never stored or sent anywhere');
    await page.getByTestId('validator-node-key').fill(NODE_KEY);
    await expect(page.getByTestId('validator-node-id')).toContainText('0xea4a6c63');
    await page.getByTestId('validator-register').click();
    await expect(page.getByTestId('validator-success')).toContainText('Registration submitted');
    expect(submitted.map(variant)).toEqual([10]);
    // The node secret never leaves the browser.
    expect(bodies.some((b) => b.toLowerCase().includes(NODE_KEY))).toBe(false);
    await expect(page.getByTestId('validator-node-key')).toHaveValue('');
  });

  test('pending/jailed rows show stats; unjail and deregister submit the right txs', async ({ context, page }) => {
    const submitted: string[] = [];
    const ownerHex = OWNER;
    await installBoingNetworkMocks(context, {
      submitted,
      account: () => ({ balance: '1000000', nonce: '3', stake: '0', pending_unbond: '100', unbond_unlock_height: 380 }),
      validators: () => ({
        mode: 'open', height: 512, quorum: 1, validator_count: 1, open: { ...OPEN, next_epoch_height: 600 },
        validators: [anchorEntry, {
          id: NODE_ID, kind: 'open', status: 'jailed', in_set: false, owner: ownerHex, bond: '100', registered_at: 352,
          jailed_until: 500, jail_count: 1, scheduled_proposals: 0, missed_proposals: 0, uptime_pct: 100,
          last_jail: { jailed_at: 400, scheduled_proposals: 25, missed_proposals: 25, uptime_pct: 0 },
        }],
      }),
    });
    await importWallet(page);
    await page.getByTestId('wallet-tab-validator').click();
    const row = page.getByTestId('validator-row-ea4a6c63').first();
    await expect(row).toContainText('jailed until block 500');
    await expect(row).toContainText('Since jailing: Uptime 100.0%');
    await expect(row.getByTestId('validator-last-jail')).toContainText('At jailing (block 400): uptime 0.0% · missed 25/25 blocks');
    await expect(row).toContainText('bond 100 BOING');
    await expect(page.getByTestId('validator-claim')).toContainText('100 BOING unbonding');
    const shot = process.env.VALIDATOR_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });
    await page.getByTestId('validator-unjail').click();
    await expect(page.getByTestId('validator-success')).toContainText('Unjail submitted');
    await page.getByTestId('validator-deregister').click();
    await expect(page.getByTestId('validator-success')).toContainText('Deregistration submitted');
    await page.getByRole('button', { name: 'Claim unbond' }).click();
    await expect(page.getByTestId('validator-success')).toContainText('Claim submitted');
    expect(submitted.map(variant)).toEqual([12, 11, 7]);
  });
});
