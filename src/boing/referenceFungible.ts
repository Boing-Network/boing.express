/**
 * Boing reference fungible token (v1 and v2 templates; also the secured template / LP share token):
 * transfer calldata, balance reads, and a send helper that keeps the v1 self-transfer guard.
 * Layout mirrors boing-sdk `referenceToken.ts` / `boingToken.ts` (docs/BOING-REFERENCE-TOKEN.md).
 */

import type { AccountId } from './types';
import { accountIdFromHex, accountIdToHex } from './types';
import { isReferenceSelfTransferCalldata, SELF_TRANSFER_REFUSED } from './dappTxRequest';
import { normalizeHex64 } from './referenceNft';
import * as rpc from './rpc';
import type { NetworkAdapter } from '../networks/types';

/** Selector low byte of reference `transfer(to, amount)` (same in v1 and v2). */
export const REF_FUNGIBLE_SELECTOR_TRANSFER = 0x01;

const U128_MAX = (1n << 128n) - 1n;

/** `REFERENCE_FUNGIBLE_BALANCE_XOR`: ASCII "BOING_REFFUNGIBLE_BAL1" right-padded with zeros to 32 bytes. */
const BALANCE_XOR: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode('BOING_REFFUNGIBLE_BAL1'));
  return out;
})();

function hex64ToBytes(hex64: string): Uint8Array {
  const h = normalizeHex64(hex64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHexNo0x(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** 96-byte `transfer(to, amount)` calldata: selector word, `to` word, u128 BE amount word. */
export function encodeReferenceFungibleTransferCalldata(toHex: string, amount: bigint): Uint8Array {
  if (amount <= 0n || amount > U128_MAX) throw new Error('Token amount must be between 1 and u128 max');
  const out = new Uint8Array(96);
  out[31] = REF_FUNGIBLE_SELECTOR_TRANSFER;
  out.set(hex64ToBytes(toHex), 32);
  let v = amount;
  for (let i = 95; i >= 80; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** `boing_getContractStorage` key (64 hex, no 0x) of `holder`'s balance. */
export function referenceFungibleBalanceStorageKey(holderHex: string): string {
  const h = hex64ToBytes(holderHex);
  for (let i = 0; i < 32; i++) h[i] = h[i]! ^ BALANCE_XOR[i]!;
  return bytesToHexNo0x(h);
}

/** Decode a storage word (hex string, with or without 0x; or null/empty = 0) to a u128 balance. */
export function decodeReferenceFungibleBalanceWord(word: unknown): bigint {
  let s = '';
  if (typeof word === 'string') s = word;
  else if (word && typeof word === 'object') {
    const o = word as Record<string, unknown>;
    const v = o.value ?? o.word ?? o.data;
    if (typeof v === 'string') s = v;
  }
  s = s.trim().replace(/^0x/i, '');
  if (s === '' || /^0+$/.test(s)) return 0n;
  if (!/^[0-9a-f]+$/i.test(s) || s.length > 64) throw new Error('Unexpected storage word');
  const v = BigInt(`0x${s}`);
  if (v > U128_MAX) throw new Error('Balance word exceeds u128');
  return v;
}

export async function fetchReferenceFungibleBalance(
  rpcUrl: string,
  tokenHex: string,
  holderHex: string
): Promise<bigint> {
  const word = await rpc.getContractStorage(rpcUrl, normalizeHex64(tokenHex), referenceFungibleBalanceStorageKey(holderHex));
  return decodeReferenceFungibleBalanceWord(word);
}

/**
 * Build + sign a reference token transfer. Refuses `to == sender` before signing (v1 templates double the
 * balance on self-transfer; v2 makes it a no-op), the same guard the dApp signing path applies.
 */
export async function buildReferenceFungibleTransfer(options: {
  network: NetworkAdapter;
  sender: AccountId;
  tokenHex: string;
  toHex: string;
  amount: bigint;
  nonce: bigint;
  privateKey: Uint8Array;
}): Promise<string> {
  const { network, sender } = options;
  if (!network.buildContractCall) throw new Error('This network cannot send contract calls');
  const tokenHex = normalizeHex64(options.tokenHex);
  const toHex = normalizeHex64(options.toHex);
  if (tokenHex === accountIdToHex(sender).replace(/^0x/i, '').toLowerCase()) {
    throw new Error('Token contract cannot be your own address');
  }
  const calldata = encodeReferenceFungibleTransferCalldata(toHex, options.amount);
  if (isReferenceSelfTransferCalldata(sender, calldata)) throw new Error(SELF_TRANSFER_REFUSED);
  return network.buildContractCall(sender, accountIdFromHex(tokenHex), calldata, options.nonce, options.privateKey);
}
