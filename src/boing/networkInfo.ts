/**
 * Shared parsing + cached fetch of the node's self-description, used by every surface (web, popup, approval):
 *  - `boing_getNetworkInfo` / `boing_health` -> chain id/name, `end_user.explorer_url`, `client_hints`
 *    (`min_wallet_version`, `recommended_wallet_version`, `recommended_sdk`, `sdk_npm_package`) and
 *    `tx_signing.priority_tips_supported` / `priority_tip_domain`. Field names and nesting are exactly the documented ones.
 *  - `boing_getNetworkFeePolicy` -> `optional_priority_tips`, micro-fee and tip-split fields
 *
 * Everything here is tolerant of ABSENCE: older nodes lack fields (or the whole method) and the wallet must keep
 * working, so missing data parses to `undefined` / "unknown", never to an error. Present-but-malformed values are
 * ignored too (a version hint must be semver). Read-only RPCs only (no operator methods).
 * Source of truth: boing.network docs/RPC-API-SPEC.md (`boing_health`, `boing_getNetworkInfo`).
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
  /** `client_hints.min_wallet_version`: oldest Boing Express release that signs correctly for the network (semver, advisory). */
  minWalletVersion?: string;
  /** `client_hints.recommended_wallet_version`: latest tested Boing Express release (semver, advisory). */
  recommendedWalletVersion?: string;
  /** `client_hints.recommended_sdk`: latest tested `@boing-network/boing-sdk` release (semver, advisory). */
  recommendedSdk?: string;
  /** `client_hints.sdk_npm_package`, e.g. `@boing-network/boing-sdk`. */
  sdkNpmPackage?: string;
  /** `tx_signing.priority_tips_supported`; undefined when the node does not say (older nodes). */
  priorityTipsSupported?: boolean;
  /** `tx_signing.priority_tip_domain`, e.g. `BOING_TX_PRIORITY`. */
  priorityTipDomain?: string;
}

/** The signing domain this wallet uses for a non-zero priority tip. */
export const PRIORITY_TIP_DOMAIN = 'BOING_TX_PRIORITY';

const SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** Semver string without a leading `v`, or undefined when it is not semver (hints are advisory: junk is dropped). */
function semver(v: unknown): string | undefined {
  const s = str(v);
  const m = s ? SEMVER.exec(s) : null;
  return m ? m[1] : undefined;
}

/** Parse a `boing_getNetworkInfo` (or `boing_health`) result. Unknown shapes parse to `{}`. */
export function parseNetworkInfo(raw: unknown): NetworkInfoMeta {
  const r = asRecord(raw);
  if (!r) return {};
  const endUser = asRecord(r.end_user);
  const hints = asRecord(r.client_hints);
  const ts = asRecord(r.tx_signing);
  return {
    chainId: num(r.chain_id) ?? num(ts?.chain_id),
    chainName: str(r.chain_name) ?? str(endUser?.chain_display_name),
    explorerUrl: cleanHttpUrl(endUser?.explorer_url),
    faucetUrl: cleanHttpUrl(endUser?.faucet_url),
    minWalletVersion: semver(hints?.min_wallet_version),
    recommendedWalletVersion: semver(hints?.recommended_wallet_version),
    recommendedSdk: semver(hints?.recommended_sdk),
    sdkNpmPackage: str(hints?.sdk_npm_package),
    priorityTipsSupported: typeof ts?.priority_tips_supported === 'boolean' ? ts.priority_tips_supported : undefined,
    priorityTipDomain: str(ts?.priority_tip_domain),
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
  signingCache.clear();
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

/** Cached `boing_health` signing capabilities (tips). Never throws; `{}` (unknown) on failure. */
const signingCache = new Map<string, Entry<NetworkInfoMeta>>();
export async function fetchSigningSupport(rpcUrl: string): Promise<NetworkInfoMeta> {
  const hit = signingCache.get(rpcUrl);
  if (fresh(hit)) return hit.value;
  try {
    const value = parseNetworkInfo(await rpcCall<unknown>(rpcUrl, 'boing_health', []));
    signingCache.set(rpcUrl, { at: Date.now(), ok: true, value });
    return value;
  } catch {
    signingCache.set(rpcUrl, { at: Date.now(), ok: false, value: {} });
    return {};
  }
}

export interface TipSupport {
  /** The wallet may offer a priority tip on this network. */
  allowed: boolean;
  /** Why not, when `allowed` is false. */
  reason?: 'policy' | 'unsupported' | 'domain';
}

/**
 * Whether priority tips can honestly be offered. All three must hold, and each only blocks on an explicit "no"
 * (unknown / absent keeps tips available, like older nodes):
 *  - `boing_getNetworkFeePolicy.optional_priority_tips` is not false,
 *  - `boing_health.tx_signing.priority_tips_supported` is not false,
 *  - `boing_health.tx_signing.priority_tip_domain`, when reported, is the `BOING_TX_PRIORITY` domain this wallet signs.
 */
export async function fetchTipSupport(rpcUrl: string): Promise<TipSupport> {
  const [policy, signing] = await Promise.all([fetchFeePolicy(rpcUrl), fetchSigningSupport(rpcUrl)]);
  if (!policy.tipsAllowed) return { allowed: false, reason: 'policy' };
  if (signing.priorityTipsSupported === false) return { allowed: false, reason: 'unsupported' };
  if (signing.priorityTipDomain !== undefined && signing.priorityTipDomain !== PRIORITY_TIP_DOMAIN) return { allowed: false, reason: 'domain' };
  return { allowed: true };
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