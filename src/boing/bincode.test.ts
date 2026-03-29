import { describe, it, expect } from 'vitest';
import { encodePayload, encodeAccessList, encodeTransaction } from './bincode';
import type { Transaction } from './types';

function toHex(u: Uint8Array): string {
  return Array.from(u)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const ones = new Uint8Array(32).fill(1);

describe('bincode vs Rust boing-primitives (see crates/boing-primitives/examples/dump_bincode.rs)', () => {
  it('encodes Transfer payload', () => {
    const p = encodePayload({ kind: 'transfer', to: ones, amount: 100n });
    expect(toHex(p)).toBe(
      '00000000010101010101010101010101010101010101010101010101010101010101010164000000000000000000000000000000'
    );
  });

  it('encodes ContractDeploy payload', () => {
    const p = encodePayload({ kind: 'contract_deploy', bytecode: new Uint8Array([0xde, 0xad]) });
    expect(toHex(p)).toBe('020000000200000000000000dead');
  });

  it('encodes Bond payload', () => {
    const p = encodePayload({ kind: 'bond', amount: 1n });
    expect(toHex(p)).toBe('0500000001000000000000000000000000000000');
  });

  it('encodes empty AccessList', () => {
    const a = encodeAccessList({ read: [], write: [] });
    expect(toHex(a)).toBe('00000000000000000000000000000000');
  });

  it('encodes Transaction with transfer', () => {
    const tx: Transaction = {
      nonce: 7n,
      sender: ones,
      payload: { kind: 'transfer', to: new Uint8Array(32).fill(2), amount: 9n },
      access_list: { read: [], write: [] },
    };
    const b = encodeTransaction(tx);
    expect(b.length).toBe(108);
    expect(toHex(b.subarray(0, 8))).toBe('0700000000000000');
  });
});
