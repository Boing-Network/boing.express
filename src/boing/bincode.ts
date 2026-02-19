/**
 * Bincode-compatible encoding for Boing types (little-endian, Rust serde layout).
 * Matches boing-primitives so the node accepts transactions.
 */

import type { Payload, AccessList, Transaction, SignedTransaction } from './types';

function writeU64LE(buf: Uint8Array, offset: number, value: bigint): void {
  const lo = Number(value & 0xffff_ffffn);
  const hi = Number((value >> 32n) & 0xffff_ffffn);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, lo, true);
  view.setUint32(offset + 4, hi, true);
}

function writeU128LE(buf: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lo = value & 0xffff_ffff_ffff_ffffn;
  const hi = value >> 64n;
  view.setBigUint64(offset, lo, true);
  view.setBigUint64(offset + 8, hi, true);
}

/** Encode Payload (enum: tag u8 then fields). */
export function encodePayload(p: Payload): Uint8Array {
  if (p.tag === 0) {
    const buf = new Uint8Array(1 + 32 + 16);
    buf[0] = 0;
    buf.set(p.to, 1);
    writeU128LE(buf, 1 + 32, p.amount);
    return buf;
  }
  if (p.tag === 1) {
    const buf = new Uint8Array(1 + 16);
    buf[0] = 1;
    writeU128LE(buf, 1, p.amount);
    return buf;
  }
  if (p.tag === 2) {
    const buf = new Uint8Array(1 + 16);
    buf[0] = 2;
    writeU128LE(buf, 1, p.amount);
    return buf;
  }
  if (p.tag === 3) {
    return new Uint8Array([3]);
  }
  if (p.tag === 4) {
    return new Uint8Array([4]);
  }
  throw new Error('Unknown payload tag');
}

/** Encode AccessList (read vec then write vec; bincode uses u64 length). */
export function encodeAccessList(a: AccessList): Uint8Array {
  const readLen = a.read.length;
  const writeLen = a.write.length;
  const buf = new Uint8Array(8 + readLen * 32 + 8 + writeLen * 32);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(0, BigInt(readLen), true);
  let offset = 8;
  for (const id of a.read) {
    buf.set(id, offset);
    offset += 32;
  }
  view.setBigUint64(offset, BigInt(writeLen), true);
  offset += 8;
  for (const id of a.write) {
    buf.set(id, offset);
    offset += 32;
  }
  return buf;
}

/** Encode Transaction. */
export function encodeTransaction(tx: Transaction): Uint8Array {
  const nonce = 8;
  const sender = 32;
  const payloadBytes = encodePayload(tx.payload);
  const accessBytes = encodeAccessList(tx.access_list);
  const total = nonce + sender + payloadBytes.length + accessBytes.length;
  const buf = new Uint8Array(total);
  let offset = 0;
  writeU64LE(buf, offset, tx.nonce);
  offset += 8;
  buf.set(tx.sender, offset);
  offset += 32;
  buf.set(payloadBytes, offset);
  offset += payloadBytes.length;
  buf.set(accessBytes, offset);
  return buf;
}

/** Encode SignedTransaction (tx then 64-byte signature). */
export function encodeSignedTransaction(st: SignedTransaction): Uint8Array {
  const txBytes = encodeTransaction(st.tx);
  const buf = new Uint8Array(txBytes.length + 64);
  buf.set(txBytes, 0);
  buf.set(st.signature, txBytes.length);
  return buf;
}
