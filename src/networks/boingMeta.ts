/**
 * Runtime discovery from GET https://boing.network/api/networks (same meta as VibeMiner).
 * Applies public testnet RPC + ecosystem URLs when the build does not pin testnet RPC via env.
 */

import { createBoingAdapter } from './boingAdapter';
import type { NetworkAdapter } from './types';
import type { NetworkConfig } from './types';

export const BOING_NETWORKS_API_URL = 'https://boing.network/api/networks';

/** Default TTL for cached meta (browser localStorage / extension storage). */
export const BOING_META_CACHE_TTL_MS = 60 * 60 * 1000;

export type BoingEcosystemMeta = {
  wallet_url?: string;
  explorer_url?: string;
  website_url?: string;
  wallet_docs?: string;
  explorer_and_wallet_spec?: string;
  three_codebase_alignment?: string;
};

export type BoingNetworksMeta = {
  boing_testnet_download_tag?: string;
  chain_id_hex?: string;
  public_testnet_rpc_url?: string;
  official_bootnodes?: string[];
  cli_long_flags?: string;
  ecosystem?: BoingEcosystemMeta;
  docs?: Record<string, string>;
};

export type BoingNetworksApiResponse = {
  ok?: boolean;
  meta?: BoingNetworksMeta;
  networks?: unknown[];
  message?: string;
};

export type BoingMetaCacheEntry = {
  fetchedAt: number;
  meta: BoingNetworksMeta;
};

export function normalizeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function isBoingMetaCacheStale(entry: BoingMetaCacheEntry | null, ttlMs: number = BOING_META_CACHE_TTL_MS): boolean {
  if (!entry || typeof entry.fetchedAt !== 'number') return true;
  return Date.now() - entry.fetchedAt > ttlMs;
}

/**
 * When testnet RPC is not pinned by env, prefer `meta.public_testnet_rpc_url` (official tunnel).
 */
export function resolveTestnetRpcWithMeta(
  envResolvedTestnetRpc: string,
  testnetRpcPinnedByEnv: boolean,
  meta: BoingNetworksMeta | null | undefined
): string {
  if (testnetRpcPinnedByEnv) return envResolvedTestnetRpc;
  const fromMeta = normalizeHttpsUrl(meta?.public_testnet_rpc_url);
  return fromMeta || envResolvedTestnetRpc;
}

/** Apply explorer + faucet URLs from meta (RPC is resolved separately). */
export function applyBoingMetaToAdapters(
  adapters: NetworkAdapter[],
  meta: BoingNetworksMeta | null | undefined
): NetworkAdapter[] {
  if (!meta) return adapters;

  return adapters.map((adapter) => {
    if (adapter.config.id !== 'boing-testnet') return adapter;

    const next: NetworkConfig = { ...adapter.config };
    const explorer = normalizeHttpsUrl(meta.ecosystem?.explorer_url);
    if (explorer) next.explorerUrl = explorer;

    const website = normalizeHttpsUrl(meta.ecosystem?.website_url);
    if (website) {
      next.faucetUrl = `${website.replace(/\/$/, '')}/faucet`;
    }

    if (
      next.rpcUrl === adapter.config.rpcUrl &&
      next.explorerUrl === adapter.config.explorerUrl &&
      next.faucetUrl === adapter.config.faucetUrl
    ) {
      return adapter;
    }

    return createBoingAdapter(next);
  });
}

export function parseBoingNetworksApiBody(json: unknown): BoingNetworksMeta | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as BoingNetworksApiResponse;
  if (body.ok !== true || !body.meta || typeof body.meta !== 'object') return null;
  return body.meta;
}

const FETCH_BOING_META_TIMEOUT_MS = 15_000;

export async function fetchBoingNetworksMeta(signal?: AbortSignal): Promise<BoingNetworksMeta | null> {
  const timeoutController = new AbortController();
  const tid =
    signal != null
      ? null
      : setTimeout(() => {
          timeoutController.abort();
        }, FETCH_BOING_META_TIMEOUT_MS);
  try {
    const res = await fetch(BOING_NETWORKS_API_URL, {
      signal: signal ?? timeoutController.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseBoingNetworksApiBody(json);
  } catch {
    return null;
  } finally {
    if (tid != null) clearTimeout(tid);
  }
}
