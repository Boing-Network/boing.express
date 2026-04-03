/**
 * Persist Boing /api/networks meta in localStorage (web app) for fast startup and offline fallback.
 */

import type { BoingMetaCacheEntry } from '../networks/boingMeta';
import { isBoingMetaCacheStale } from '../networks/boingMeta';

export const BOING_META_LOCAL_STORAGE_KEY = 'boing-express-network-meta-v1';

export function loadBoingMetaCacheWeb(): BoingMetaCacheEntry | null {
  try {
    const raw = localStorage.getItem(BOING_META_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.fetchedAt !== 'number' || !o.meta || typeof o.meta !== 'object') return null;
    return { fetchedAt: o.fetchedAt, meta: o.meta as BoingMetaCacheEntry['meta'] };
  } catch {
    return null;
  }
}

export function saveBoingMetaCacheWeb(entry: BoingMetaCacheEntry): void {
  try {
    localStorage.setItem(BOING_META_LOCAL_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore quota / private mode
  }
}

export function shouldRefreshBoingMetaWeb(cached: BoingMetaCacheEntry | null): boolean {
  return cached == null || isBoingMetaCacheStale(cached);
}
