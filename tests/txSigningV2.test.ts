/** Security fix #2: v2 chain-bound signing. Golden vector shared with the Rust node and boing-sdk. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { signableHash, signableHashV2, signTransaction, signingChainIdForRpc, clearSigningChainIdCache, registerConfiguredSigningChainId } from '../src/boing/signing';
import type { Transaction } from '../src/boing/types';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

async function fixture(): Promise<{ tx: Transaction; sk: Uint8Array }> {
  const sk = new Uint8Array(32).fill(7);
  const sender = await ed.getPublicKeyAsync(sk);
  return {
    sk,
    tx: { nonce: 3n, sender, payload: { kind: 'transfer', to: new Uint8Array(32).fill(9), amount: 5n }, access_list: { read: [], write: [] } } as Transaction,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearSigningChainIdCache();
});

describe('v2 signing', () => {
  it('matches the Rust golden vector', async () => {
    const { tx } = await fixture();
    expect(hex(signableHashV2(tx, 6913n))).toBe('d88a23702aa0c376d9e0f3b6a2c2948058fecda14b95d26843f5f902ece87899');
  });

  it('a testnet signature does not verify for mainnet; legacy is different', async () => {
    const { tx, sk } = await fixture();
    const sig = await signTransaction(tx, sk, 6913n);
    expect(await ed.verifyAsync(sig, signableHashV2(tx, 6913n), tx.sender)).toBe(true);
    expect(await ed.verifyAsync(sig, signableHashV2(tx, 6914n), tx.sender)).toBe(false);
    expect(await ed.verifyAsync(sig, signableHash(tx), tx.sender)).toBe(false);
  });

  it('reads the chain id from boing_health.tx_signing, null for older nodes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { tx_signing: { v2_supported: true, chain_id: 6913 } } }))));
    expect(await signingChainIdForRpc('http://a')).toBe(6913n);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { ok: true } }))));
    expect(await signingChainIdForRpc('http://b')).toBeNull();
  });
});

describe('signingChainIdForRpc resilience', () => {
  it('falls back to the configured chain id when the probe fails (never legacy on a chain-bound network)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    registerConfiguredSigningChainId('http://down', 6913n);
    expect(await signingChainIdForRpc('http://down')).toBe(6913n);
    expect(await signingChainIdForRpc('http://down-unconfigured')).toBeNull();
  });

  it('does not pin a failed probe for a full minute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await signingChainIdForRpc('http://flaky')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { tx_signing: { v2_supported: true, chain_id: 6913 } } }))));
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6_000);
    expect(await signingChainIdForRpc('http://flaky')).toBe(6913n);
    spy.mockRestore();
  });
});
