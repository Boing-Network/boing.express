/**
 * Reference multi-token v1 (ERC-1155-style shared item types) — calldata, storage keys, log decoding and
 * human-readable call descriptions. Dependency-free mirror of boing-sdk 0.5.41 `referenceMultiToken.ts`
 * (spec: boing.network `docs/BOING-REFERENCE-MULTI-TOKEN.md`). Replace with the SDK exports once
 * `@boing-network/boing-sdk@0.5.41` is published.
 *
 * Every holder of item `7` holds the same item: balances are `balance[itemId][account]`, item ids are u64,
 * amounts u128. Slot keys are XOR-tagged words (no hashing opcode).
 */

import {
  REFERENCE_MULTI_TOKEN_DEPLOY_HEX,
  REFERENCE_MULTI_TOKEN_RUNTIME_HEX,
} from './referenceMultiTokenBytecodeHex';

export { REFERENCE_MULTI_TOKEN_DEPLOY_HEX, REFERENCE_MULTI_TOKEN_RUNTIME_HEX };

export const SELECTOR_MT_BALANCE_OF = 0x20;
export const SELECTOR_MT_TRANSFER = 0x21;
export const SELECTOR_MT_MINT = 0x22;
export const SELECTOR_MT_SET_ITEM_METADATA = 0x23;
export const SELECTOR_MT_MINT_BATCH = 0x24;
export const SELECTOR_MT_TRANSFER_BATCH = 0x25;
export const SELECTOR_MT_TOTAL_SUPPLY = 0x26;
export const SELECTOR_MT_ITEM_METADATA = 0x27;
export const SELECTOR_MT_ADMIN = 0x28;
export const SELECTOR_MT_TRANSFER_ADMIN = 0x29;

/** Max entries per `mint_batch` / `transfer_batch` (one log per entry; VM cap 24 logs per tx). */
export const MAX_REFERENCE_MULTI_TOKEN_BATCH = 16;
export const REFERENCE_MULTI_TOKEN_ARTIFACT_ID = 'boing.reference_multi_token.v1';

function tag32(ascii: string): string {
  let h = '';
  for (let i = 0; i < 32; i++) h += (i < ascii.length ? ascii.charCodeAt(i) : 0).toString(16).padStart(2, '0');
  return h;
}

/** XOR tags / log topics as 64 lowercase hex chars (no `0x`). */
export const REF_MT_BALANCE_XOR_HEX = tag32('BOING_REFMT_BAL_V1');
export const REF_MT_SUPPLY_XOR_HEX = tag32('BOING_REFMT_SUPPLY_V1');
export const REF_MT_METADATA_XOR_HEX = tag32('BOING_REFMT_META_V1');
export const REF_MT_TOPIC_TRANSFER_HEX = tag32('BOING_REFMT_TRANSFER_V1');
export const REF_MT_TOPIC_METADATA_HEX = tag32('BOING_REFMT_METADATA_V1');
export const REF_MT_TOPIC_ADMIN_HEX = tag32('BOING_REFMT_ADMIN_V1');
export const REF_MT_ADMIN_KEY_HEX = '00'.repeat(31) + 'e0';

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

function strip(h: string): string {
  return h.trim().replace(/^0x/i, '').toLowerCase();
}

/** Normalize a 32-byte hex word (account id, hash) to 64 lowercase hex chars without `0x`. */
export function mtHex32(hex: string): string {
  const h = strip(hex);
  if (h.length !== 64 || !/^[0-9a-f]+$/.test(h)) throw new Error('Expected 32-byte hex (64 hex characters)');
  return h;
}

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function toU64(v: bigint | number | string, what = 'item id'): bigint {
  const n = BigInt(v);
  if (n < 0n || n > U64_MAX) throw new RangeError(`${what} must be a u64`);
  return n;
}

function toU128(v: bigint | number | string, what = 'amount'): bigint {
  const n = BigInt(v);
  if (n < 0n || n > U128_MAX) throw new RangeError(`${what} must be a u128`);
  return n;
}

function beWord(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0 && x > 0n; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function wordToBigInt(w: Uint8Array): bigint {
  let n = 0n;
  for (const b of w) n = (n << 8n) | BigInt(b);
  return n;
}

function xorHex(a: Uint8Array, maskHex: string): string {
  const m = hexToBytes(maskHex);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i]! ^ m[i]!;
  return bytesToHex(out);
}

