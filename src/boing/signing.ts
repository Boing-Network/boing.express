/**
 * Boing signable hash and signed tx construction.
 * signable_hash = BLAKE3( nonce_LE(8) || sender(32) || bincode(payload) || bincode(access_list) )
 * Signature = Ed25519(signable_hash). Submit hex(bincode(SignedTransaction)).
 */

import { blake3 } from '@noble/hashes/blake3';
import * as ed from '@noble/ed25519';
import type { Transaction, SignedTransaction } from './types';
import { encodePayload, encodeAccessList, encodeSignedTransaction } from './bincode';

/** Signable message = BLAKE3( nonce_LE(8) || sender(32) || bincode(payload) || bincode(access_list) ). */
export function signableHash(tx: Transaction): Uint8Array {
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, tx.nonce, true);
  const payloadBytes = encodePayload(tx.payload);
  const accessBytes = encodeAccessList(tx.access_list);
  const total = 8 + 32 + payloadBytes.length + accessBytes.length;
  const input = new Uint8Array(total);
  input.set(nonceBuf, 0);
  input.set(tx.sender, 8);
  input.set(payloadBytes, 40);
  input.set(accessBytes, 40 + payloadBytes.length);
  return blake3(input);
}

/** Sign a transaction with Ed25519 private key (32 bytes). Returns 64-byte signature. */
export async function signTransaction(tx: Transaction, privateKey: Uint8Array): Promise<Uint8Array> {
  const message = signableHash(tx);
  const sig = await ed.signAsync(message, privateKey);
  return sig;
}

/** Build SignedTransaction and return hex for boing_submitTransaction. */
export async function buildSignedTransactionHex(
  tx: Transaction,
  privateKey: Uint8Array
): Promise<string> {
  const signature = await signTransaction(tx, privateKey);
  const signed: SignedTransaction = { tx, signature };
  const bytes = encodeSignedTransaction(signed);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
