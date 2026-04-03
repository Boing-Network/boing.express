import { buildNetworksCatalog } from './buildNetworksCatalog';
import { fetchBoingNetworksMeta, type BoingNetworksMeta } from './boingMeta';
import type { NetworkAdapter } from './types';
import {
  loadBoingMetaCacheWeb,
  saveBoingMetaCacheWeb,
  shouldRefreshBoingMetaWeb,
} from '../storage/boingMetaCache';
import { getWebEnvMainnetRpc, getWebEnvTestnetRpc, isWebTestnetRpcPinnedByEnv } from './webNetworkEnv';

export type WebCatalogRefreshResult = {
  catalog: NetworkAdapter[];
  meta: BoingNetworksMeta | null;
  /** True when a live fetch succeeded this call. */
  fetchedLive: boolean;
  /** Human hint for UI when live fetch failed but cache exists. */
  usedStaleCache: boolean;
  /** Cache was still within TTL so no HTTP request was made. */
  skippedLiveFetch: boolean;
};

function buildWebCatalog(meta: BoingNetworksMeta | null): NetworkAdapter[] {
  return buildNetworksCatalog({
    envTestnetRpc: getWebEnvTestnetRpc(),
    testnetRpcPinnedByEnv: isWebTestnetRpcPinnedByEnv(),
    envMainnetRpc: getWebEnvMainnetRpc(),
    meta,
  });
}

/** Synchronous catalog from localStorage cache only (no network). */
export function getInitialWebNetworkCatalog(): NetworkAdapter[] {
  const cached = loadBoingMetaCacheWeb();
  return buildWebCatalog(cached?.meta ?? null);
}

/**
 * Refresh meta when cache is stale or missing; always returns a catalog (defaults if everything fails).
 */
export async function refreshWebNetworkCatalog(signal?: AbortSignal): Promise<WebCatalogRefreshResult> {
  const cached = loadBoingMetaCacheWeb();
  let meta: BoingNetworksMeta | null = cached?.meta ?? null;
  let fetchedLive = false;
  let usedStaleCache = false;
  let skippedLiveFetch = false;

  if (shouldRefreshBoingMetaWeb(cached)) {
    try {
      const live = await fetchBoingNetworksMeta(signal);
      if (live) {
        meta = live;
        saveBoingMetaCacheWeb({ fetchedAt: Date.now(), meta: live });
        fetchedLive = true;
      } else if (cached?.meta) {
        meta = cached.meta;
        usedStaleCache = true;
      }
    } catch {
      if (cached?.meta) {
        meta = cached.meta;
        usedStaleCache = true;
      }
    }
  } else {
    skippedLiveFetch = true;
    meta = cached?.meta ?? null;
  }

  return {
    catalog: buildWebCatalog(meta),
    meta,
    fetchedLive,
    usedStaleCache,
    skippedLiveFetch,
  };
}
