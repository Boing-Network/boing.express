import { describe, expect, it } from 'vitest';
import { encodeTransactionPayload } from '@boing-network/boing-sdk';
import { encodePayload } from './bincode';
import {
  buildTransactionApprovalDetail,
  transactionFromDappJson,
  transactionSummary,
} from './dappTxRequest';

const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
const SENDER = new Uint8Array(32).fill(0xd6);
const REG = '0x' + 'eb'.repeat(32);
const word = (sel: number, ...accts: string[]) =>
  '0x' + '00'.repeat(31) + sel.toString(16).padStart(2, '0') + accts.map((a) => a.replace(/^0x/, '')).join('');

describe('dApp batch payload', () => {
  const req = {
    type: 'batch',
    calls: [
      { type: 'contract_call', contract: REG, calldata: word(0xe0, '0x' + '63'.repeat(32)) },
      { type: 'contract_call', contract: REG, calldata: word(0xe0, '0x' + '98'.repeat(32)) },
      { type: 'contract_call', contract: REG, calldata: word(0xe1, '0x' + '63'.repeat(32), '0x' + '98'.repeat(32)) },
      { type: 'transfer', to: '0x' + '22'.repeat(32), amount: '5' },
    ],
  };

  it('parses into one batch tx with a 4-step approval breakdown', () => {
    const tx = transactionFromDappJson(req, SENDER, 3n);
    expect(tx.payload.kind).toBe('batch');
    expect(tx.nonce).toBe(3n);
    const d = buildTransactionApprovalDetail(tx);
    expect(d.txType).toBe('batch');
    expect(d.rows.filter((r) => r.label.startsWith('Step '))).toHaveLength(4);
    expect(transactionSummary(tx)).toContain('Batch of 4 steps');
    // Access list covers sender + registry + transfer recipient.
    expect(tx.access_list.write).toHaveLength(3);
  });

  it('encodes byte-identically to boing-sdk (Rust variant 9)', () => {
    const tx = transactionFromDappJson(req, SENDER, 0n);
    if (tx.payload.kind !== 'batch') throw new Error('not batch');
    const sdk = encodeTransactionPayload({
      kind: 'batch',
      calls: tx.payload.calls.map((c) =>
        c.kind === 'transfer'
          ? { kind: 'transfer' as const, to: c.to, amount: c.amount }
          : { kind: 'contractCall' as const, contract: c.contract, calldata: c.calldata }
      ),
    });
    expect(hex(encodePayload(tx.payload))).toBe(hex(sdk));
    expect(hex(encodePayload(tx.payload)).slice(0, 8)).toBe('09000000');
  });

  it('rejects empty, oversized and unknown-step batches', () => {
    expect(() => transactionFromDappJson({ type: 'batch', calls: [] }, SENDER, 0n)).toThrow(/non-empty/);
    const many = Array.from({ length: 17 }, () => ({ type: 'transfer', to: '0x' + '22'.repeat(32), amount: '1' }));
    expect(() => transactionFromDappJson({ type: 'batch', calls: many }, SENDER, 0n)).toThrow(/max is 16/);
    expect(() => transactionFromDappJson({ type: 'batch', calls: [{ type: 'bond', amount: '1' }] }, SENDER, 0n)).toThrow(
      /transfer or contract_call/
    );
  });
});