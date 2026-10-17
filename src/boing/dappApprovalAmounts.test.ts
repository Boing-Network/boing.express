import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTransactionApprovalDetail, formatNativeBoing, transactionSummary } from './dappTxRequest';
import { approvalAmountContext, feeFromSimulation } from './approvalAmounts';
import type { AccountId, Transaction } from './types';
import { emptyAccessList } from './accessList';

const S = new Uint8Array(32).fill(0x11) as AccountId;
const T = new Uint8Array(32).fill(0x22) as AccountId;
const E18 = 10n ** 18n;
const tx = (payload: Transaction['payload']): Transaction => ({ nonce: 3n, sender: S, payload, access_list: emptyAccessList() });
const row = (d: { rows: { label: string; value: string }[] }, label: string) => d.rows.find((r) => r.label === label)?.value;

describe('dApp approval: native amounts as BOING', () => {
  it('formats base units exactly', () => {
    expect(formatNativeBoing(20n * E18, 18)).toBe('20 BOING');
    expect(formatNativeBoing(1n, 18)).toBe('0.000000000000000001 BOING');
    expect(formatNativeBoing(1_500_000_000_000_000_000n, 18)).toBe('1.5 BOING');
    expect(formatNativeBoing(20n, 0)).toBe('20 BOING');
  });

  it('transfer of 20 BOING (base units) shows 20 BOING + base-unit details line', () => {
    const t = tx({ kind: 'transfer', to: T, amount: 20n * E18 });
    const d = buildTransactionApprovalDetail(t, { decimals: 18 });
    expect(row(d, 'Amount')).toBe('20 BOING');
    expect(row(d, 'Amount (base units)')).toBe('20000000000000000000');
    expect(d.summaryLine).toContain('Transfer 20 BOING to');
    expect(transactionSummary(t)).toContain('Transfer 20 BOING to'); // default: new txs are base units
  });

  it('whole-BOING ledger (before the redenomination height): no base-unit line', () => {
    const d = buildTransactionApprovalDetail(tx({ kind: 'transfer', to: T, amount: 20n }), { decimals: 0 });
    expect(row(d, 'Amount')).toBe('20 BOING');
    expect(row(d, 'Amount (base units)')).toBeUndefined();
  });

  it('bond / unbond', () => {
    const b = buildTransactionApprovalDetail(tx({ kind: 'bond', amount: 100n * E18 }), { decimals: 18 });
    expect(row(b, 'Amount')).toBe('100 BOING');
    expect(b.summaryLine).toContain('Bond 100 BOING stake');
    const u = buildTransactionApprovalDetail(tx({ kind: 'unbond', amount: 25n * E18 / 10n }), { decimals: 18 });
    expect(row(u, 'Amount')).toBe('2.5 BOING');
    expect(u.summaryLine).toContain('Unbond 2.5 BOING stake');
  });

  it('batch transfers are formatted per step and totalled; contract calls untouched', () => {
    const d = buildTransactionApprovalDetail(
      tx({
        kind: 'batch',
        calls: [
          { kind: 'transfer', to: T, amount: 5n * E18 },
          { kind: 'transfer', to: T, amount: 7n * E18 },
          { kind: 'contract_call', contract: T, calldata: new Uint8Array([1, 2, 3]) },
        ],
      }),
      { decimals: 18 }
    );
    expect(row(d, 'Step 1')).toContain('Transfer 5 BOING');
    expect(row(d, 'Step 2')).toContain('Transfer 7 BOING');
    expect(row(d, 'Step 3')).toContain('calldata 3 bytes');
    expect(row(d, 'Total transferred')).toBe('12 BOING');
  });

  it('name register / renew show rent in BOING', () => {
    const reg = buildTransactionApprovalDetail(
      tx({ kind: 'name_register', name: 'alice', salt: new Uint8Array(32), target: S, years: 2 }),
      { decimals: 18 }
    );
    expect(row(reg, 'Rent (burned)')).toBe('4 BOING');
    expect(reg.summaryLine).toContain('rent 4 BOING (burned)');
    const ren = buildTransactionApprovalDetail(tx({ kind: 'name_renew', name: 'abc', years: 1 }), { decimals: 18 });
    expect(row(ren, 'Rent (burned)')).toBe('10 BOING');
  });

  it('network fee row', () => {
    const t = tx({ kind: 'transfer', to: T, amount: E18 });
    const exact = buildTransactionApprovalDetail(t, { decimals: 18, fee: { amount: 21_000n * 10n ** 12n, decimals: 18, exact: true } });
    expect(row(exact, 'Network fee')).toBe('0.021 BOING');
    const est = buildTransactionApprovalDetail(t, { decimals: 18, fee: { amount: 21_000n * 10n ** 12n, decimals: 18, exact: false } });
    expect(row(est, 'Network fee')).toBe('≈ 0.021 BOING');
    expect(row(buildTransactionApprovalDetail(t, { decimals: 18 }), 'Network fee')).toBeUndefined();
  });

  it('feeFromSimulation: network_fee first, else gas × price, null on failure', () => {
    expect(feeFromSimulation({ success: true, network_fee: '21000000000000000', network_fee_decimals: 18 }, 18)).toEqual({
      amount: 21_000_000_000_000_000n, decimals: 18, exact: true,
    });
    expect(feeFromSimulation({ success: true, gas_used: 21000 }, 18)).toEqual({ amount: 21_000_000_000_000_000n, decimals: 18, exact: true });
    expect(feeFromSimulation({ success: false, network_fee: '1' }, 18)).toBeNull();
    expect(feeFromSimulation({ success: true }, 18)).toBeNull();
  });
});

describe('approvalAmountContext (height-aware)', () => {
  afterEach(() => vi.unstubAllGlobals());
  function stubRpc(head: number) {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      const { method, id } = JSON.parse(init.body);
      const result =
        method === 'boing_getNetworkInfo'
          ? { head_height: head, native_currency: { symbol: 'BOING', decimals: 18, base_unit_decimals: 18, base_units_from_height: 1050 } }
          : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
    }));
  }
  it('head H-1 → the tx lands at H → base units (18)', async () => {
    stubRpc(1049);
    const c = await approvalAmountContext('http://rpc-a.test', tx({ kind: 'transfer', to: T, amount: 1n }), null);
    expect(c.decimals).toBe(18);
  });
  it('head well before H → whole BOING (0)', async () => {
    stubRpc(900);
    const c = await approvalAmountContext('http://rpc-b.test', tx({ kind: 'transfer', to: T, amount: 1n }), null);
    expect(c.decimals).toBe(0);
  });
});
