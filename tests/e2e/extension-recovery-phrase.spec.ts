import { test, expect } from '@playwright/test';
import { E2E_PASSWORD, openFreshPopup, openPopupWithNewWallet, skipClaimNameIfShown } from './helpers/popup';

const runPopupSuite = process.env.EXTENSION_E2E_FULL === '1';
const describePopup = runPopupSuite ? test.describe : test.describe.skip;

const strip = (ts: string[]) => ts.map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());

describePopup('Extension recovery phrase (E2E)', () => {
  test('create with phrase -> reveal after password -> restore in a fresh profile gives the same address', async () => {
    test.setTimeout(150_000);
    const a = await openPopupWithNewWallet({}, { phrase: true });
    let b: Awaited<ReturnType<typeof openFreshPopup>> | undefined;
    try {
      expect(a.phrase).toHaveLength(24);
      const popup = a.popup;
      const me = ((await popup.getByTestId('wallet-active-address').textContent()) ?? '').trim().toLowerCase();
      expect(me).toMatch(/^(0x)?[0-9a-f]{64}$/);

      await popup.locator('#btn-settings').click();
      await popup.getByTestId('reveal-recovery-phrase').locator('summary').click();
      await popup.getByTestId('reveal-phrase-password').fill('not-the-password');
      await popup.getByTestId('reveal-phrase-submit').click();
      await expect(popup.locator('#reveal-phrase-error')).toContainText('Incorrect password.');
      await popup.getByTestId('reveal-phrase-password').fill(E2E_PASSWORD);
      await popup.getByTestId('reveal-phrase-submit').click();
      await expect(popup.locator('#reveal-phrase-output')).not.toHaveClass(/hidden/, { timeout: 30_000 });
      expect(await popup.locator('#reveal-phrase-words').innerText()).not.toContain(a.phrase[0]!);
      await popup.getByTestId('reveal-phrase-toggle').click();
      expect(strip(await popup.locator('#reveal-phrase-words li').allTextContents())).toEqual(a.phrase);
      await popup.locator('#btn-reveal-phrase-done').click();
      await expect(popup.locator('#reveal-phrase-output')).toHaveClass(/hidden/);
      await expect(popup.locator('#reveal-phrase-words')).toHaveText('');

      b = await openFreshPopup({});
      const p2 = b.popup;
      await p2.getByTestId('wallet-landing-import').click();
      const scope = p2.locator('#screen-import:not(.hidden)');
      await scope.locator('[data-testid="wallet-import-phrase"]').fill('abandon abandon nonsense');
      await scope.locator('[data-testid="wallet-import-password"]').fill(E2E_PASSWORD);
      await scope.locator('[data-testid="wallet-import-password-confirm"]').fill(E2E_PASSWORD);
      await scope.locator('[data-testid="wallet-import-submit"]').click();
      await expect(p2.getByText(/12 or 24 words/).first()).toBeVisible();
      await scope.locator('[data-testid="wallet-import-phrase"]').fill(a.phrase.join(' '));
      await scope.locator('[data-testid="wallet-import-submit"]').click();
      await skipClaimNameIfShown(p2);
      await expect(p2.locator('#screen-dashboard:not(.hidden) [data-testid="wallet-header-lock"]')).toBeVisible({ timeout: 45_000 });
      const restored = ((await p2.getByTestId('wallet-active-address').textContent()) ?? '').trim().toLowerCase();
      expect(restored).toBe(me);
    } finally {
      await b?.close();
      await a.close();
    }
  });

  test('a private-key account has no recovery phrase and says how to get one', async () => {
    test.setTimeout(120_000);
    const a = await openPopupWithNewWallet({});
    try {
      await a.popup.locator('#btn-settings').click();
      await a.popup.getByTestId('reveal-recovery-phrase').locator('summary').click();
      await expect(a.popup.getByTestId('reveal-recovery-phrase-none')).toBeVisible();
      await expect(a.popup.getByTestId('reveal-recovery-phrase-none')).toContainText('no recovery phrase');
    } finally {
      await a.close();
    }
  });
});
