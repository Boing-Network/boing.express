/**
 * Bincode-compatible encoding for Boing types (Rust serde + bincode 1.3).
 * Must match crates/boing-primitives (TransactionPayload order and SignedTransaction layout).
 */

import type { Payload, AccessList, Transaction, SignedTransaction } from './types';
import { blake3 } from '@noble/hashes/blake3.js';

const VARIANT_TRANSFER = 0;
const VARIANT_CONTRACT_CALL = 1;
const VARIANT_CONTRACT_DEPLOY = 2;
const VARIANT_CONTRACT_DEPLOY_PURPOSE = 3;
const VARIANT_CONTRACT_DEPLOY_META = 4;
const VARIANT_BOND = 5;
const VARIANT_UNBOND = 6;
/** Rust `TransactionPayload::ClaimUnbond`. */
const VARIANT_CLAIM_UNBOND = 7;
/** Rust `TransactionPayload::QaPoolVote`. */
const VARIANT_QA_POOL_VOTE = 8;
/** Rust `TransactionPayload::ValidatorRegister / ValidatorDeregister / ValidatorUnjail` (9 = Batch). */
const VARIANT_BATCH = 9;
const VARIANT_VALIDATOR_REGISTER = 10;
const VARIANT_VALIDATOR_DEREGISTER = 11;
const VARIANT_VALIDATOR_UNJAIL = 12;
const VARIANT_NAME_COMMIT = 13;
const VARIANT_NAME_REGISTER = 14;
const VARIANT_NAME_RENEW = 15;
const VARIANT_NAME_TRANSFER = 16;
const VARIANT_NAME_SET_TARGET = 17;
const VARIANT_NAME_SET_PRIMARY = 18;
const VARIANT_NAME_RELEASE = 19;
/** Rust `TransactionPayload::ContractCallWithValue` (native value rules; testnet from height 1150). */
const VARIANT_CONTRACT_CALL_WITH_VALUE = 20;
/** Rust `TransactionPayload::PutBlob` (L1 media blobs). */
const VARIANT_PUT_BLOB = 21;
/** Rust `BlobRetention` discriminants. */
const BLOB_RETENTION_PRUNABLE = 0;
const BLOB_RETENTION_FOREVER = 1;
/** Rust `BatchCall::ContractCallWithValue`. */
const BATCH_CONTRACT_CALL_WITH_VALUE = 2;

function u128Bytes(v: bigint, what: string): Uint8Array {
  if (v < 0n || v >= 1n << 128n) throw new Error(`${what} out of u128 range`);
  const b = new Uint8Array(16);
  writeU128LE(b, 0, v);
  return b;
}

function need32(b: Uint8Array, what: string): Uint8Array {
  if (b.length !== 32) throw new Error(`${what} must be 32 bytes`);
  return b;
}