/** `SLOAD` key for `balance[itemId][account]`: `(account[0..24] || itemId_be8) ^ BAL tag`. */
export function multiTokenBalanceStorageKey(accountHex32: string, itemId: bigint | number | string): string {
  const raw = new Uint8Array(32);
  raw.set(hexToBytes(mtHex32(accountHex32)).subarray(0, 24), 0);
  raw.set(beWord(toU64(itemId)).subarray(24), 24);
  return xorHex(raw, REF_MT_BALANCE_XOR_HEX);
}

/** `SLOAD` key for `total_supply[itemId]`. */
export function multiTokenSupplyStorageKey(itemId: bigint | number | string): string {
  return xorHex(beWord(toU64(itemId)), REF_MT_SUPPLY_XOR_HEX);
}

/** `SLOAD` key for the type-level `item_metadata[itemId]` hash. */
export function multiTokenMetadataStorageKey(itemId: bigint | number | string): string {
  return xorHex(beWord(toU64(itemId)), REF_MT_METADATA_XOR_HEX);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const selW = (s: number) => beWord(BigInt(s));
const acctW = (h: string) => hexToBytes(mtHex32(h));

export type MultiTokenBatchEntry = { itemId: bigint | number | string; amount: bigint | number | string };

function nonZeroAmount(a: bigint | number | string): Uint8Array {
  const n = toU128(a);
  if (n === 0n) throw new RangeError('amount must be > 0');
  return beWord(n);
}

/** 128-byte `transfer(to, itemId, amount)` — moves the caller's own balance. */
export function encodeMultiTokenTransferCalldata(
  toHex32: string,
  itemId: bigint | number | string,
  amount: bigint | number | string
): Uint8Array {
  return concat([selW(SELECTOR_MT_TRANSFER), acctW(toHex32), beWord(toU64(itemId)), nonZeroAmount(amount)]);
}

/** 128-byte `mint(to, itemId, amount)` — admin only. */
export function encodeMultiTokenMintCalldata(
  toHex32: string,
  itemId: bigint | number | string,
  amount: bigint | number | string
): Uint8Array {
  return concat([selW(SELECTOR_MT_MINT), acctW(toHex32), beWord(toU64(itemId)), nonZeroAmount(amount)]);
}

function encodeBatch(selector: number, toHex32: string, entries: readonly MultiTokenBatchEntry[]): Uint8Array {
  const n = entries.length;
  if (n < 1 || n > MAX_REFERENCE_MULTI_TOKEN_BATCH) {
    throw new RangeError(`batch size must be 1..${MAX_REFERENCE_MULTI_TOKEN_BATCH}, got ${n}`);
  }
  return concat([
    selW(selector),
    acctW(toHex32),
    beWord(BigInt(n)),
    ...entries.map((e) => beWord(toU64(e.itemId))),
    ...entries.map((e) => nonZeroAmount(e.amount)),
  ]);
}

/** `mint_batch(to, n, itemIds[n], amounts[n])` — `96 + 64n` bytes, admin only. */
export function encodeMultiTokenMintBatchCalldata(toHex32: string, entries: readonly MultiTokenBatchEntry[]): Uint8Array {
  return encodeBatch(SELECTOR_MT_MINT_BATCH, toHex32, entries);
}

/** `transfer_batch(to, n, itemIds[n], amounts[n])` — `96 + 64n` bytes, caller's balances. */
export function encodeMultiTokenTransferBatchCalldata(
  toHex32: string,
  entries: readonly MultiTokenBatchEntry[]
): Uint8Array {
  return encodeBatch(SELECTOR_MT_TRANSFER_BATCH, toHex32, entries);
}

/** 96-byte `set_item_metadata(itemId, hash)` — admin only. */
export function encodeMultiTokenSetItemMetadataCalldata(itemId: bigint | number | string, hashHex32: string): Uint8Array {
  return concat([selW(SELECTOR_MT_SET_ITEM_METADATA), beWord(toU64(itemId)), acctW(hashHex32)]);
}

/** 64-byte `transfer_admin(newAdmin)` — admin only. */
export function encodeMultiTokenTransferAdminCalldata(newAdminHex32: string): Uint8Array {
  return concat([selW(SELECTOR_MT_TRANSFER_ADMIN), acctW(newAdminHex32)]);
}

export type DecodedMultiTokenCall =
  | { kind: 'balance_of'; account: string; itemId: bigint }
  | { kind: 'transfer' | 'mint'; to: string; itemId: bigint; amount: bigint }
  | { kind: 'set_item_metadata'; itemId: bigint; metadataHash: string }
  | { kind: 'mint_batch' | 'transfer_batch'; to: string; entries: { itemId: bigint; amount: bigint }[] }
  | { kind: 'total_supply' | 'item_metadata'; itemId: bigint }
  | { kind: 'admin' }
  | { kind: 'transfer_admin'; newAdmin: string };

function toBytes(calldata: string | Uint8Array | readonly number[]): Uint8Array | null {
  if (calldata instanceof Uint8Array) return calldata;
  if (Array.isArray(calldata)) {
    if (!calldata.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return null;
    return Uint8Array.from(calldata);
  }
  const t = strip(String(calldata));
  if (!t || t.length % 2 !== 0 || !/^[0-9a-f]+$/.test(t)) return null;
  return hexToBytes(t);
}

function u64At(b: Uint8Array, off: number): bigint | null {
  if (b.length < off + 32) return null;
  for (let i = 0; i < 24; i++) if (b[off + i] !== 0) return null;
  return wordToBigInt(b.subarray(off, off + 32));
}

function u128At(b: Uint8Array, off: number): bigint | null {
  if (b.length < off + 32) return null;
  for (let i = 0; i < 16; i++) if (b[off + i] !== 0) return null;
  return wordToBigInt(b.subarray(off, off + 32));
}

const wordAt = (b: Uint8Array, off: number) => bytesToHex(b.subarray(off, off + 32));

/**
 * Strict decode of reference multi-token calldata: selector **and** exact length must match
 * (wBOING reuses 0x20/0x21/0x23 with 32/64/32-byte calldata, so length disambiguates).
 * Returns null for anything the contract would reject (u64/u128 overflow, zero amount, bad batch size).
 */
export function decodeMultiTokenCalldata(
  calldata: string | Uint8Array | readonly number[]
): DecodedMultiTokenCall | null {
  const b = toBytes(calldata);
  if (!b || b.length < 32) return null;
  for (let i = 0; i < 31; i++) if (b[i] !== 0) return null;
  const s = b[31]!;
  const len = b.length;
  switch (s) {
    case SELECTOR_MT_BALANCE_OF: {
      if (len !== 96) return null;
      const itemId = u64At(b, 64);
      return itemId == null ? null : { kind: 'balance_of', account: wordAt(b, 32), itemId };
    }
    case SELECTOR_MT_TRANSFER:
    case SELECTOR_MT_MINT: {
      if (len !== 128) return null;
      const itemId = u64At(b, 64);
      const amount = u128At(b, 96);
      if (itemId == null || amount == null || amount === 0n) return null;
      return { kind: s === SELECTOR_MT_MINT ? 'mint' : 'transfer', to: wordAt(b, 32), itemId, amount };
    }
    case SELECTOR_MT_SET_ITEM_METADATA: {
      if (len !== 96) return null;
      const itemId = u64At(b, 32);
      return itemId == null ? null : { kind: 'set_item_metadata', itemId, metadataHash: wordAt(b, 64) };
    }
    case SELECTOR_MT_MINT_BATCH:
    case SELECTOR_MT_TRANSFER_BATCH: {
      const n = u64At(b, 64);
      if (n == null || n < 1n || n > BigInt(MAX_REFERENCE_MULTI_TOKEN_BATCH)) return null;
      const count = Number(n);
      if (len !== 96 + 64 * count) return null;
      const entries: { itemId: bigint; amount: bigint }[] = [];
      for (let i = 0; i < count; i++) {
        const itemId = u64At(b, 96 + 32 * i);
        const amount = u128At(b, 96 + 32 * (count + i));
        if (itemId == null || amount == null || amount === 0n) return null;
        entries.push({ itemId, amount });
      }
      return { kind: s === SELECTOR_MT_MINT_BATCH ? 'mint_batch' : 'transfer_batch', to: wordAt(b, 32), entries };
    }
    case SELECTOR_MT_TOTAL_SUPPLY:
    case SELECTOR_MT_ITEM_METADATA: {
      if (len !== 64) return null;
      const itemId = u64At(b, 32);
      if (itemId == null) return null;
      return { kind: s === SELECTOR_MT_TOTAL_SUPPLY ? 'total_supply' : 'item_metadata', itemId };
    }
    case SELECTOR_MT_ADMIN:
      return len === 32 ? { kind: 'admin' } : null;
    case SELECTOR_MT_TRANSFER_ADMIN:
      return len === 64 ? { kind: 'transfer_admin', newAdmin: wordAt(b, 32) } : null;
    default:
      return null;
  }
}

/** Recipient-side item moves in a decoded call (mint, transfer, batches). */
export function multiTokenCallMoves(
  d: DecodedMultiTokenCall
): { to: string; itemId: bigint; amount: bigint; isMint: boolean }[] {
  switch (d.kind) {
    case 'mint':
    case 'transfer':
      return [{ to: d.to, itemId: d.itemId, amount: d.amount, isMint: d.kind === 'mint' }];
    case 'mint_batch':
    case 'transfer_batch':
      return d.entries.map((e) => ({ to: d.to, itemId: e.itemId, amount: e.amount, isMint: d.kind === 'mint_batch' }));
    default:
      return [];
  }
}

export type MultiTokenTransferLog = { from: string; to: string; itemId: bigint; amount: bigint; isMint: boolean };

/** Decode a `{ topics, data }` receipt log emitted by the template; null for any other log. */
export function decodeMultiTokenTransferLog(log: {
  topics?: readonly unknown[];
  data?: unknown;
}): MultiTokenTransferLog | null {
  const topics = Array.isArray(log.topics) ? log.topics : [];
  if (topics.length !== 3 || topics.some((t) => typeof t !== 'string')) return null;
  let t0: string;
  let from: string;
  let to: string;
  try {
    t0 = mtHex32(topics[0] as string);
    from = mtHex32(topics[1] as string);
    to = mtHex32(topics[2] as string);
  } catch {
    return null;
  }
  if (t0 !== REF_MT_TOPIC_TRANSFER_HEX) return null;
  const data = toBytes((log.data ?? '') as string | Uint8Array | number[]);
  if (!data || data.length !== 64) return null;
  const itemId = u64At(data, 0);
  const amount = u128At(data, 32);
  if (itemId == null || amount == null) return null;
  return { from, to, itemId, amount, isMint: /^0+$/.test(from) };
}

/** Parse a `boing_getContractStorage` result (`{ value }` or bare hex) as an unsigned amount. */
export function multiTokenAmountFromStorageWord(word: unknown): bigint {
  let raw: unknown = word;
  if (raw && typeof raw === 'object' && 'value' in raw) raw = (raw as { value: unknown }).value;
  if (typeof raw !== 'string') return 0n;
  const b = toBytes(raw);
  if (!b || b.length !== 32) return 0n;
  return wordToBigInt(b);
}

/** Parse a storage word as 64 lowercase hex (zero word when missing). */
export function multiTokenWordFromStorage(word: unknown): string {
  let raw: unknown = word;
  if (raw && typeof raw === 'object' && 'value' in raw) raw = (raw as { value: unknown }).value;
  if (typeof raw !== 'string') return '00'.repeat(32);
  const h = strip(raw);
  return h.length === 64 && /^[0-9a-f]+$/.test(h) ? h : '00'.repeat(32);
}

/** Extract hex bytecode from a `boing_getContractCode` result (string or `{ bytecode | code }`). */
export function contractCodeHexFromRpc(result: unknown): string | null {
  let raw: unknown = result;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    raw = o.bytecode ?? o.code ?? o.value ?? null;
  }
  if (typeof raw !== 'string') return null;
  const h = strip(raw);
  return h && /^[0-9a-f]+$/.test(h) ? h : null;
}

/** True when `codeHex` is the pinned v1 runtime (or deploy payload). */
export function isReferenceMultiTokenBytecode(codeHex: string | null | undefined): boolean {
  if (!codeHex) return false;
  const c = strip(codeHex);
  return c === REFERENCE_MULTI_TOKEN_RUNTIME_HEX || c === REFERENCE_MULTI_TOKEN_DEPLOY_HEX;
}

/** Parse a user-entered item id (decimal or 0x hex) as a u64. */
export function parseMultiTokenItemId(raw: string): bigint {
  const t = raw.trim();
  if (!/^(0x[0-9a-fA-F]{1,16}|\d{1,20})$/.test(t)) throw new Error('Item id must be a whole number');
  return toU64(BigInt(t));
}

/** Parse a user-entered positive whole quantity as a u128. */
export function parseMultiTokenAmount(raw: string): bigint {
  const t = raw.trim().replace(/[_,\s]/g, '');
  if (!/^\d{1,39}$/.test(t)) throw new Error('Quantity must be a whole number');
  const n = toU128(BigInt(t));
  if (n === 0n) throw new Error('Quantity must be greater than 0');
  return n;
}

function short(h: string): string {
  return `0x${h.slice(0, 6)}…${h.slice(-4)}`;
}

/** One-line human description (wallet approval copy, explorer tx view). */
export function describeMultiTokenCall(
  d: DecodedMultiTokenCall,
  opts?: { itemLabel?: (itemId: bigint) => string | undefined; account?: (hex: string) => string }
): { action: string; summary: string; rows: { label: string; value: string }[] } {
  const item = (id: bigint) => {
    const l = opts?.itemLabel?.(id);
    return l ? `${l} (item #${id})` : `item #${id}`;
  };
  const acct = (h: string) => opts?.account?.(h) ?? short(h);
  const list = (entries: { itemId: bigint; amount: bigint }[]) =>
    entries.map((e) => `${e.amount} × ${item(e.itemId)}`).join(', ');
  switch (d.kind) {
    case 'transfer':
      return {
        action: 'Send items',
        summary: `Send ${d.amount} × ${item(d.itemId)} to ${acct(d.to)}`,
        rows: [
          { label: 'Action', value: 'Transfer game items (multi-token)' },
          { label: 'Item', value: item(d.itemId) },
          { label: 'Quantity', value: d.amount.toString() },
          { label: 'To', value: acct(d.to) },
        ],
      };
    case 'mint':
      return {
        action: 'Mint items',
        summary: `Mint ${d.amount} × ${item(d.itemId)} to ${acct(d.to)}`,
        rows: [
          { label: 'Action', value: 'Mint game items (collection admin only)' },
          { label: 'Item', value: item(d.itemId) },
          { label: 'Quantity', value: d.amount.toString() },
          { label: 'To', value: acct(d.to) },
        ],
      };
    case 'mint_batch':
    case 'transfer_batch': {
      const mint = d.kind === 'mint_batch';
      return {
        action: mint ? 'Mint items' : 'Send items',
        summary: `${mint ? 'Mint' : 'Send'} ${list(d.entries)} to ${acct(d.to)}`,
        rows: [
          {
            label: 'Action',
            value: mint ? 'Mint several item types (collection admin only)' : 'Transfer several item types in one tx',
          },
          { label: 'To', value: acct(d.to) },
          { label: 'Items', value: list(d.entries) },
          { label: 'Entries', value: String(d.entries.length) },
        ],
      };
    }
    case 'set_item_metadata':
      return {
        action: 'Set item metadata',
        summary: `Set metadata for ${item(d.itemId)}`,
        rows: [
          { label: 'Action', value: 'Set item-type metadata hash (collection admin only)' },
          { label: 'Item', value: item(d.itemId) },
          { label: 'Metadata hash', value: `0x${d.metadataHash}` },
        ],
      };
    case 'transfer_admin':
      return {
        action: 'Hand over admin',
        summary: `Give mint rights for this item collection to ${acct(d.newAdmin)}`,
        rows: [
          { label: 'Action', value: 'Transfer collection admin (mint rights)' },
          { label: 'New admin', value: acct(d.newAdmin) },
        ],
      };
    case 'balance_of':
      return {
        action: 'Read balance',
        summary: `Read ${item(d.itemId)} balance of ${acct(d.account)}`,
        rows: [{ label: 'Action', value: 'Read item balance (no state change)' }],
      };
    case 'total_supply':
    case 'item_metadata':
      return {
        action: 'Read item',
        summary: `Read ${d.kind === 'total_supply' ? 'supply' : 'metadata'} of ${item(d.itemId)}`,
        rows: [{ label: 'Action', value: 'Read item info (no state change)' }],
      };
    case 'admin':
      return { action: 'Read admin', summary: 'Read collection admin', rows: [{ label: 'Action', value: 'Read admin' }] };
  }
}
