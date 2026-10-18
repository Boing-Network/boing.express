import { describe, expect, it } from 'vitest';
import { encodePayload } from './bincode';
import { buildTransactionApprovalDetail, payloadCallValue, transactionFromDappJson, transactionSummary } from './dappTxRequest';

const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
const SENDER = new Uint8Array(32).fill(0xd6);
const C = '0x' + '11'.repeat(32);
const ONE = 10n ** 18n;
const le = (v: bigint, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Number((v >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0');
  return s;
};

describe('contract calls carrying native BOING (value)', () => {
  it('encodes ContractCallWithValue as Rust variant 20 (same bytes as the node test)', () => {
    const tx = transactionFromDappJson({ type: 'contract_call', contract: C, calldata: '0xaabb', value: (5n * ONE).toString() }, SENDER, 0n);
    expect(hex(encodePayload(tx.payload))).toBe(le(20n, 4) + '11'.repeat(32) + le(2n, 8) + 'aabb' + le(5n * ONE, 16));
  });

  it('a zero or missing value stays a plain ContractCall (variant 1)', () => {
    for (const value of [undefined, '0']) {
      const tx = transactionFromDappJson({ type: 'contract_call', contract: C, calldata: '0xaabb', value }, SENDER, 0n);
      expect(hex(encodePayload(tx.payload)).slice(0, 8)).toBe(le(1n, 4));
    }
  });

  it('encodes a value batch step as BatchCall 2', () => {
    const tx = transactionFromDappJson(
      { type: 'batch', calls: [{ type: 'contract_call', contract: C, calldata: '0xaabb', value: (5n * ONE).toString() }] },
      SENDER,
      0n,
    );
    expect(hex(encodePayload(tx.payload))).toBe(le(9n, 4) + le(1n, 8) + le(2n, 4) + '11'.repeat(32) + le(2n, 8) + 'aabb' + le(5n * ONE, 16));
  });

  it('shows the value in BOING on the approval', () => {
    const tx = transactionFromDappJson({ type: 'contract_call', contract: C, calldata: '0x' + '00'.repeat(31) + '20', value: ONE.toString() }, SENDER, 0n);
    const d = buildTransactionApprovalDetail(tx);
    expect(d.rows.find((r) => r.label === 'BOING sent to contract')?.value).toBe('1 BOING');
    expect(transactionSummary(tx)).toContain('sending 1 BOING');
    expect(payloadCallValue(tx.payload)).toBe(ONE);
  });

  it('batch approval lists each step value and the total', () => {
    const tx = transactionFromDappJson(
      {
        type: 'batch',
        calls: [
          { type: 'contract_call', contract: C, calldata: '0x' + '00'.repeat(31) + '20', value: (3n * ONE / 2n).toString() },
          { type: 'contract_call', contract: C, calldata: '0x' + '00'.repeat(31) + '08' },
        ],
      },
      SENDER,
      0n,
    );
    const d = buildTransactionApprovalDetail(tx);
    expect(d.rows.find((r) => r.label === 'Step 1')?.value).toContain('sending 1.5 BOING');
    expect(d.rows.find((r) => r.label === 'BOING sent to contracts')?.value).toBe('1.5 BOING');
  });

  it('rejects values outside u128', () => {
    expect(() => transactionFromDappJson({ type: 'contract_call', contract: C, calldata: '0x', value: (1n << 128n).toString() }, SENDER, 0n)).toThrow();
    expect(() => transactionFromDappJson({ type: 'contract_call', contract: C, calldata: '0x', value: '-1' }, SENDER, 0n)).toThrow();
  });
});
