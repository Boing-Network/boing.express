/**
 * Bincode-compatible encoding for Boing types (Rust serde + bincode 1.3).
 * Must match crates/boing-primitives (TransactionPayload order and SignedTransaction layout).
 */

import type { Payload, AccessList, Transaction, SignedTransaction } from './types';

const VARIANT_TRANSFER = 0;
const VARIANT_CONTRACT_CALL = 1;
const VARIANT_CONTRACT_DEPLOY = 2;
const VARIANT_CONTRACT_DEPLOY_PURPOSE = 3;
const VARIANT_CONTRACT_DEPLOY_META = 4;
const VARIANT_BOND = 5;
const VARIANT_UNBOND = 6;

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value >>> 0, true);
}

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

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Vec<u8>: u64 LE length + bytes */
export function encodeVecU8(bytes: Uint8Array): Uint8Array {
  const hdr = new Uint8Array(8);
  writeU64LE(hdr, 0, BigInt(bytes.length));
  return concatBytes([hdr, bytes]);
}

/** String: Vec<u8> UTF-8 */
function encodeString(s: string): Uint8Array {
  return encodeVecU8(new TextEncoder().encode(s));
}

function encodeOptionVecU8(v: Uint8Array | null | undefined): Uint8Array {
  if (v == null || v.length === 0) {
    return new Uint8Array([0]);
  }
  return concatBytes([new Uint8Array([1]), encodeVecU8(v)]);
}

/** `Option<[u8; 32]>` for CREATE2 salt (bincode: 0 = None, 1 + 32 bytes = Some). */
function encodeOptionCreate2Salt(salt: Uint8Array | null | undefined): Uint8Array {
  if (salt == null) {
    return new Uint8Array([0]);
  }
  if (salt.length !== 32) {
    throw new Error('create2_salt must be exactly 32 bytes');
  }
  return concatBytes([new Uint8Array([1]), salt]);
}

function encodeOptionString(s: string | null | undefined): Uint8Array {
  if (s == null || s === '') {
    return new Uint8Array([0]);
  }
  return concatBytes([new Uint8Array([1]), encodeString(s)]);
}

function enumTag(tag: number): Uint8Array {
  const b = new Uint8Array(4);
  writeU32LE(b, 0, tag);
  return b;
}

/** Encode TransactionPayload (u32 variant index + fields, per Rust enum order). */
export function encodePayload(p: Payload): Uint8Array {
  switch (p.kind) {
    case 'transfer': {
      const body = new Uint8Array(4 + 32 + 16);
      writeU32LE(body, 0, VARIANT_TRANSFER);
      body.set(p.to, 4);
      writeU128LE(body, 4 + 32, p.amount);
      return body;
    }
    case 'contract_call': {
      const calldataEnc = encodeVecU8(p.calldata);
      return concatBytes([enumTag(VARIANT_CONTRACT_CALL), p.contract, calldataEnc]);
    }
    case 'contract_deploy': {
      return concatBytes([
        enumTag(VARIANT_CONTRACT_DEPLOY),
        encodeVecU8(p.bytecode),
        encodeOptionCreate2Salt(p.create2_salt),
      ]);
    }
    case 'contract_deploy_purpose': {
      return concatBytes([
        enumTag(VARIANT_CONTRACT_DEPLOY_PURPOSE),
        encodeVecU8(p.bytecode),
        encodeString(p.purpose_category),
        encodeOptionVecU8(p.description_hash),
        encodeOptionCreate2Salt(p.create2_salt),
      ]);
    }
    case 'contract_deploy_meta': {
      return concatBytes([
        enumTag(VARIANT_CONTRACT_DEPLOY_META),
        encodeVecU8(p.bytecode),
        encodeString(p.purpose_category),
        encodeOptionVecU8(p.description_hash),
        encodeOptionString(p.asset_name),
        encodeOptionString(p.asset_symbol),
        encodeOptionCreate2Salt(p.create2_salt),
      ]);
    }
    case 'bond': {
      const body = new Uint8Array(4 + 16);
      writeU32LE(body, 0, VARIANT_BOND);
      writeU128LE(body, 4, p.amount);
      return body;
    }
    case 'unbond': {
      const body = new Uint8Array(4 + 16);
      writeU32LE(body, 0, VARIANT_UNBOND);
      writeU128LE(body, 4, p.amount);
      return body;
    }
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

/** Encode AccessList: u64 read len + accounts + u64 write len + accounts */
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

/** Encode Transaction (nonce u64 LE, sender, payload, access_list). */
export function encodeTransaction(tx: Transaction): Uint8Array {
  const payloadBytes = encodePayload(tx.payload);
  const accessBytes = encodeAccessList(tx.access_list);
  const total = 8 + 32 + payloadBytes.length + accessBytes.length;
  const buf = new Uint8Array(total);
  writeU64LE(buf, 0, tx.nonce);
  buf.set(tx.sender, 8);
  buf.set(payloadBytes, 40);
  buf.set(accessBytes, 40 + payloadBytes.length);
  return buf;
}

/** Signature serializes as byte vec: u64(64) + 64 bytes (serde_bytes on Rust). */
export function encodeSignature(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) throw new Error('Ed25519 signature must be 64 bytes');
  return encodeVecU8(sig);
}

/** SignedTransaction: bincode(tx) || bincode(signature) */
export function encodeSignedTransaction(st: SignedTransaction): Uint8Array {
  return concatBytes([encodeTransaction(st.tx), encodeSignature(st.signature)]);
}
