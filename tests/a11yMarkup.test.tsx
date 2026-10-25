import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SendConfirm } from '../src/components/SendConfirm';
import { nextTabId } from '../src/components/tabNav';

describe('nextTabId (tablist keyboard model)', () => {
  const ids = ['wallet', 'transactions', 'transfer'] as const;
  it('moves right/left with wrap-around', () => {
    expect(nextTabId(ids, 'wallet', 'ArrowRight')).toBe('transactions');
    expect(nextTabId(ids, 'transfer', 'ArrowRight')).toBe('wallet');
    expect(nextTabId(ids, 'wallet', 'ArrowLeft')).toBe('transfer');
    expect(nextTabId(ids, 'transactions', 'ArrowLeft')).toBe('wallet');
  });
  it('jumps with Home/End and ignores other keys', () => {
    expect(nextTabId(ids, 'transactions', 'Home')).toBe('wallet');
    expect(nextTabId(ids, 'transactions', 'End')).toBe('transfer');
    expect(nextTabId(ids, 'transactions', 'Enter')).toBeNull();
    expect(nextTabId(ids, 'transactions', 'a')).toBeNull();
  });
  it('is safe for an empty list and an unknown current tab (e.g. Settings is open)', () => {
    expect(nextTabId([], 'x', 'ArrowRight')).toBeNull();
    expect(nextTabId(ids, 'settings' as never, 'ArrowRight')).toBe('transactions');
  });
});

describe('SendConfirm markup (accessibility + loading state)', () => {
  const network = { config: { rpcUrl: 'https://rpc.example', name: 'Testnet' } } as never;
  const html = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(SendConfirm, {
        title: 'Send BOING',
        to: 'ab'.repeat(32),
        amount: '1 BOING',
        network,
        buildSigned: async () => '00',
        onConfirm: () => {},
        onBack: () => {},
        ...extra,
      })
    );

  it('is a labelled region whose heading can receive programmatic focus', () => {
    const h = html();
    expect(h).toContain('aria-label="Send BOING: review"');
    expect(h).toMatch(/<h2[^>]*tabindex="-1"/);
  });

  it('shows an announced, busy fee row while the fee is being estimated', () => {
    const h = html();
    expect(h).toMatch(/data-testid="send-confirm-fee"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
    expect(h).toContain('Estimating');
  });

  it('labels the back button and marks the confirm button busy while sending', () => {
    const h = html({ busy: true });
    expect(h).toContain('aria-label="Back to edit"');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*data-testid="send-confirm-submit"/);
  });

  it('announces errors as alerts', () => {
    const h = html({ error: 'Nonce too low' });
    expect(h).toMatch(/role="alert"[^>]*data-testid="send-confirm-error"/);
    expect(h).toContain('Nonce too low');
  });
});