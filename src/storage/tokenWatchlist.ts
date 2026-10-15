/**
 * Local watchlist of reference fungible token contracts the user added (per owner + network).
 * Web: localStorage. Extension popup: chrome.storage.local when available (same as the NFT watchlist).
 */

import { normalizeHex64 } from '../boing/referenceNft';

const STORAGE_KEY = 'boing-express-token-watchlist';
const MAX_ENTRIES = 50;

export interface TokenWatchEntry {
  /** Token contract AccountId, 64 hex, no 0x. */
  tokenHex: string;
  symbol?: string;
  decimals?: number;
  addedAt: number;
}

type ChromeStorageLocal = {
  get: (keys: string | string[], cb: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, cb?: () => void) => void;
};

function chromeStorageLocal(): ChromeStorageLocal | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: ChromeStorageLocal } } };
    return g.chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

function key(ownerHex: string, networkId: string): string {
  return `${STORAGE_KEY}:${ownerHex.replace(/^0x/i, '').toLowerCase()}:${networkId}`;
}

function storageGet(k: string): Promise<string | null> {
  const cs = chromeStorageLocal();
  if (cs) return new Promise((resolve) => cs.get(k, (bag) => resolve(typeof bag?.[k] === 'string' ? (bag[k] as string) : null)));
  try {
    return Promise.resolve(localStorage.getItem(k));
  } catch {
    return Promise.resolve(null);
  }
}

function storageSet(k: string, v: string): Promise<void> {
  const cs = chromeStorageLocal();
  if (cs) return new Promise((resolve) => cs.set({ [k]: v }, () => resolve()));
  try {
    localStorage.setItem(k, v);
  } catch {
    // ignore quota / private mode
  }
  return Promise.resolve();
}

function parse(raw: string | null): TokenWatchEntry[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: TokenWatchEntry[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      try {
        const tokenHex = normalizeHex64(String(o.tokenHex ?? ''));
        const decimals = typeof o.decimals === 'number' && o.decimals >= 0 && o.decimals <= 38 ? Math.floor(o.decimals) : undefined;
        const symbol = typeof o.symbol === 'string' && o.symbol.trim() ? o.symbol.trim().slice(0, 16) : undefined;
        out.push({ tokenHex, symbol, decimals, addedAt: typeof o.addedAt === 'number' ? o.addedAt : Date.now() });
      } catch {
        // skip bad row
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function listTokenWatchlist(ownerHex: string, networkId: string): Promise<TokenWatchEntry[]> {
  return parse(await storageGet(key(ownerHex, networkId)));
}

export async function addTokenWatchEntry(
  ownerHex: string,
  networkId: string,
  entry: { tokenHex: string; symbol?: string; decimals?: number }
): Promise<TokenWatchEntry[]> {
  const k = key(ownerHex, networkId);
  const tokenHex = normalizeHex64(entry.tokenHex);
  const existing = parse(await storageGet(k)).filter((e) => e.tokenHex !== tokenHex);
  existing.unshift({ tokenHex, symbol: entry.symbol?.trim() || undefined, decimals: entry.decimals, addedAt: Date.now() });
  const next = existing.slice(0, MAX_ENTRIES);
  await storageSet(k, JSON.stringify(next));
  return next;
}

export async function removeTokenWatchEntry(ownerHex: string, networkId: string, tokenHex: string): Promise<TokenWatchEntry[]> {
  const k = key(ownerHex, networkId);
  const t = normalizeHex64(tokenHex);
  const next = parse(await storageGet(k)).filter((e) => e.tokenHex !== t);
  await storageSet(k, JSON.stringify(next));
  return next;
}
