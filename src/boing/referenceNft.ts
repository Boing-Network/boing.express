/**
 * Reference NFT calldata + storage keys (Boing VM convention).
 * Aligned with boing-sdk `referenceNft.ts` and docs/BOING-REFERENCE-NFT.md.
 */

import type { AccountId } from './types';
import { accountIdToHex } from './types';

export const SELECTOR_OWNER_OF = 0x03;
export const SELECTOR_TRANSFER_NFT = 0x04;
export const SELECTOR_SET_METADATA_HASH = 0x05;
export const SELECTOR_MINT_BATCH = 0x06;

/** Template v3 bytecode cap (v2 collections stay at 50 on-chain). */
export const MAX_REFERENCE_NFT_MINT_BATCH = 500;

/** XOR mask for owner slot — mirrors `REF_NFT_OWNER_STORAGE_XOR`. */
export const REF_NFT_OWNER_STORAGE_XOR_HEX =
  '424f494e475f5245464e46545f4f574e45523031000000000000000000000000';

/** XOR mask for metadata hash slot — mirrors `REF_NFT_METADATA_STORAGE_XOR`. */
export const REF_NFT_METADATA_STORAGE_XOR_HEX =
  '424f494e475f5245464e46545f4d455441303100000000000000000000000000';

/** Normalize to 64 lowercase hex chars (no 0x). Throws on invalid length. */
export function normalizeHex64(hex: string): string {
  const h = hex.replace(/^0x/i, '').trim().toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/.test(h)) {
    throw new Error('Expected 32-byte hex (64 hex characters)');
  }
  return h;
}

function hexToBytes32(hex64: string): Uint8Array {
  const h = normalizeHex64(hex64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex64(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function xorWords(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

/** `SLOAD` key for reference NFT owner: `token_id ^ REF_NFT_OWNER_STORAGE_XOR`. */
export function referenceNftOwnerStorageKey(tokenIdHex32: string): string {
  return bytesToHex64(xorWords(hexToBytes32(tokenIdHex32), hexToBytes32(REF_NFT_OWNER_STORAGE_XOR_HEX)));
}

/** `SLOAD` key for reference NFT metadata hash. */
export function referenceNftMetadataStorageKey(tokenIdHex32: string): string {
  return bytesToHex64(
    xorWords(hexToBytes32(tokenIdHex32), hexToBytes32(REF_NFT_METADATA_STORAGE_XOR_HEX))
  );
}

/**
 * Encode a sequential token id as a 32-byte word (big-endian u64 in the low 8 bytes).
 * FreshMint-style opaque hash ids should be passed as full 32-byte hex instead.
 */
export function referenceNftTokenIdWordFromU64(id: bigint | number): string {
  let n = BigInt(id);
  if (n < 0n) throw new RangeError('token id must be non-negative');
  const out = new Uint8Array(32);
  for (let i = 31; i >= 24; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytesToHex64(out);
}

/** Parse user input: 64-hex word, or decimal sequential id (1..) → 32-byte word. */
export function parseTokenIdInput(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error('Token id is required');
  const asHex = t.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(asHex)) return asHex.toLowerCase();
  if (/^\d+$/.test(t)) {
    const n = BigInt(t);
    if (n < 1n) throw new Error('Sequential token id must be ≥ 1');
    return referenceNftTokenIdWordFromU64(n);
  }
  throw new Error('Token id must be 64 hex characters or a sequential decimal id');
}

function selectorWord(selector: number): Uint8Array {
  const w = new Uint8Array(32);
  w[31] = selector & 0xff;
  return w;
}

/** 96-byte `transfer_nft(to, token_id)` reference calldata. */
export function encodeReferenceTransferNftCalldata(
  to: AccountId,
  tokenIdHex32: string
): Uint8Array {
  const out = new Uint8Array(96);
  out.set(selectorWord(SELECTOR_TRANSFER_NFT), 0);
  out.set(to, 32);
  out.set(hexToBytes32(tokenIdHex32), 64);
  return out;
}

export function encodeReferenceTransferNftCalldataHex(
  to: AccountId,
  tokenIdHex32: string
): string {
  return bytesToHex64(encodeReferenceTransferNftCalldata(to, tokenIdHex32));
}

/** Normalize `boing_getContractStorage` result (`{ value }` or bare hex) to 64 hex chars. */
export function contractStorageWordToHex64(word: unknown): string | null {
  let raw: string | null = null;
  if (typeof word === 'string' && word.trim()) raw = word.trim();
  else if (word && typeof word === 'object' && 'value' in word) {
    const v = (word as { value: unknown }).value;
    if (typeof v === 'string' && v.trim()) raw = v.trim();
  }
  if (!raw) return null;
  const h = raw.replace(/^0x/i, '').toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/.test(h)) return null;
  return h;
}

export function isZeroStorageWordHex64(hex64: string | null): boolean {
  return hex64 == null || /^0+$/.test(hex64);
}

/**
 * Extract token-id words from reference NFT `mint_batch` (`0x06`) calldata.
 * Returns null when selector/length do not match `96 + 64n`.
 */
export function parseReferenceMintBatchTokenIds(calldata: Uint8Array): {
  n: number;
  toHex: string;
  tokenIds: string[];
} | null {
  if (calldata.length < 96) return null;
  if (calldata[31] !== SELECTOR_MINT_BATCH) return null;
  let n = 0n;
  for (let i = 64; i < 96; i++) {
    n = (n << 8n) | BigInt(calldata[i]!);
  }
  if (n < 1n || n > BigInt(MAX_REFERENCE_NFT_MINT_BATCH)) return null;
  const nNum = Number(n);
  if (calldata.length < 96 + 64 * nNum) return null;
  const toHex = bytesToHex64(calldata.slice(32, 64));
  const tokenIds: string[] = [];
  for (let i = 0; i < nNum; i++) {
    const start = 96 + 32 * i;
    tokenIds.push(bytesToHex64(calldata.slice(start, start + 32)));
  }
  return { n: nNum, toHex, tokenIds };
}

/** Observer item profile URL — same identity as `/asset/:collection/item/:tokenId`. */
export function observerNftItemUrl(
  explorerBase: string,
  collectionHex64: string,
  tokenIdHex64: string,
  networkIsTestnet: boolean
): string {
  const base = explorerBase.replace(/\/$/, '');
  const collection = normalizeHex64(collectionHex64);
  const tokenId = normalizeHex64(tokenIdHex64);
  const network = networkIsTestnet ? 'testnet' : 'mainnet';
  return `${base}/asset/${collection}/item/${tokenId}?network=${network}`;
}

/** Observer collection page URL. */
export function observerNftCollectionUrl(
  explorerBase: string,
  collectionHex64: string,
  networkIsTestnet: boolean
): string {
  const base = explorerBase.replace(/\/$/, '');
  const collection = normalizeHex64(collectionHex64);
  const network = networkIsTestnet ? 'testnet' : 'mainnet';
  return `${base}/asset/${collection}?network=${network}`;
}

export function shortHexLabel(hex64: string, head = 6, tail = 4): string {
  const h = hex64.replace(/^0x/i, '').toLowerCase();
  if (h.length <= head + tail) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function accountHexMatchesStorageOwner(
  ownerAccount: AccountId,
  storageOwnerHex64: string | null
): boolean {
  if (!storageOwnerHex64 || isZeroStorageWordHex64(storageOwnerHex64)) return false;
  return accountIdToHex(ownerAccount).toLowerCase() === storageOwnerHex64.toLowerCase();
}
