import { expect, test, type Page } from '@playwright/test';
import { installBoingNetworkMocks } from '../e2e/helpers/boingRouteMocks';

const WALLET = process.env.WALLET_URL ?? 'http://127.0.0.1:4174';
const PASSWORD = 'e2e-password-123';

async function words(page: Page, testId = 'wallet-phrase-words'): Promise<string[]> {
  const items = await page.getByTestId(testId).locator('li').allTextContents();
  return items.map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());
}

async function startCreate(page: Page): Promise<void> {
  await page.goto(`${WALLET}/wallet`);
  const skip = page.getByRole('button', { name: 'Skip intro' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByTestId('wallet-landing-create').click();
  await page.getByTestId('wallet-create-password').fill(PASSWORD);
  await page.getByTestId('wallet-create-password-confirm').fill(PASSWORD);
}

async function address(page: Page): Promise<string> {
  return ((await page.getByTestId('wallet-header-copy').getAttribute('title')) ?? '').trim().replace(/^0x/i, '').toLowerCase();
}

async function finishOnboarding(page: Page): Promise<void> {
  const skip = page.getByTestId('wallet-claim-name-skip');
  const settings = page.getByTestId('wallet-header-settings');
  await expect(skip.or(settings).first()).toBeVisible({ timeout: 45_000 });
  if (await skip.isVisible()) await skip.click();
  await expect(settings).toBeVisible({ timeout: 30_000 });
}

test.describe('recovery phrase (BIP-39 24 words, SLIP-0010 ed25519)', () => {
  test.use({ viewport: { width: 400, height: 900 } });

  test('create -> prove 3 words -> reveal after password -> restore on a fresh browser gives the same address', async ({ browser, context, page }) => {
    await installBoingNetworkMocks(context, {});
    await startCreate(page);
    // Phrase is the default, recommended option.
    await expect(page.getByTestId('wallet-create-method-phrase')).toBeChecked();
    await page.getByTestId('wallet-create-submit').click();

    await expect(page.getByTestId('wallet-phrase-words')).toBeVisible();
    const backup = await words(page);
    expect(backup).toHaveLength(24);
    expect(new Set(backup.map((w) => /^[a-z]+$/.test(w))).has(false)).toBe(false);

    // Continue stays locked until the acknowledgement AND the three words are right.
    const cont = page.getByTestId('wallet-backup-continue');
    await expect(cont).toBeDisabled();
    await page.getByTestId('wallet-backup-ack').check();
    await expect(cont).toBeDisabled();
    const positions: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ph = (await page.getByTestId(`wallet-phrase-confirm-${i}`).getAttribute('placeholder')) ?? '';
      positions.push(Number(ph.replace(/\D/g, '')));
    }
    await page.getByTestId('wallet-phrase-confirm-0').fill('wrongword');
    await page.getByTestId('wallet-phrase-confirm-1').fill(backup[positions[1]! - 1]!);
    await page.getByTestId('wallet-phrase-confirm-2').fill(backup[positions[2]! - 1]!);
    await expect(cont).toBeDisabled();
    await page.getByTestId('wallet-phrase-confirm-0').fill(backup[positions[0]! - 1]!.toUpperCase());
    await expect(cont).toBeEnabled();
    await cont.click();
    await finishOnboarding(page);
    const me = await address(page);
    expect(me).toMatch(/^[0-9a-f]{64}$/);

    // Settings: wrong password shows a plain message, right password reveals (hidden until toggled).
    await page.getByTestId('wallet-header-settings').click();
    await page.getByTestId('reveal-recovery-phrase').locator('summary').click();
    await page.getByTestId('reveal-phrase-password').fill('not-the-password');
    await page.getByTestId('reveal-phrase-submit').click();
    await expect(page.getByTestId('reveal-recovery-phrase')).toContainText('Incorrect password.');
    await expect(page.getByTestId('reveal-recovery-phrase').getByTestId('wallet-phrase-words')).toHaveCount(0);
    await page.getByTestId('reveal-phrase-password').fill(PASSWORD);
    await page.getByTestId('reveal-phrase-submit').click();
    const grid = page.getByTestId('reveal-recovery-phrase').getByTestId('wallet-phrase-words');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    expect(await grid.innerText()).not.toContain(backup[0]!);
    await page.getByTestId('reveal-phrase-toggle').click();
    expect((await grid.locator('li').allTextContents()).map((t) => t.replace(/^\s*\d+\.\s*/, '').trim())).toEqual(backup);
    await expect(page.getByTestId('reveal-phrase-password')).toHaveCount(0);

    // Restore on a brand-new browser profile from the 24 words -> same address.
    const ctx2 = await browser.newContext({ viewport: { width: 400, height: 900 } });
    try {
      await installBoingNetworkMocks(ctx2, {});
      const p2 = await ctx2.newPage();
      await p2.goto(`${WALLET}/wallet`);
      const skip = p2.getByRole('button', { name: 'Skip intro' });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      await p2.getByTestId('wallet-landing-import').click();
      await expect(p2.getByTestId('wallet-import-method-phrase')).toBeChecked();
      await p2.getByTestId('wallet-import-phrase').fill('abandon abandon nonsense');
      await p2.getByTestId('wallet-import-password').fill(PASSWORD);
      await p2.getByTestId('wallet-import-password-confirm').fill(PASSWORD);
      await p2.getByTestId('wallet-import-submit').click();
      await expect(p2.getByText(/12 or 24 words/i).first()).toBeVisible();
      await p2.getByTestId('wallet-import-phrase').fill(backup.join(' ').toUpperCase());
      await p2.getByTestId('wallet-import-submit').click();
      await finishOnboarding(p2);
      expect(await address(p2)).toBe(me);
      // A phrase account has the phrase backed up; nothing about it is stored in clear.
      const stored = await p2.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
      expect(stored).not.toContain(backup[0]! + ' ' + backup[1]!);
    } finally {
      await ctx2.close();
    }
  });

  test('a private-key account says it has no recovery phrase and points to adding one', async ({ context, page }) => {
    await installBoingNetworkMocks(context, {});
    await startCreate(page);
    await page.getByTestId('wallet-create-method-key').check();
    await page.getByTestId('wallet-create-submit').click();
    const key = ((await page.getByTestId('wallet-backup-key').textContent()) ?? '').trim();
    await page.getByTestId('wallet-backup-confirm').fill(key.slice(-6));
    await page.getByTestId('wallet-backup-ack').check();
    await page.getByTestId('wallet-backup-continue').click();
    await finishOnboarding(page);
    await page.getByTestId('wallet-header-settings').click();
    await page.getByTestId('reveal-recovery-phrase').locator('summary').click();
    await expect(page.getByTestId('reveal-recovery-phrase-none')).toContainText('no recovery phrase');
  });
});
