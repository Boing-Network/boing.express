/**
 * Decode common Boing contract-call selectors into human-readable approval intent.
 * Used by the extension + web signing prompts so users are not left with opaque hex alone.
 *
 * Selectors match boing-sdk / reference token / native AMM / custody router / wBOING docs.
 */

import type { AccountId } from './types';
import { formatAddress } from './types';
import { BOING_BASE_DECIMALS, formatNative } from './nativeUnit';

/** Optional dApp-supplied approval copy (`display` or `description` on the tx JSON). */
export const DAPP_DISPLAY_MAX_CHARS = 280;

export function dappDisplayHintFromJson(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  for (const key of ['display', 'description'] as const) {
    const v = o[key];
    if (typeof v !== 'string') continue;
    const t = v.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    return t.length > DAPP_DISPLAY_MAX_CHARS ? `${t.slice(0, DAPP_DISPLAY_MAX_CHARS - 1)}…` : t;
  }
  return undefined;
}

export type CalldataIntent = {
  /** Short action label, e.g. "Approve for swap". */
  action: string;
  /** One-line sentence for Operation / summary. */
  summary: string;
  /** Extra structured rows (spender, amount, …). */
  rows: { label: string; value: string }[];
};

function selectorByte(calldata: Uint8Array): number | null {
  if (calldata.length < 32) return null;
  for (let i = 0; i < 31; i++) if (calldata[i] !== 0) return null;
  return calldata[31]!;
}

function readAccountWord(calldata: Uint8Array, wordIndex: number): AccountId | null {
  const off = wordIndex * 32;
  if (calldata.length < off + 32) return null;
  return calldata.subarray(off, off + 32) as AccountId;
}

function readU128Word(calldata: Uint8Array, wordIndex: number): bigint | null {
  const off = wordIndex * 32;
  if (calldata.length < off + 32) return null;
  // High 16 bytes of the word must be zero for u128 amounts.
  for (let i = 0; i < 16; i++) if (calldata[off + i] !== 0) return null;
  let v = 0n;
  for (let i = 16; i < 32; i++) v = (v << 8n) | BigInt(calldata[off + i]!);
  return v;
}

function fmtTokenAmount(amount: bigint): string {
  return amount.toString();
}

function addr(a: AccountId): string {
  return formatAddress(a, true);
}

/**
 * Best-effort decode of reference-token / AMM / router / wBOING calldata.
 * Returns null when the layout is unknown (UI falls back to generic contract call).
 */
