/**
 * SLIP-0010 hierarchical key derivation for ed25519 (hardened children only).
 * Spec: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 *
 *   master:  I = HMAC-SHA512(key = "ed25519 seed", data = seed);  k = I[0..32], c = I[32..64]
 *   child:   I = HMAC-SHA512(key = c_par, data = 0x00 || k_par || ser32(i));  i >= 2^31
 *
 * ed25519 has no public (non-hardened) derivation in SLIP-0010, so every path index must be hardened.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

const HARDENED = 0x80000000;

export type Slip10Node = { key: Uint8Array; chainCode: Uint8Array };

export function slip10MasterEd25519(seed: Uint8Array): Slip10Node {
  if (seed.length < 16 || seed.length > 64) throw new Error('SLIP-0010 seed must be 16 to 64 bytes');
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

export function slip10DeriveHardenedChild(parent: Slip10Node, index: number): Slip10Node {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error('Child index must be an integer in [0, 2^31)');
  }
  const data = new Uint8Array(37);
  data[0] = 0;
  data.set(parent.key, 1);
  new DataView(data.buffer).setUint32(33, (index | HARDENED) >>> 0, false);
  const I = hmac(sha512, parent.chainCode, data);
  data.fill(0);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Parse "m/44'/0'/1'" (also accepts "h" / "H" as the hardened marker). Every segment must be hardened. */
export function parseHardenedPath(path: string): number[] {
  const parts = path.trim().split('/');
  if (parts[0] !== 'm') throw new Error("Path must start with m");
  return parts.slice(1).map((p) => {
    const m = /^(\d+)(?:'|h|H)$/.exec(p);
    if (!m) throw new Error('ed25519 derivation (SLIP-0010) supports hardened indices only, like 44\'');
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n >= HARDENED) throw new Error('Path index out of range');
    return n;
  });
}

/** Derive the 32-byte ed25519 private seed at `path` (e.g. "m/0'/1'") from a BIP-39 / raw seed. */
export function slip10DeriveEd25519(seed: Uint8Array, path: string): Slip10Node {
  let node = slip10MasterEd25519(seed);
  for (const idx of parseHardenedPath(path)) {
    const next = slip10DeriveHardenedChild(node, idx);
    node.key.fill(0);
    node.chainCode.fill(0);
    node = next;
  }
  return node;
}
