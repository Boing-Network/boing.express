import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNetworkInfoCaches } from '../src/boing/networkInfo';
import { MAX_CUSTOM_TIP } from '../src/boing/feeTips';
import { applyChosenTip, planTip, tipPlanFromWire, tipPlanToWire } from '../src/boing/tipPlan';
import type { Transaction } from '../src/boing/types';

const base = (over: Partial<Transaction> = {}): Transaction => ({ ...(({ nonce: 1n, payload: { type: 'transfer', to: new Uint8Array(32), amount: 1n } }) as unknown as Transaction), ...over });
const fee = { amount: 210_000_000_000_000n, decimals: 18, exact: true };

function stubPolicy(result: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init?: { body?: string }) => {
      const id = JSON.parse(String(init?.body ?? '{}')).id;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }),
  );
}

describe('planTip', () => {
  beforeEach(() => clearNetworkInfoCaches());
  afterEach(() => vi.unstubAllGlobals());

  it('allows the chooser by default and carries the fee', async () => {
    stubPolicy({ optional_priority_tips: true });
    expect(await planTip('https://rpc.test/1', base(), { decimals: 18, fee })).toEqual({ allowed: true, fee: fee.amount });
  });
  it('hides the chooser when the node disallows tips', async () => {
    stubPolicy({ optional_priority_tips: false });
    expect((await planTip('https://rpc.test/2', base(), { decimals: 18, fee })).allowed).toBe(false);
  });
  it('hides the chooser on ledgers below 18 decimals', async () => {
    stubPolicy({});
    expect((await planTip('https://rpc.test/3', base(), { decimals: 0 })).allowed).toBe(false);
  });
  it('a tip set by the dApp wins and is shown read-only', async () => {
    stubPolicy({});
    const p = await planTip('https://rpc.test/4', base({ priorityTip: 7n }), { decimals: 18, fee });
    expect(p).toMatchObject({ allowed: false, locked: 7n });
  });
});

describe('wire format', () => {
  it('round-trips and rejects junk', () => {
    const p = { allowed: true, locked: 5n, fee: 9n };
    expect(tipPlanFromWire(tipPlanToWire(p))).toEqual(p);
    expect(tipPlanFromWire(undefined)).toEqual({ allowed: false, locked: undefined, fee: null });
    expect(tipPlanFromWire({ allowed: true, locked: '-1', fee: 'x' } as never)).toEqual({ allowed: true, locked: undefined, fee: null });
  });
});

describe('applyChosenTip', () => {
  const allowed = { allowed: true, fee: null };
  it('applies a valid chosen tip', () => {
    expect(applyChosenTip(base(), allowed, 1000n).priorityTip).toBe(1000n);
    expect(applyChosenTip(base(), allowed, '1000').priorityTip).toBe(1000n);
  });
  it('ignores zero, junk, over-cap and negative values', () => {
    for (const v of [0n, '0', 'abc', '-5', undefined, null, {}, MAX_CUSTOM_TIP + 1n]) {
      expect(applyChosenTip(base(), allowed, v).priorityTip).toBeUndefined();
    }
  });
  it('does nothing when the plan disallows tips or the dApp already set one', () => {
    expect(applyChosenTip(base(), { allowed: false, fee: null }, 1000n).priorityTip).toBeUndefined();
    expect(applyChosenTip(base({ priorityTip: 3n }), allowed, 1000n).priorityTip).toBe(3n);
  });
});

describe('planTip against the documented capability flags', () => {
  beforeEach(() => clearNetworkInfoCaches());
  afterEach(() => vi.unstubAllGlobals());
  const stubBoth = (health: unknown, policy: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { body?: string }) => {
        const b = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: b.method === 'boing_health' ? health : policy }));
      }),
    );
  it('hides the chooser when boing_health says tx_signing.priority_tips_supported is false', async () => {
    stubBoth({ tx_signing: { priority_tips_supported: false } }, { optional_priority_tips: true });
    expect((await planTip('https://rpc.test/5', base(), { decimals: 18, fee })).allowed).toBe(false);
  });
  it('hides the chooser when the node advertises a different tip domain', async () => {
    stubBoth({ tx_signing: { priority_tips_supported: true, priority_tip_domain: 'BOING_TX_OTHER' } }, {});
    expect((await planTip('https://rpc.test/6', base(), { decimals: 18, fee })).allowed).toBe(false);
  });
  it('shows it for the real documented health shape', async () => {
    stubBoth({ tx_signing: { priority_tips_supported: true, priority_tip_domain: 'BOING_TX_PRIORITY' } }, { optional_priority_tips: true });
    expect((await planTip('https://rpc.test/7', base(), { decimals: 18, fee })).allowed).toBe(true);
  });
});