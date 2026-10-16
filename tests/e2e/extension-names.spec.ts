import path from 'path';
import { test, expect } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';
import { ALICE, decode, nameMockOptions } from './helpers/nameMocks';

const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;
const SHOTS = process.env.NAMES_SHOTS; // directory for after-15-*.png

describe('Extension popup .boing names (E2E, mocked RPC)', () => {
  test('create wallet -> pick a name -> claimed once funded; primary name above address', async () => {
    const submitted: string[] = [];
    const me = { hex: '' };
    const { popup, close } = await openPopupWithNewWallet(nameMockOptions(submitted, me), {
      beforeClaimName: async (p) => {
        const step = p.locator('#screen-claim-name:not(.hidden)');
        await expect(step.getByTestId('wallet-claim-name')).toBeVisible({ timeout: 30_000 });
        await step.getByTestId('wallet-claim-name-input').fill('alice');
        await expect(step.getByTestId('wallet-claim-name-status')).toHaveText('alice.boing is taken');
        await step.getByTestId('wallet-claim-name-input').fill('Nico-Ext');
        await expect(step.getByTestId('wallet-claim-name-status')).toContainText('nico-ext.boing is available');
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'after-15-popup-claim-name.png'), fullPage: true });
        await step.getByTestId('wallet-claim-name-reserve').click();
      },
    });
    try {
      await expect(popup.getByTestId('wallet-primary-name')).toHaveText('nico-ext.boing', { timeout: 45_000 });
      await expect(popup.getByTestId('pending-name')).toHaveCount(0);
      expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
      expect(decode(submitted[1]!).name).toBe('nico-ext');
      await popup.waitForTimeout(800); // let the dashboard fade-in finish
      if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'after-15-popup-primary-name.png'), fullPage: true });
    } finally {
      await close();
    }
  });

  test('Settings -> Names: claim a name, becomes primary', async () => {
    const submitted: string[] = [];
    const me = { hex: '' };
    const { popup, close } = await openPopupWithNewWallet(nameMockOptions(submitted, me));
    try {
      await popup.getByTestId('wallet-header-settings').click();
      const panel = popup.getByTestId('settings-names');
      await expect(panel.getByTestId('names-empty')).toBeVisible({ timeout: 15_000 });
      await panel.getByTestId('names-query').fill('boingfan');
      await expect(panel.getByTestId('names-availability')).toContainText('boingfan.boing is available');
      await panel.getByTestId('names-claim').click();
      await expect(panel.getByTestId('names-ok')).toContainText('boingfan.boing is yours', { timeout: 30_000 });
      await expect(panel.getByTestId('names-row')).toHaveCount(1);
      await expect(panel.getByTestId('names-row')).toContainText('primary');
      expect(submitted.map((h) => decode(h).variant)).toEqual([13, 14, 18]);
      await panel.scrollIntoViewIfNeeded();
      if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'after-15-popup-settings-names.png'), fullPage: true });
      await popup.getByTestId('wallet-tab-wallet').click();
      await expect(popup.getByTestId('wallet-primary-name')).toHaveText('boingfan.boing', { timeout: 15_000 });
    } finally {
      await close();
    }
  });

  test('send BOING to a name shows the resolved address on review', async () => {
    const submitted: string[] = [];
    const { popup, close } = await openPopupWithNewWallet(nameMockOptions(submitted, { hex: '' }));
    try {
      await popup.getByTestId('wallet-tab-transfer').click();
      await popup.getByTestId('send-to').fill('bob.boing');
      await popup.getByTestId('send-amount').fill('5');
      await popup.getByTestId('send-submit').click();
      await expect(popup.locator('#send-error')).toContainText('bob.boing is not registered');
      await popup.getByTestId('send-to').fill('alice.boing');
      await popup.getByTestId('send-submit').click();
      await expect(popup.getByTestId('send-confirm-to-name')).toHaveText('alice.boing', { timeout: 15_000 });
      await expect(popup.getByTestId('send-confirm-to')).toHaveAttribute('title', `0x${ALICE}`);
      if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'after-15-popup-send-to-name.png'), fullPage: true });
      await popup.getByTestId('send-confirm-submit').click();
      await expect.poll(() => submitted.length, { timeout: 30_000 }).toBe(1);
      expect(submitted[0]!).toContain(ALICE);
    } finally {
      await close();
    }
  });
});