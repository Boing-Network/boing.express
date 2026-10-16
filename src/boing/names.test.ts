import { describe, expect, it } from 'vitest';
import { encodePayload } from './bincode';
import type { Payload } from './types';
import { bytesToHex, looksLikeName, nameCommitment, normalizeName, rentFor, rentPerYear } from './names';

const a = new Uint8Array(32).fill(0x11);

/** Same vectors as boing_primitives::names (Rust) and boing-sdk boingNames.test.ts. */
const VECTORS: [Payload, string][] = [
  [{ kind: 'name_commit', commitment: new Uint8Array(32).fill(0x33) }, '0d000000' + '33'.repeat(32)],
  [
    { kind: 'name_register', name: 'alice', salt: new Uint8Array(32).fill(0x22), target: a, years: 2 },
    '0e0000000500000000000000616c696365' + '22'.repeat(32) + '11'.repeat(32) + '02',
  ],
  [{ kind: 'name_renew', name: 'alice', years: 3 }, '0f0000000500000000000000616c69636503'],
  [{ kind: 'name_transfer', name: 'bob', new_owner: a }, '100000000300000000000000626f62' + '11'.repeat(32)],
  [{ kind: 'name_set_target', name: 'bob', target: a }, '110000000300000000000000626f62' + '11'.repeat(32)],
  [{ kind: 'name_set_primary', name: 'bob' }, '12000000010300000000000000626f62'],
  [{ kind: 'name_set_primary', name: null }, '1200000000'],
  [{ kind: 'name_release', name: 'bob' }, '130000000300000000000000626f62'],
];

describe('name registry', () => {
  it('encodes name payloads exactly like the node', () => {
    for (const [p, hex] of VECTORS) expect(bytesToHex(encodePayload(p))).toBe(hex);
  });
  it('commitment matches the Rust vector', () => {
    expect(bytesToHex(nameCommitment('alice', a, new Uint8Array(32).fill(0x22)))).toBe(
      '92db9158685ad72efbc250ab5edf055da017cf0ee3819619effa69db3718bc1d'
    );
  });
  it('normalizes and validates names', () => {
    expect(normalizeName('  Alice.BOING ')).toEqual({ ok: true, label: 'alice' });
    expect(normalizeName('ab').ok).toBe(false);
    expect(normalizeName('a--b').ok).toBe(false);
    expect(normalizeName('-ab').ok).toBe(false);
    expect(normalizeName('0xabc').ok).toBe(false);
    expect(normalizeName('12345').ok).toBe(false);
    expect(looksLikeName('alice.boing')).toBe(true);
    expect(looksLikeName('0x' + '11'.repeat(32))).toBe(false);
    expect(looksLikeName('11'.repeat(32))).toBe(false);
  });
  it('rent is 10/5/2/1 per year', () => {
    expect([rentPerYear('abc'), rentPerYear('abcd'), rentPerYear('abcde'), rentPerYear('abcdef')]).toEqual([10n, 5n, 2n, 1n]);
    expect(rentFor('abcd', 3)).toBe(15n);
  });
});