function yearsByte(y: number): Uint8Array {
  if (!Number.isInteger(y) || y < 1 || y > 255) throw new Error('years must be an integer 1-255');
  return new Uint8Array([y]);
}

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
      if (p.value != null && p.value > 0n) {
        return concatBytes([enumTag(VARIANT_CONTRACT_CALL_WITH_VALUE), p.contract, calldataEnc, u128Bytes(p.value, 'value')]);
      }
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
    case 'claim_unbond': {
      return enumTag(VARIANT_CLAIM_UNBOND);
    }
    case 'qa_pool_vote': {
      if (p.subject.length !== 32) {
        throw new Error('qa_pool_vote subject must be 32 bytes');
      }
      const voteDisc = p.vote === 'allow' ? 0 : p.vote === 'reject' ? 1 : 2;
      return concatBytes([enumTag(VARIANT_QA_POOL_VOTE), p.subject, enumTag(voteDisc)]);
    }
    case 'validator_register': {
      if (p.node_id.length !== 32) throw new Error('node_id must be 32 bytes');
      if (p.node_signature.length !== 64) throw new Error('node_signature must be 64 bytes');
      return concatBytes([enumTag(VARIANT_VALIDATOR_REGISTER), p.node_id, encodeVecU8(p.node_signature)]);
    }
    case 'validator_deregister': {
      if (p.node_id.length !== 32) throw new Error('node_id must be 32 bytes');
      return concatBytes([enumTag(VARIANT_VALIDATOR_DEREGISTER), p.node_id]);
    }
    case 'validator_unjail': {
      if (p.node_id.length !== 32) throw new Error('node_id must be 32 bytes');
      return concatBytes([enumTag(VARIANT_VALIDATOR_UNJAIL), p.node_id]);
    }
    case 'batch': {
      const count = new Uint8Array(8);
      writeU64LE(count, 0, BigInt(p.calls.length));
      const parts: Uint8Array[] = [enumTag(VARIANT_BATCH), count];
      for (const c of p.calls) {
        if (c.kind === 'transfer') {
          const body = new Uint8Array(4 + 32 + 16);
          writeU32LE(body, 0, 0);
          body.set(c.to, 4);
          writeU128LE(body, 4 + 32, c.amount);
          parts.push(body);
        } else if (c.value != null && c.value > 0n) {
          parts.push(enumTag(BATCH_CONTRACT_CALL_WITH_VALUE), c.contract, encodeVecU8(c.calldata), u128Bytes(c.value, 'value'));
        } else {
          parts.push(enumTag(1), c.contract, encodeVecU8(c.calldata));
        }
      }
      return concatBytes(parts);
    }
    case 'name_commit':
      return concatBytes([enumTag(VARIANT_NAME_COMMIT), need32(p.commitment, 'commitment')]);
    case 'name_register':
      return concatBytes([
        enumTag(VARIANT_NAME_REGISTER),
        encodeString(p.name),
        need32(p.salt, 'salt'),
        need32(p.target, 'target'),
        yearsByte(p.years),
      ]);
    case 'name_renew':
      return concatBytes([enumTag(VARIANT_NAME_RENEW), encodeString(p.name), yearsByte(p.years)]);
    case 'name_transfer':
      return concatBytes([enumTag(VARIANT_NAME_TRANSFER), encodeString(p.name), need32(p.new_owner, 'new_owner')]);
    case 'name_set_target':
      return concatBytes([enumTag(VARIANT_NAME_SET_TARGET), encodeString(p.name), need32(p.target, 'target')]);
    case 'name_set_primary':
      return concatBytes([
        enumTag(VARIANT_NAME_SET_PRIMARY),
        p.name == null ? new Uint8Array([0]) : concatBytes([new Uint8Array([1]), encodeString(p.name)]),
      ]);
    case 'name_release':
      return concatBytes([enumTag(VARIANT_NAME_RELEASE), encodeString(p.name)]);
    case 'put_blob': {
      const retention =
        p.retention.kind === 'forever'
          ? enumTag(BLOB_RETENTION_FOREVER)
          : concatBytes([
              enumTag(BLOB_RETENTION_PRUNABLE),
              (() => {
                const ttl = new Uint8Array(8);
                writeU64LE(ttl, 0, p.retention.ttlBlocks);
                return ttl;
              })(),
            ]);
      return concatBytes([
        enumTag(VARIANT_PUT_BLOB),
        retention,
        encodeString(p.contentType ?? ''),
        encodeVecU8(p.data),
      ]);
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

/** SignedTransaction: bincode(tx) || bincode(signature) [|| tip_u128 when tip > 0] */
export function encodeSignedTransaction(st: SignedTransaction): Uint8Array {
  const tip = st.tx.priorityTip ?? 0n;
  const base = concatBytes([encodeTransaction(st.tx), encodeSignature(st.signature)]);
  // Match Rust `skip_serializing_if = is_zero_u128`: tip omitted when zero.
  if (tip === 0n) return base;
  return concatBytes([base, u128Bytes(tip, 'priorityTip')]);
}

function bytesToHex0x(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Receipt / mempool id: BLAKE3 of unsigned `Transaction` bincode (`Transaction::id()`). */
export function transactionIdFromTransaction(tx: Transaction): string {
  return bytesToHex0x(blake3(encodeTransaction(tx)));
}

const SIGNED_TX_SIGNATURE_TRAIL_BYTES = 8 + 64;
const SIGNED_TX_TIP_BYTES = 16;

/**
 * Derive `tx_id` from `0x` + bincode(`SignedTransaction`) hex.
 * Trailing serde signature is `u64(64) || 64 bytes`, optionally followed by tip u128.
 */
export function transactionIdFromSignedTransactionHex(signedTxHex: string): string {
  const h = signedTxHex.replace(/^0x/i, '');
  if (h.length % 2 !== 0) throw new Error('invalid signed tx hex');
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length < SIGNED_TX_SIGNATURE_TRAIL_BYTES + 1) {
    throw new Error('Signed transaction bytes too short to derive tx_id');
  }
  const tryOffset = (sigLenOffset: number): string | null => {
    if (sigLenOffset < 1) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + sigLenOffset, 8);
    const sigLen = dv.getBigUint64(0, true);
    if (sigLen !== 64n) return null;
    return bytesToHex0x(blake3(bytes.subarray(0, sigLenOffset)));
  };
  // Prefer tipped layout (sig then tip), then untipped.
  return (
    tryOffset(bytes.length - SIGNED_TX_SIGNATURE_TRAIL_BYTES - SIGNED_TX_TIP_BYTES) ??
    tryOffset(bytes.length - SIGNED_TX_SIGNATURE_TRAIL_BYTES) ??
    (() => {
      throw new Error('Unexpected serde signature length field (expected 64)');
    })()
  );
}
