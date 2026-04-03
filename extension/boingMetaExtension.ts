/**
 * Cache Boing GET /api/networks meta in chrome.storage.local (shared by background + popup).
 */

import {
  fetchBoingNetworksMeta,
  isBoingMetaCacheStale,
  resolveTestnetRpcWithMeta,
  type BoingMetaCacheEntry,
  type BoingNetworksMeta,
} from '../src/networks/boingMeta';
import { buildNetworksCatalog } from '../src/networks/buildNetworksCatalog';
import type { NetworkAdapter } from '../src/networks/types';
import {
  BOING_MAINNET_RPC,
  BOING_TESTNET_RPC,
  isExtensionTestnetRpcPinnedByEnv,
} from './config';

export const BOING_EXTENSION_META_STORAGE_KEY = 'boing_express_network_meta_v1';

function parseCacheEntry(raw: unknown): BoingMetaCacheEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.fetchedAt !== 'number' || !o.meta || typeof o.meta !== 'object') return null;
  return { fetchedAt: o.fetchedAt, meta: o.meta as BoingNetworksMeta };
}

export function loadExtensionMetaCacheAsync(): Promise<BoingMetaCacheEntry | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([BOING_EXTENSION_META_STORAGE_KEY], (result) => {
      try {
        resolve(parseCacheEntry(result[BOING_EXTENSION_META_STORAGE_KEY]));
      } catch {
        resolve(null);
      }
    });
  });
}

export function saveExtensionMetaCache(entry: BoingMetaCacheEntry): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [BOING_EXTENSION_META_STORAGE_KEY]: entry }, () => resolve());
  });
}

/** Fetch and store when cache missing or stale. Returns latest entry after refresh attempt. */
export async function refreshExtensionBoingMetaIfStale(): Promise<BoingMetaCacheEntry | null> {
  const cur = await loadExtensionMetaCacheAsync();
  if (cur && !isBoingMetaCacheStale(cur)) return cur;
  const meta = await fetchBoingNetworksMeta();
  if (meta) {
    const next: BoingMetaCacheEntry = { fetchedAt: Date.now(), meta };
    await saveExtensionMetaCache(next);
    return next;
  }
  return cur;
}

/** Always fetch (e.g. user-triggered refresh). */
export async function refreshExtensionBoingMetaForce(): Promise<BoingMetaCacheEntry | null> {
  const meta = await fetchBoingNetworksMeta();
  if (meta) {
    const next: BoingMetaCacheEntry = { fetchedAt: Date.now(), meta };
    await saveExtensionMetaCache(next);
    return next;
  }
  return loadExtensionMetaCacheAsync();
}

export function buildExtensionNetworksCatalog(meta: BoingNetworksMeta | null | undefined): NetworkAdapter[] {
  return buildNetworksCatalog({
    envTestnetRpc: BOING_TESTNET_RPC,
    testnetRpcPinnedByEnv: isExtensionTestnetRpcPinnedByEnv(),
    envMainnetRpc: BOING_MAINNET_RPC,
    meta: meta ?? null,
  });
}

export async function getEffectiveExtensionTestnetRpc(): Promise<string> {
  const entry = await loadExtensionMetaCacheAsync();
  return resolveTestnetRpcWithMeta(
    BOING_TESTNET_RPC,
    isExtensionTestnetRpcPinnedByEnv(),
    entry?.meta ?? null
  );
}
