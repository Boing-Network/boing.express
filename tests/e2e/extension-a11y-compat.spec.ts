import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';

/** Node compatibility banner, popup tab keyboard model, and the approval-page origin-risk banner (mocked RPC). */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;

describe('Extension: node-compat banner, keyboard tabs, origin-risk banner (E2E, mocked RPC)', () => {
  test('a node that reports no chain id gets the "cannot confirm network" warning', async () => {
    test.setTimeout(120_000);
    const blocked: string[] = [];
    const { popup, close } = await openPopupWithNewWallet({ chainId: null, blocked });
    try {
      const banner = popup.getByTestId('node-compat-banner');
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(banner).toContainText('did not report a chain id');
      await expect(banner).not.toHaveClass(/error/);
      expect(blocked).toEqual([]);
    } finally {
      await close();
    }
  });

  test('a node that reports the expected chain id shows no warning', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet();
    try {
      await expect(popup.getByTestId('node-compat-banner')).toBeHidden();
    } finally {
      await close();
    }
  });

  test('update-available note is advisory, and Dismiss hides it for that recommended version', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet({
      healthExtra: { client_hints: { min_wallet_version: '0.1.15', recommended_wallet_version: '9.9.9' } },
    });
    try {
      const banner = popup.getByTestId('node-compat-banner');
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(banner).toContainText('Boing Express 9.9.9 is available');
      await expect(banner).not.toHaveClass(/error/);
      await popup.getByTestId('compat-dismiss-update').click();
      await expect(banner).toBeHidden();
      expect(await popup.evaluate(() => window.localStorage.getItem('boing_update_note_dismissed_version'))).toBe('9.9.9');
    } finally {
      await close();
    }
  });

  test('a node on the wrong chain shows a blocking error', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet({ chainId: 6914 });
    try {
      const banner = popup.getByTestId('node-compat-banner');
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(banner).toContainText('Wrong network');
      await expect(banner).toHaveClass(/error/);
    } finally {
      await close();
    }
  });

  test('tab bar: one tab stop, arrow / Home / End keys move and activate tabs', async () => {
    test.setTimeout(120_000);
    const { popup, close } = await openPopupWithNewWallet();
    try {
      const tabStops = () => popup.locator('.tab-btn[tabindex="0"]');
      await expect(tabStops()).toHaveCount(1);
      await popup.locator('#tab-wallet').focus();
      await popup.keyboard.press('ArrowRight');
      await expect(popup.locator('#tab-transactions')).toBeFocused();
      await expect(popup.locator('#tab-transactions')).toHaveAttribute('aria-selected', 'true');
      await expect(popup.locator('#tab-transactions')).toHaveAttribute('tabindex', '0');
      await expect(popup.locator('#tab-wallet')).toHaveAttribute('tabindex', '-1');
      await popup.keyboard.press('ArrowRight');
      await expect(popup.locator('#tab-transfer')).toBeFocused();
      await popup.keyboard.press('Home');
      await expect(popup.locator('#tab-wallet')).toBeFocused();
      await popup.keyboard.press('ArrowLeft'); // wraps to the last visible tab (never a hidden one)
      const last = popup.locator('.tab-btn:not(.hidden)').last();
      await expect(last).toBeFocused();
      await expect(tabStops()).toHaveCount(1);

      // Transfer asset switch uses the same model.
      await popup.locator('#tab-transfer').click();
      await popup.locator('#transfer-mode-tab-boing').focus();
      await popup.keyboard.press('ArrowRight');
      await expect(popup.locator('#transfer-mode-tab-token')).toBeFocused();
      await expect(popup.locator('#transfer-mode-tab-token')).toHaveAttribute('aria-selected', 'true');
      await expect(popup.getByTestId('transfer-pane-token')).toBeVisible();
      await popup.keyboard.press('End');
      await expect(popup.locator('#transfer-mode-tab-bulk')).toBeFocused();
    } finally {
      await close();
    }
  });

  test('approval page: a dApp on localhost shows the caution origin banner (not the danger style)', async () => {
    test.setTimeout(120_000);
    const { context, close } = await openPopupWithNewWallet();
    try {
      const dapp = await context.newPage();
      await dapp.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await dapp.waitForFunction(() => !!(window as unknown as { boing?: unknown }).boing, null, { timeout: 30_000 });
      const approvalP = context.waitForEvent('page', { timeout: 30_000 });
      void dapp
        .evaluate(() => (window as unknown as { boing: { request: (a: unknown) => Promise<unknown> } }).boing.request({ method: 'boing_requestAccounts' }))
        .catch(() => undefined);
      const approval = await approvalP;
      await approval.waitForLoadState('domcontentloaded');
      await expect(approval.locator('#approval-title')).toHaveText('Connect to this site?');
      const risk = approval.locator('#approval-risk');
      await expect(risk).toBeVisible();
      await expect(risk).toContainText('Check this site before continuing');
      await expect(risk).toContainText('development app');
      await expect(risk).not.toHaveClass(/risk-danger/);
      await expect(risk).toHaveAttribute('role', 'alert');
      await approval.locator('#btn-reject').click().catch(() => undefined);
    } finally {
      await close();
    }
  });
});