/**
 * Wire-format parity: the wallet's own bincode encoder/signer must produce byte-identical output to
 * @boing-network/boing-sdk (which tracks the Rust node). Guards against drift on every SDK bump.
 */
import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import * as sdk from '@boing-network/boing-sdk';
import { encodeSignedTransaction, encodeTransaction } from '../src/boing/bincode';
import { signableHashV2, signableHashWithTip, signTransaction } from '../src/boing/signing';
import type { Payload, Transaction } from '../src/boing/types';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const acct = (n: number) => new Uint8Array(32).fill(n);

type SdkPayload = Parameters<typeof sdk.encodeTransaction>[0]['payload'];

const CASES: Array<{ name: string; wallet: Payload; sdk: SdkPayload }> = [
  { name: 'transfer', wallet: { kind: 'transfer', to: acct(9), amount: 1234567890123456789012n }, sdk: { kind: 'transfer', to: acct(9), amount: 1234567890123456789012n } },
  { name: 'contract_call', wallet: { kind: 'contract_call', contract: acct(4), calldata: new Uint8Array([1, 2, 3]) }, sdk: { kind: 'contractCall', contract: acct(4), calldata: new Uint8Array([1, 2, 3]) } },
  { name: 'contract_call with value', wallet: { kind: 'contract_call', contract: acct(4), calldata: new Uint8Array([7]), value: 99n }, sdk: { kind: 'contractCallWithValue', contract: acct(4), calldata: new Uint8Array([7]), value: 99n } },
  { name: 'bond', wallet: { kind: 'bond', amount: 5n }, sdk: { kind: 'bond', amount: 5n } as SdkPayload },
  {
    name: 'batch',
    wallet: { kind: 'batch', calls: [{ kind: 'transfer', to: acct(1), amount: 2n }, { kind: 'contract_call', contract: acct(3), calldata: new Uint8Array([5, 6]), value: 8n }] },
    sdk: { kind: 'batch', calls: [{ kind: 'transfer', to: acct(1), amount: 2n }, { kind: 'contractCallWithValue', contract: acct(3), calldata: new Uint8Array([5, 6]), value: 8n }] },
  },
  {
    name: 'put_blob (media publish)',
    wallet: { kind: 'put_blob', retention: { kind: 'forever' }, contentType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) },
    sdk: { kind: 'putBlob', retention: { kind: 'forever' }, contentType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) },
  },
  {
    name: 'put_blob prunable',
    wallet: { kind: 'put_blob', retention: { kind: 'prunable', ttlBlocks: 1000n }, contentType: 'text/plain', data: new Uint8Array([1]) },
    sdk: { kind: 'putBlob', retention: { kind: 'prunable', ttlBlocks: 1000n }, contentType: 'text/plain', data: new Uint8Array([1]) },
  },
];

async function pair(payload: Payload, sdkPayload: SdkPayload, tip?: bigint) {
  const sk = new Uint8Array(32).fill(7);
  const sender = await ed.getPublicKeyAsync(sk);
  const tx = { nonce: 3n, sender, payload, access_list: { read: [acct(1)], write: [acct(2)] }, ...(tip ? { priorityTip: tip } : {}) } as Transaction;
  const sdkTx = { nonce: 3n, sender, payload: sdkPayload, accessList: { read: [acct(1)], write: [acct(2)] }, ...(tip ? { priorityTip: tip } : {}) };
  return { sk, tx, sdkTx };
}

describe('wallet encoder matches boing-sdk', () => {
  for (const c of CASES) {
    it(`${c.name}: unsigned + signed bytes and v2 signing hash`, async () => {
      const { sk, tx, sdkTx } = await pair(c.wallet, c.sdk);
      expect(hex(encodeTransaction(tx))).toBe(hex(sdk.encodeTransaction(sdkTx)));
      expect(hex(signableHashV2(tx, 6913n))).toBe(hex(sdk.signableTransactionHashV2(sdkTx, 6913n)));
      const sig = await signTransaction(tx, sk, 6913n);
      expect(hex(encodeSignedTransaction({ tx, signature: sig }))).toBe(hex(sdk.encodeSignedTransaction(sdkTx, sig)));
    });
  }

  it('priority tip: signing digest and trailing u128 match the SDK', async () => {
    const { sk, tx, sdkTx } = await pair(CASES[0].wallet, CASES[0].sdk, 250n);
    expect(hex(signableHashWithTip(tx, 6913n))).toBe(hex(sdk.signableTransactionHashWithTip(sdkTx, 6913n, 250n)));
    const sig = await signTransaction(tx, sk, 6913n);
    const walletBytes = encodeSignedTransaction({ tx, signature: sig });
    expect(hex(walletBytes)).toBe(hex(sdk.encodeSignedTransaction(sdkTx, sig)));
    // tip is the final 16 bytes, little-endian
    expect(hex(walletBytes.slice(-16))).toBe('fa000000000000000000000000000000');
  });

  it('a zero tip leaves the legacy v2 encoding untouched', async () => {
    const { sk, tx, sdkTx } = await pair(CASES[0].wallet, CASES[0].sdk, 0n);
    const sig = await signTransaction(tx, sk, 6913n);
    expect(hex(encodeSignedTransaction({ tx, signature: sig }))).toBe(hex(sdk.encodeSignedTransaction(sdkTx, sig)));
    expect(hex(signableHashV2(tx, 6913n))).toBe(hex(sdk.signableTransactionHashV2(sdkTx, 6913n)));
  });
});