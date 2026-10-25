/**
 * Tipped signing parity. A non-zero priority tip signs a different digest (domain "BOING_TX_PRIORITY",
 * 16-byte little-endian tip appended) and serializes as a trailing u128 on the SignedTransaction; a zero
 * tip must be byte-identical to the untipped v2 transaction (the field is skipped, as in Rust
 * `skip_serializing_if = is_zero_u128`).
 *
 * The Rust-generated golden vectors from boing.network are checked in tests/txSigningGolden.test.ts (vendored
 * fixture, `pnpm fixtures:sync`). The vectors below were computed with @boing-network/boing-sdk and are re-derived
 * from the documented byte layout with an independent BLAKE3 call, so this file also covers SDK-equals-wallet and
 * the wire-format edge cases (zero tip, high u128 half) the shared fixture does not.
 */
import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import * as sdk from '@boing-network/boing-sdk';
import { blake3 } from '@noble/hashes/blake3.js';
import { encodePayload, encodeSignedTransaction, encodeTransaction } from '../src/boing/bincode';
import { signableHashV2, signableHashWithTip, signTransaction } from '../src/boing/signing';
import type { Transaction } from '../src/boing/types';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const SK = new Uint8Array(32).fill(7);
const CHAIN = 6913n;

const TIPPED_VECTORS = [
  { source: 'boing-sdk 0.5.x', tip: 1n, digest: '5cca6a6903192d280815986a78d89496cb82c89bb8b0f77a02ee5d71aa0f9d5b', signature: '4f0f9c7d94d1dfcc98fc8d69220bf1100e47a5a6ac06f1ec312dc001bd445e0ff210e21ac616c30a36bfff3e791b7d3b2717cc072f6e28d1aa0fb0861f05090f' },
  { source: 'boing-sdk 0.5.x', tip: 250n, digest: '0fdac06046f9e9d4920c84acfa2f3d35d81906a9c85fb491b2d4aa1b4a057efd', signature: '8b996b42d8f7ef43e0b165895a89c8aab6d6d0c1f969f66836f97d06a02fe704ffad81ee6d660fc01194ca7d36cb2bf4e25bba4d09ba65116e5843afdda3240f' },
  // Above 2^64: exercises the high half of the u128 little-endian tip.
  { source: 'boing-sdk 0.5.x', tip: (1n << 64n) + 5n, digest: 'b1bbc225d8c1c00a4257e6a8e415835c19032b8ee7aea557979e7db60878adce', signature: '0ebc4f6416c145db1daf3a15a56963af3cdb2ca16f3156b8cd687b24aa1ee514ba15da38cd50dac61c7dd9f9de5e550d895eae7c33a89a46593ee906b2fa9c03' },
] as const;

async function fixture(tip?: bigint): Promise<Transaction> {
  const sender = await ed.getPublicKeyAsync(SK);
  return {
    nonce: 3n,
    sender,
    payload: { kind: 'transfer', to: new Uint8Array(32).fill(9), amount: 5n },
    access_list: { read: [], write: [] },
    ...(tip ? { priorityTip: tip } : {}),
  } as Transaction;
}

function le(n: bigint, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return out;
}

/** BLAKE3("BOING_TX_PRIORITY" || chain_id_le8 || nonce_le8 || sender32 || bincode(payload) || bincode(access_list) || tip_le16). */
function documentedDigest(tx: Transaction, chain: bigint, tip: bigint): Uint8Array {
  const parts = [
    new TextEncoder().encode('BOING_TX_PRIORITY'),
    le(chain, 8),
    le(tx.nonce, 8),
    tx.sender,
    encodePayload(tx.payload),
    new Uint8Array(16), // empty read + write Vec<[u8;32]>
    le(tip, 16),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return blake3(out);
}

describe('tipped signing digest', () => {
  it('domain string is 17 bytes', () => {
    expect(new TextEncoder().encode('BOING_TX_PRIORITY').length).toBe(17);
    expect(new TextDecoder().decode(sdk.TX_SIGNING_DOMAIN_PRIORITY)).toBe('BOING_TX_PRIORITY');
  });

  it.each(TIPPED_VECTORS)('golden vector, tip $tip', async ({ tip, digest, signature }) => {
    const tx = await fixture(tip);
    expect(hex(signableHashWithTip(tx, CHAIN))).toBe(digest);
    expect(hex(documentedDigest(tx, CHAIN, tip))).toBe(digest);
    expect(hex(await signTransaction(tx, SK, CHAIN))).toBe(signature); // Ed25519 is deterministic
  });

  it('a tip changes the digest, and the tip is bound (different tips never share a digest)', async () => {
    const base = hex(signableHashV2(await fixture(), CHAIN));
    const digests = TIPPED_VECTORS.map((v) => v.digest);
    expect(new Set([base, ...digests]).size).toBe(digests.length + 1);
  });

  it('a tipped digest is chain-bound too', async () => {
    const tx = await fixture(250n);
    expect(hex(signableHashWithTip(tx, 6914n))).not.toBe(hex(signableHashWithTip(tx, 6913n)));
    expect(hex(signableHashWithTip(tx, 6914n))).toBe(hex(documentedDigest(tx, 6914n, 250n)));
  });

  it('refuses to sign a tip on the legacy (no chain id) path', async () => {
    await expect(signTransaction(await fixture(250n), SK, null)).rejects.toThrow(/chain-bound|v2/i);
  });
});

describe('tip serialization (SignedTransaction)', () => {
  it('omits the tip entirely when zero: encoding equals the untipped transaction + signature', async () => {
    const tx = await fixture();
    const sig = await signTransaction(tx, SK, CHAIN);
    const zero = encodeSignedTransaction({ tx: { ...tx, priorityTip: 0n }, signature: sig });
    const none = encodeSignedTransaction({ tx, signature: sig });
    expect(hex(zero)).toBe(hex(none));
    expect(zero.length).toBe(encodeTransaction(tx).length + 8 + 64); // tx || u64(64) || sig, no trailing tip
  });

  it('appends exactly 16 LE bytes when the tip is non-zero', async () => {
    for (const { tip } of TIPPED_VECTORS) {
      const tx = await fixture(tip);
      const sig = await signTransaction(tx, SK, CHAIN);
      const bytes = encodeSignedTransaction({ tx, signature: sig });
      const untipped = encodeSignedTransaction({ tx: { ...tx, priorityTip: 0n }, signature: sig });
      expect(bytes.length).toBe(untipped.length + 16);
      expect(hex(bytes.subarray(0, untipped.length))).toBe(hex(untipped));
      expect(hex(bytes.subarray(untipped.length))).toBe(hex(le(tip, 16)));
    }
  });

  it('wallet bytes equal the SDK bytes for tipped and untipped', async () => {
    for (const tip of [undefined, ...TIPPED_VECTORS.map((v) => v.tip)]) {
      const tx = await fixture(tip);
      const sig = await signTransaction(tx, SK, CHAIN);
      const sdkTx = { nonce: tx.nonce, sender: tx.sender, payload: { kind: 'transfer' as const, to: new Uint8Array(32).fill(9), amount: 5n }, accessList: { read: [], write: [] }, ...(tip ? { priorityTip: tip } : {}) };
      expect(hex(encodeSignedTransaction({ tx, signature: sig }))).toBe(hex(sdk.encodeSignedTransaction(sdkTx, sig)));
    }
  });
});