export function describeCalldataIntent(
  calldata: Uint8Array,
  opts?: { value?: bigint; decimals?: number }
): CalldataIntent | null {
  const sel = selectorByte(calldata);
  if (sel == null) return null;
  const value = opts?.value;

  // Reference fungible v2: approve(spender, amount) — 96 bytes, selector 0x08
  if (sel === 0x08 && calldata.length === 96) {
    const spender = readAccountWord(calldata, 1);
    const amount = readU128Word(calldata, 2);
    if (!spender || amount == null) return null;
    return {
      action: 'Approve',
      summary: `Approve ${fmtTokenAmount(amount)} tokens for ${addr(spender)}`,
      rows: [
        { label: 'Action', value: 'Approve allowance for swap / spend' },
        { label: 'Spender', value: addr(spender) },
        { label: 'Amount', value: fmtTokenAmount(amount) },
      ],
    };
  }

  // Reference fungible: transfer(to, amount) — 96 bytes, selector 0x01
  if (sel === 0x01 && calldata.length === 96) {
    const to = readAccountWord(calldata, 1);
    const amount = readU128Word(calldata, 2);
    if (!to || amount == null) return null;
    return {
      action: 'Send',
      summary: `Send ${fmtTokenAmount(amount)} tokens to ${addr(to)}`,
      rows: [
        { label: 'Action', value: 'Send tokens' },
        { label: 'To', value: addr(to) },
        { label: 'Amount', value: fmtTokenAmount(amount) },
      ],
    };
  }

  // transfer_from(from, to, amount) — 128 bytes, selector 0x09
  if (sel === 0x09 && calldata.length === 128) {
    const from = readAccountWord(calldata, 1);
    const to = readAccountWord(calldata, 2);
    const amount = readU128Word(calldata, 3);
    if (!from || !to || amount == null) return null;
    return {
      action: 'Transfer from',
      summary: `Move ${fmtTokenAmount(amount)} tokens from ${addr(from)} to ${addr(to)}`,
      rows: [
        { label: 'Action', value: 'Transfer from (spend allowance)' },
        { label: 'From', value: addr(from) },
        { label: 'To', value: addr(to) },
        { label: 'Amount', value: fmtTokenAmount(amount) },
      ],
    };
  }

  // Native AMM swap(direction, amountIn, minOut) — 128 bytes, selector 0x10
  if (sel === 0x10 && calldata.length === 128) {
    const direction = readU128Word(calldata, 1);
    const amountIn = readU128Word(calldata, 2);
    const minOut = readU128Word(calldata, 3);
    if (direction == null || amountIn == null || minOut == null) return null;
    const dirLabel = direction === 0n ? 'A→B' : direction === 1n ? 'B→A' : `dir ${direction}`;
    return {
      action: 'Swap',
      summary: `Swap ${fmtTokenAmount(amountIn)} (${dirLabel}), min out ${fmtTokenAmount(minOut)}`,
      rows: [
        { label: 'Action', value: 'Swap on pool' },
        { label: 'Direction', value: dirLabel },
        { label: 'Amount in', value: fmtTokenAmount(amountIn) },
        { label: 'Minimum out', value: fmtTokenAmount(minOut) },
      ],
    };
  }

  // Native AMM swap_to — 160 bytes, selector 0x15
  if (sel === 0x15 && calldata.length === 160) {
    const direction = readU128Word(calldata, 1);
    const amountIn = readU128Word(calldata, 2);
    const minOut = readU128Word(calldata, 3);
    const recipient = readAccountWord(calldata, 4);
    if (direction == null || amountIn == null || minOut == null || !recipient) return null;
    const dirLabel = direction === 0n ? 'A→B' : direction === 1n ? 'B→A' : `dir ${direction}`;
    return {
      action: 'Swap',
      summary: `Swap ${fmtTokenAmount(amountIn)} (${dirLabel}) to ${addr(recipient)}, min out ${fmtTokenAmount(minOut)}`,
      rows: [
        { label: 'Action', value: 'Swap on pool (to recipient)' },
        { label: 'Direction', value: dirLabel },
        { label: 'Amount in', value: fmtTokenAmount(amountIn) },
        { label: 'Minimum out', value: fmtTokenAmount(minOut) },
        { label: 'Recipient', value: addr(recipient) },
      ],
    };
  }

  // Custody router swap 0xf1: hops, amountIn, minOut, recipient, deadline, then hop triples
  if (sel === 0xf1 && calldata.length >= 192) {
    const hopCount = readU128Word(calldata, 1);
    const amountIn = readU128Word(calldata, 2);
    const minOut = readU128Word(calldata, 3);
    const recipient = readAccountWord(calldata, 4);
    if (hopCount == null || amountIn == null || minOut == null || !recipient) return null;
    const hops = Number(hopCount);
    if (!Number.isFinite(hops) || hops < 1 || hops > 4) return null;
    const expected = 192 + hops * 96;
    if (calldata.length !== expected) return null;
    return {
      action: 'Swap',
      summary: `Swap ${fmtTokenAmount(amountIn)} via router (${hops} hop${hops === 1 ? '' : 's'}), min out ${fmtTokenAmount(minOut)} → ${addr(recipient)}`,
      rows: [
        { label: 'Action', value: 'Swap via custody router' },
        { label: 'Amount in', value: fmtTokenAmount(amountIn) },
        { label: 'Minimum out', value: fmtTokenAmount(minOut) },
        { label: 'Recipient', value: addr(recipient) },
        { label: 'Hops', value: String(hops) },
      ],
    };
  }

  // wBOING deposit 0x20 (32-byte selector only) — value is the BOING wrapped
  if (sel === 0x20 && calldata.length === 32) {
    const dec = opts?.decimals != null && opts.decimals >= 0 ? opts.decimals : BOING_BASE_DECIMALS;
    const amountLabel =
      value != null && value > 0n ? `${formatNative(value, dec, Math.max(dec, 0))} BOING` : null;
    return {
      action: 'Wrap',
      summary: amountLabel ? `Wrap ${amountLabel} into wBOING` : 'Wrap BOING into wBOING',
      rows: [
        { label: 'Action', value: 'Wrap BOING (deposit to wBOING)' },
        ...(amountLabel ? [{ label: 'Amount', value: amountLabel }] : []),
      ],
    };
  }

  // wBOING withdraw 0x21 — 64 bytes
  if (sel === 0x21 && calldata.length === 64) {
    const amount = readU128Word(calldata, 1);
    if (amount == null) return null;
    return {
      action: 'Unwrap',
      summary: `Unwrap ${fmtTokenAmount(amount)} wBOING to BOING`,
      rows: [
        { label: 'Action', value: 'Unwrap wBOING to BOING' },
        { label: 'Amount', value: fmtTokenAmount(amount) },
      ],
    };
  }

  // wBOING withdraw_all 0x23
  if (sel === 0x23 && calldata.length === 32) {
    return {
      action: 'Unwrap',
      summary: 'Unwrap all wBOING to BOING',
      rows: [{ label: 'Action', value: 'Unwrap all wBOING to native BOING' }],
    };
  }

  // add_liquidity 0x11 — 128 bytes
  if (sel === 0x11 && calldata.length === 128) {
    const a = readU128Word(calldata, 1);
    const b = readU128Word(calldata, 2);
    const minLp = readU128Word(calldata, 3);
    if (a == null || b == null || minLp == null) return null;
    return {
      action: 'Add liquidity',
      summary: `Add liquidity ${fmtTokenAmount(a)} + ${fmtTokenAmount(b)} (min LP ${fmtTokenAmount(minLp)})`,
      rows: [
        { label: 'Action', value: 'Add liquidity' },
        { label: 'Amount A', value: fmtTokenAmount(a) },
        { label: 'Amount B', value: fmtTokenAmount(b) },
        { label: 'Min LP', value: fmtTokenAmount(minLp) },
      ],
    };
  }

  return null;
}
