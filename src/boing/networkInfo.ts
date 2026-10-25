/**
 * Shared parsing + cached fetch of the node's self-description, used by every surface (web, popup, approval):
 *  - `boing_getNetworkInfo`      -> chain id/name, `end_user.explorer_url`, optional `min_wallet_version` / `recommended_sdk`
 *  - `boing_getNetworkFeePolicy` -> `optional_priority_tips`, micro-fee and tip-split fields
 *
 * Everything here is tolerant: older nodes lack fields (or the whole method) and the wallet must keep working,
 * so absent data parses to `undefined` / "unknown", never to an error. Read-only RPCs only (no operator methods).
 * Source of truth: boing.network docs/RPC-API-SPEC.md.
 */
import { rpcCall } from './rpc';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function bigintOf(v: unknown): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return undefined;
}

/** http(s) URL without a trailing slash, or undefined. */
export function cleanHttpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export interface NetworkInfoMeta {
  chainId?: number;
  chainName?: string;
  /** `end_user.explorer_url` (null / absent on nodes without `BOING_EXPLORER_URL`). */
  explorerUrl?: string;
  faucetUrl?: string;
  /** Oldest Boing Express the node operator supports (semver). Not in the spec yet: absent is normal. */
  minWalletVersion?: string;
  /** Operator's recommended `@boing-network/boing-sdk` version. Not in the spec yet: absent is normal. */
  recommendedSdk?: string;
}

/** Parse a `boing_getNetworkInfo` (or `boing_health`) result. Unknown shapes parse to `{}`. */
export function parseNetworkInfo(raw: unknown): NetworkInfoMeta {
  const r = asRecord(raw);
  if (!r) return {};
  const endUser = asRecord(r.end_user);
  const wallet = asRecord(r.wallet) ?? asRecord(r.client_requirements);
  const ts = asRecord(r.tx_signing);
  return {
    chainId: num(r.chain_id) ?? num(ts?.chain_id),
    chainName: str(r.chain_name) ?? str(endUser?.chain_display_name),
    explorerUrl: cleanHttpUrl(endUser?.explorer_url),
    faucetUrl: cleanHttpUrl(endUser?.faucet_url),
    minWalletVersion: str(r.min_wallet_version) ?? str(wallet?.min_wallet_version) ?? str(wallet?.min_version),
    recommendedSdk: str(r.recommended_sdk) ?? str(wallet?.recommended_sdk),
  };
}

/** Merge `boing_health` and `boing_getNetworkInfo` metadata (first defined value wins, health first). */
export function mergeNetworkInfo(...parts: NetworkInfoMeta[]): NetworkInfoMeta {
  const out: NetworkInfoMeta = {};
  for (const p of parts) {
    for (const k of Object.keys(p) as (keyof NetworkInfoMeta)[]) {
      if (out[k] === undefined && p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
    }
  }
  return out;
}

export interface FeePolicy {
  /** False only when the node says `optional_priority_tips: false`. Unknown (old node / RPC error) is treated as true. */
  tipsAllowed: boolean;
  /** True when the node answered; false when this is the unknown fallback. */
  known: boolean;
  microFeeExecutionGasBps?: number;
  executionGasFeeBps?: number;
  gasPriceBaseUnits?: bigint;
  tipProposerBps?: number;
  tipTreasuryBps?: number;
  tipBurnBps?: number;
}

export const UNKNOWN_FEE_POLICY: FeePolicy = { tipsAllowed: true, known: false };

/** Parse a `boing_getNetworkFeePolicy` result. */
export function parseFeePolicy(raw: unknown): FeePolicy {
  const r = asRecord(raw);
  if (!r) return { ...UNKNOWN_FEE_POLICY };
  return {
    tipsAllowed: r.optional_priority_tips !== false,
    known: true,
    microFeeExecutionGasBps: num(r.micro_fee_execution_gas_bps),
    executionGasFeeBps: num(r.execution_gas_fee_bps),
    gasPriceBaseUnits: bigintOf(r.gas_price_base_units),
    tipProposerBps: num(r.tip_proposer_bps),
    tipTreasuryBps: num(r.tip_treasury_bps),
    tipBurnBps: num(r.tip_burn_bps),
  };
}

const TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 10_000;
type Entry<T> = { at: number; ok: boolean; value: T };
const infoCache = new Map<string, Entry<NetworkInfoMeta>>();
const policyCache = new Map<string, Entry<FeePolicy>>();

/** Test hook. */
export function clearNetworkInfoCaches(): void {
  infoCache.clear();
  policyCache.clear();
}

function fresh<T>(e: Entry<T> | undefined): e is Entry<T> {
  return !!e && Date.now() - e.at < (e.ok ? TTL_MS : FAIL_TTL_MS);
}

/** Cached `boing_getNetworkInfo` metadata. Never throws; `{}` on failure. */
export async function fetchNetworkInfoMeta(rpcUrl: string): Promise<NetworkInfoMeta> {
  const hit = infoCache.get(rpcUrl);
  if (fresh(hit)) return hit.value;
  try {
    const value = parseNetworkInfo(await rpcCall<unknown>(rpcUrl, 'boing_getNetworkInfo', []));
    infoCache.set(rpcUrl, { at: Date.now(), ok: true, value });
    return value;
  } catch {
    infoCache.set(rpcUrl, { at: Date.now(), ok: false, value: {} });
    return {};
  }
}

/** Cached `boing_getNetworkFeePolicy`. Never throws; the unknown fallback keeps tips available. */
export async function fetchFeePolicy(rpcUrl: string): Promise<FeePolicy> {
  const hit = policyCache.get(rpcUrl);
  if (fresh(hit)) return hit.value;
  try {
    const value = parseFeePolicy(await rpcCall<unknown>(rpcUrl, 'boing_getNetworkFeePolicy', []));
    policyCache.set(rpcUrl, { at: Date.now(), ok: true, value });
    return value;
  } catch {
    policyCache.set(rpcUrl, { at: Date.now(), ok: false, value: { ...UNKNOWN_FEE_POLICY } });
    return { ...UNKNOWN_FEE_POLICY };
  }
}