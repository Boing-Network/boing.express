/**
 * Native BOING denomination (18 decimals: 1 BOING = 10^18 base units; boing.network
 * `docs/NATIVE-DENOMINATION.md`). Nodes return native amounts in **ledger units**: base units on chains
 * without history and on testnet 6913 from height 1050, whole BOING before it. `native_currency` in
 * `boing_getNetworkInfo` says which; older nodes report `decimals: 0` only.
 */
import { rpcCall } from './rpc';

export const BOING_BASE_DECIMALS = 18;
/** Fee per gas in base units under the 18-decimals rule (0.000001 BOING). */
export const GAS_PRICE_BASE_UNITS = 1_000_000_000_000n;
/** Whole-BOING rule (before the switch): 21,000 gas = 1 BOING, rounded up. */
export const GAS_UNITS_PER_WHOLE_BOING = 21_000n;

export interface NativeCurrencyInfo {
  symbol?: string;
  decimals?: number;
  base_unit_decimals?: number;
  base_units_from_height?: number | null;
  gas_price_base_units?: string;
}

/** Ledger decimals (0 or 18) for amounts committed at `height`. */
export function ledgerDecimalsAt(info: NativeCurrencyInfo | null | undefined, height: number): number {
  if (!info) return 0;
  if (info.base_units_from_height === undefined) return info.decimals ?? 0;
  if (info.base_units_from_height === null) return info.base_unit_decimals ?? BOING_BASE_DECIMALS;
  return height >= info.base_units_from_height ? (info.base_unit_decimals ?? BOING_BASE_DECIMALS) : 0;
}

/** Network fee for `gasUsed` in ledger units of the given decimals. */
export function feeFromGasForDecimals(gasUsed: bigint, decimals: number): bigint {
  if (gasUsed <= 0n) return 0n;
  if (decimals >= BOING_BASE_DECIMALS) return gasUsed * GAS_PRICE_BASE_UNITS;
  return (gasUsed + GAS_UNITS_PER_WHOLE_BOING - 1n) / GAS_UNITS_PER_WHOLE_BOING;
}

/** One whole BOING in ledger units. */
export function oneBoing(decimals: number): bigint {
  return 10n ** BigInt(Math.max(0, decimals));
}

/** Last ledger decimals seen per RPC URL (balance responses / network info). */
const lastDecimals = new Map<string, number>();
const infoCache = new Map<string, { info: NativeCurrencyInfo | null; head: number; at: number }>();
const INFO_TTL_MS = 30_000;

export function rememberLedgerDecimals(rpcUrl: string, decimals: number): void {
  lastDecimals.set(rpcUrl, decimals);
}

/** Synchronous best guess (last seen; 0 until the node has been asked). */
export function knownLedgerDecimals(rpcUrl: string): number {
  return lastDecimals.get(rpcUrl) ?? 0;
}

/** `native_currency` + head height from `boing_getNetworkInfo` (cached 30 s; null on old/failed nodes). */
export async function fetchNativeCurrency(rpcUrl: string): Promise<{ info: NativeCurrencyInfo | null; head: number }> {
  const hit = infoCache.get(rpcUrl);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit;
  try {
    const r = await rpcCall<{ native_currency?: NativeCurrencyInfo; head_height?: number }>(rpcUrl, 'boing_getNetworkInfo', []);
    const entry = { info: r?.native_currency ?? null, head: Number(r?.head_height ?? 0), at: Date.now() };
    infoCache.set(rpcUrl, entry);
    if (entry.info) rememberLedgerDecimals(rpcUrl, ledgerDecimalsAt(entry.info, entry.head));
    return entry;
  } catch {
    return { info: null, head: 0 };
  }
}

/** Ledger decimals of the node's current state. */
export async function currentLedgerDecimals(rpcUrl: string): Promise<number> {
  const { info, head } = await fetchNativeCurrency(rpcUrl);
  return info ? ledgerDecimalsAt(info, head) : knownLedgerDecimals(rpcUrl);
}

/** Format a ledger amount as BOING (thousands separators off; trailing zeros trimmed). */
export function formatNative(raw: bigint | string, decimals: number, maxFractionDigits = 6): string {
  let v: bigint;
  try {
    v = typeof raw === 'bigint' ? raw : BigInt(raw.trim());
  } catch {
    return String(raw);
  }
  if (decimals <= 0) return v.toString();
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  if (frac === '' && v % base !== 0n && v < base) {
    // Tiny non-zero amount below the shown precision.
    return `<0.${'0'.repeat(Math.max(0, maxFractionDigits - 1))}1`;
  }
  return frac ? `${whole}.${frac}` : whole.toString();
}
