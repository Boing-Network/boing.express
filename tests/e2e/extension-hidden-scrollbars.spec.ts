import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openPopupWithNewWallet } from './helpers/popup';

/** Extension UI hides scrollbars (scrollbar-width: none + ::-webkit-scrollbar) but keeps scrolling working. */
const RUN = process.env.EXTENSION_E2E_FULL === '1';
const describe = RUN ? test.describe : test.describe.skip;
const shotDir = process.env.E2E_SHOT_DIR ?? path.join('test-results', 'shots');

/**
 * Width the scrollbar takes: clientWidth with overflow forced hidden (never a scrollbar) minus clientWidth as styled.
 * Exact at any display scaling, unlike offsetWidth - clientWidth - borders (integer vs fractional px). The raw
 * offsetWidth - clientWidth is returned too; with no scrollbar it is only the (1px) borders.
 */
async function scrollbarWidth(el: Locator): Promise<{ gutter: number; offsetMinusClient: number }> {
  return el.evaluate((n) => {
    const e = n as HTMLElement;
    const asStyled = e.clientWidth;
    const offsetMinusClient = e.offsetWidth - e.clientWidth;
    const prev = e.style.overflowY;
    e.style.overflowY = 'hidden';
    const noBar = e.clientWidth;
    e.style.overflowY = prev;
    return { gutter: noBar - asStyled, offsetMinusClient };
  });
}

async function docScrollbar(page: Page): Promise<{ html: string; body: string; gutter: number }> {
  return page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).scrollbarWidth,
    body: getComputedStyle(document.body).scrollbarWidth,
    gutter: document.documentElement.offsetWidth - document.documentElement.clientWidth,
  }));
}

describe('Extension hidden scrollbars (E2E, mocked RPC)', () => {
  test('popup + approval: no scrollbar width, wheel and keyboard still scroll', async () => {
    test.setTimeout(150_000);
    fs.mkdirSync(shotDir, { recursive: true });
    const { context, popup, close } = await openPopupWithNewWallet({ submitted: [], batchSupport: true });
    try {
      // Popup page: scrollbars hidden on the document and on inner containers.
      const pd = await docScrollbar(popup);
      expect(pd).toEqual({ html: 'none', body: 'none', gutter: 0 });
      const body = popup.locator('body');
      expect((await scrollbarWidth(body)).gutter).toBe(0);
      expect((await scrollbarWidth(body)).offsetMinusClient).toBe(0);
      const inner = await popup.evaluate(() => getComputedStyle(document.querySelector('#app') ?? document.body).scrollbarWidth);
      expect(inner).toBe('none');
      await popup.screenshot({ path: path.join(shotDir, 'popup-dashboard.png') });
      // body's overflow propagates to the viewport, so the document (or body) is the scroller.
      const pageScrollTop = () => popup.evaluate(() => (document.scrollingElement?.scrollTop ?? 0) + document.body.scrollTop);
      if (await body.evaluate((b) => b.scrollHeight > b.clientHeight)) {
        await popup.mouse.move(190, 300);
        await popup.mouse.wheel(0, 400);
        await expect.poll(pageScrollTop).toBeGreaterThan(0);
        await popup.screenshot({ path: path.join(shotDir, 'popup-dashboard-scrolled.png') });
      }

      // Approval window: a 16-step batch overflows the tx table box.
      const dapp = await context.newPage();
      await dapp.goto('http://127.0.0.1:3333/dapp.html', { waitUntil: 'domcontentloaded' });
      await dapp.waitForFunction(() => !!(window as unknown as { boing?: unknown }).boing, null, { timeout: 30_000 });
      await dapp.evaluate(() =>
        (window as unknown as { boing: { request: (a: unknown) => Promise<string[]> } }).boing.request({ method: 'boing_requestAccounts' })
      );
      const approvalP = context.waitForEvent('page', { timeout: 30_000 });
      const sendP = dapp
        .evaluate(() => {
          const calls = Array.from({ length: 16 }, (_, i) => ({
            type: 'transfer',
            to: '0x' + (i + 16).toString(16).padStart(2, '0').repeat(32),
            amount: String(i + 1),
          }));
          return (window as unknown as { boing: { request: (x: unknown) => Promise<unknown> } }).boing.request({
            method: 'boing_sendTransaction',
            params: [{ type: 'batch', calls }],
          });
        })
        .catch((e) => e);
      const approval = await approvalP;
      await approval.waitForLoadState('domcontentloaded');
      await expect(approval.locator('#approval-tx-tbody')).toContainText('Step 16');

      const ad = await docScrollbar(approval);
      expect(ad).toEqual({ html: 'none', body: 'none', gutter: 0 });

      const wrap = approval.locator('.tx-table-wrap');
      const dims = await wrap.evaluate((n) => ({ sh: n.scrollHeight, ch: n.clientHeight, oy: getComputedStyle(n).overflowY }));
      expect(dims.sh).toBeGreaterThan(dims.ch);
      expect(['auto', 'scroll']).toContain(dims.oy);
      const sb = await scrollbarWidth(wrap);
      expect(sb.gutter).toBe(0);
      expect(sb.offsetMinusClient).toBeLessThanOrEqual(2); // just the 1px borders (no 6px+ scrollbar)
      expect(await wrap.evaluate((n) => getComputedStyle(n).scrollbarWidth)).toBe('none');
      // The table uses the full box width (nothing hidden behind a scrollbar gutter).
      const fit = await wrap.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
      expect(fit.sw).toBeLessThanOrEqual(fit.cw);
      await approval.screenshot({ path: path.join(shotDir, 'approval-top.png') });

      // Mouse wheel / touchpad (wheel events) scroll the box.
      const box = (await wrap.boundingBox())!;
      await approval.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await approval.mouse.wheel(0, 300);
      await expect.poll(() => wrap.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
      await approval.screenshot({ path: path.join(shotDir, 'approval-table-scrolled.png') });

      // Keyboard: the scroller takes focus and arrow / PageDown keys scroll it.
      await wrap.evaluate((n) => (n.scrollTop = 0));
      await wrap.evaluate((n) => (n as HTMLElement).focus());
      const focused = await wrap.evaluate((n) => document.activeElement === n);
      if (!focused) await wrap.locator('th').first().click();
      await approval.keyboard.press('PageDown');
      await expect.poll(() => wrap.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);

      // The last row is reachable (not cut off).
      await wrap.evaluate((n) => (n.scrollTop = n.scrollHeight));
      await expect(approval.locator('#approval-tx-tbody tr', { hasText: 'Step 16' })).toBeInViewport();
      await approval.screenshot({ path: path.join(shotDir, 'approval-table-bottom.png') });

      // Focus outlines are untouched: keyboard focus on the Approve button still draws the focus ring.
      await approval.locator('#btn-reject').focus();
      await approval.keyboard.press('Tab');
      const ring = await approval.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a) return null;
        const cs = getComputedStyle(a);
        return { id: a.id, outline: cs.outlineStyle, shadow: cs.boxShadow };
      });
      expect(ring?.id).toBe('btn-approve');
      expect(ring!.outline !== 'none' || ring!.shadow !== 'none').toBe(true);
      await approval.screenshot({ path: path.join(shotDir, 'approval-focus.png'), fullPage: true });

      await approval.locator('#btn-reject').click();
      await sendP;
    } finally {
      await close();
    }
  });
});
