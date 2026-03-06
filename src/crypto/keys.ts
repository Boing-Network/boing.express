/**
 * Ed25519 key generation and derivation. Client-only; keys never leave the device.
 * In browser/extension, @noble/ed25519 needs a sync SHA-512; we set it from @noble/hashes.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

// Required in environments without Node crypto (e.g. Chrome extension). Without this,
// getPublicKey() throws "hashes.sha512Sync not set".
if (typeof ed.etc.sha512Sync !== 'function') {
  ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
    sha512(ed.etc.concatBytes(...messages));
}

/** Generate a new Ed25519 keypair. Returns [publicKey 32 bytes, privateKey 32 bytes]. */
export async function generateKeyPair(): Promise<[Uint8Array, Uint8Array]> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKey(privateKey);
  return [publicKey, privateKey];
}

/** Get public key (AccountId) from private key. */
export async function publicKeyFromPrivate(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKey(privateKey);
}

/** Import private key from 64-char hex (with or without 0x). Must be 32 bytes. */
export function privateKeyFromHex(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '');
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h))
    throw new Error('Invalid private key: must be 64 hex chars (32 bytes)');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Export private key to hex (no 0x). */
export function privateKeyToHex(privateKey: Uint8Array): string {
  if (privateKey.length !== 32) throw new Error('Private key must be 32 bytes');
  return Array.from(privateKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Sign an arbitrary message (e.g. for personal_sign). Returns 0x-prefixed hex signature (64 bytes = 128 hex chars). */
export async function signMessage(message: Uint8Array, privateKey: Uint8Array): Promise<string> {
  const sig = await ed.signAsync(message, privateKey);
  return '0x' + Array.from(sig)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
