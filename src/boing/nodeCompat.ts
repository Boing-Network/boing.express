/**
 * Runtime wallet <-> node compatibility check.
 *
 * The wallet ships with a configured chain id per network (src/networks/chainIds.ts) but the node at
 * the RPC URL is the source of truth for what it signs for. This module reads `boing_health`
 * (chain_id, client_version, tx_signing, rpc_surface) and reports, in plain language, when the node
 * does not match what the user selected. Pure evaluation (`evaluateNodeHealth`) is separated from I/O
 * (`checkNodeCompat`) so it can be unit tested against fixtures copied from a real node.
 *
 * Source of truth: boing.network docs/RPC-API-SPEC.md (`boing_health`) and docs/BOING-SIGNED-TRANSACTION-ENCODING.md.
 */

import { rpcCall } from './rpc';

export type NodeCompatLevel = 'ok' | 'warn' | 'error';

export type NodeCompatIssueCode =
  | 'unreachable'
  | 'chain_mismatch'
  | 'no_chain_id'
  | 'signing_v2_unsupported'
  | 'node_too_old';

export interface NodeCompatIssue {
  code: NodeCompatIssueCode;
  level: Exclude<NodeCompatLevel, 'ok'>;
  /** Plain-language message safe to show to end users. */
  message: string;
}

export interface NodeCompatStatus {
  level: NodeCompatLevel;
  issues: NodeCompatIssue[];
  /** `boing_health.chain_id` (null when absent: older nodes / local dev chains). */
  nodeChainId: number | null;
  /** Raw `client_version`, e.g. `boing-node/0.1.0`. */
  clientVersion: string | null;
  /** True when the node accepts chain-bound (V2) signatures. */
  v2Signing: boolean;
  /** True when the node accepts native atomic batch transactions. */
  txBatch: boolean;
  checkedAt: number;
}

/**
 * Oldest `boing-node` semver this wallet is tested against. Nodes older than this lack features the
 * wallet relies on (chain-bound signing, `network_fee` in simulation). Update together with the SDK pin.
 */
export const MIN_SUPPORTED_NODE_VERSION = '0.1.0';

/** Parse `boing-node/0.1.0` (or bare `0.1.0`) into [major, minor, patch]; null when unparseable. */
export function parseNodeVersion(clientVersion: string | null | undefined): [number, number, number] | null {
  if (!clientVersion) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(clientVersion);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Evaluate a `boing_health` result against the network the user selected.
 * `expected.chainId` is the configured chain id (decimal) or null for networks without one (local dev).
 */
export function evaluateNodeHealth(
  health: unknown,
  expected: { chainId: number | null; networkName?: string },
  now: number = Date.now()
): NodeCompatStatus {
  const h = asRecord(health);
  const issues: NodeCompatIssue[] = [];
  const name = expected.networkName ?? 'the selected network';
  if (!h) {
    return {
      level: 'warn',
      issues: [{ code: 'unreachable', level: 'warn', message: `Could not read status from ${name}. Balances may be out of date.` }],
      nodeChainId: null,
      clientVersion: null,
      v2Signing: false,
      txBatch: false,
      checkedAt: now,
    };
  }
  const ts = asRecord(h.tx_signing);
  const surface = asRecord(h.rpc_surface);
  const nodeChainId = finiteNumber(h.chain_id) ?? finiteNumber(ts?.chain_id);
  const signingChainId = finiteNumber(ts?.chain_id);
  const clientVersion = typeof h.client_version === 'string' ? h.client_version : null;
  const v2Signing = ts?.v2_supported === true;

  if (expected.chainId != null) {
    if (nodeChainId == null) {
      issues.push({
        code: 'no_chain_id',
        level: 'warn',
        message: `This node did not report a chain id, so Boing Express cannot confirm it is ${name}. Only continue if you trust this node.`,
      });
    } else if (nodeChainId !== expected.chainId || (signingChainId != null && signingChainId !== expected.chainId)) {
      const reported = signingChainId != null && signingChainId !== nodeChainId ? signingChainId : nodeChainId;
      issues.push({
        code: 'chain_mismatch',
        level: 'error',
        message: `Wrong network: you selected ${name} (chain ${expected.chainId}) but this node is on chain ${reported}. Sending is blocked to protect your funds. Switch networks or fix the RPC URL.`,
      });
    }
  }

  if (ts && ts.v2_required === true && !v2Signing) {
    issues.push({
      code: 'signing_v2_unsupported',
      level: 'error',
      message: 'This node requires chain-bound signatures but did not advertise support for them. Transactions would be rejected.',
    });
  }

  const parsed = parseNodeVersion(clientVersion);
  const min = parseNodeVersion(MIN_SUPPORTED_NODE_VERSION);
  if (parsed && min && compareVersions(parsed, min) < 0) {
    issues.push({
      code: 'node_too_old',
      level: 'warn',
      message: `This node (${clientVersion}) is older than the version Boing Express was tested with (${MIN_SUPPORTED_NODE_VERSION}). Some features may not work.`,
    });
  }

  const level: NodeCompatLevel = issues.some((i) => i.level === 'error') ? 'error' : issues.length > 0 ? 'warn' : 'ok';
  return {
    level,
    issues,
    nodeChainId,
    clientVersion,
    v2Signing,
    txBatch: surface?.tx_payload_batch === true,
    checkedAt: now,
  };
}

const compatCache = new Map<string, { at: number; status: NodeCompatStatus }>();
/** Healthy results are reused for a minute; failures are retried after 5 s. */
const OK_TTL_MS = 60_000;
const FAIL_TTL_MS = 5_000;

/** Test hook. */
export function clearNodeCompatCache(): void {
  compatCache.clear();
}

/**
 * Probe `boing_health` on `rpcUrl` (bounded by the RPC client's timeout) and evaluate it.
 * Never throws: network failures become an `unreachable` warning.
 */
export async function checkNodeCompat(
  rpcUrl: string,
  expected: { chainId: number | null; networkName?: string },
  opts: { force?: boolean; now?: () => number } = {}
): Promise<NodeCompatStatus> {
  const now = opts.now ?? Date.now;
  const key = `${rpcUrl}|${expected.chainId ?? ''}`;
  const hit = compatCache.get(key);
  if (!opts.force && hit) {
    const ttl = hit.status.issues.some((i) => i.code === 'unreachable') ? FAIL_TTL_MS : OK_TTL_MS;
    if (now() - hit.at < ttl) return hit.status;
  }
  let status: NodeCompatStatus;
  try {
    status = evaluateNodeHealth(await rpcCall<unknown>(rpcUrl, 'boing_health', []), expected, now());
  } catch {
    status = evaluateNodeHealth(null, expected, now());
  }
  compatCache.set(key, { at: now(), status });
  return status;
}

/** Configured chain id string (`'0x1b01'` or decimal) -> decimal number, or null. */
export function configuredChainIdDecimal(chainId: string | undefined): number | null {
  if (!chainId) return null;
  const t = chainId.trim();
  try {
    const n = /^0x/i.test(t) ? Number(BigInt(t)) : Number(t);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}