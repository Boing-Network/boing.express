/**
 * Local watchlist of reference NFT items (collection + opaque token id word).
 * Web: localStorage. Extension service worker / popup: chrome.storage.local when available.
 */

import { normalizeHex64 } from '../boing/referenceNft';

const STORAGE_KEY = 'boing-express-nft-watchlist';
const MAX_ENTRIES = 100;

export interface NftWatchEntry {
  /** Collection contract AccountId — 64 hex, no 0x. */
  collectionHex: string;
  /** Token id word — 64 hex, no 0x (opaque; FreshMint uses hash words). */
  tokenIdHex: string;
  addedAt: number;
  /** Optional short label (e.g. from metadata name). */
  label?: string;
}

function storageKey(ownerHex: string, networkId: string): string {
  return `${STORAGE_KEY}:${ownerHex.toLowerCase()}:${networkId}`;
}

type ChromeStorageLocal = {
  get: (
    keys: string | string[],
    callback?: (items: Record<string, unknown>) => void
  ) => void | Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>;
};

function chromeStorageLocal(): ChromeStorageLocal | null {
  try {
    const g = globalThis as unknown as {
      chrome?: { storage?: { local?: ChromeStorageLocal } };
    };
    return g.chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

function storageGet(key: string): Promise<string | null> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.get(key, (bag) => {
        const v = bag?.[key];
        resolve(typeof v === 'string' ? v : null);
      });
    });
  }
  try {
    return Promise.resolve(localStorage.getItem(key));
  } catch {
    return Promise.resolve(null);
  }
}

function storageSet(key: string, value: string): Promise<void> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.set({ [key]: value }, () => resolve());
    });
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore quota / private mode
  }
  return Promise.resolve();
}

function parseEntries(raw: string | null): NftWatchEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: NftWatchEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      try {
        const collectionHex = normalizeHex64(String(o.collectionHex ?? ''));
        const tokenIdHex = normalizeHex64(String(o.tokenIdHex ?? ''));
        const addedAt = typeof o.addedAt === 'number' ? o.addedAt : Date.now();
        const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined;
        out.push({ collectionHex, tokenIdHex, addedAt, label });
      } catch {
        // skip bad row
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function listNftWatchlist(
  ownerHex: string,
  networkId: string
): Promise<NftWatchEntry[]> {
  const raw = await storageGet(storageKey(ownerHex.replace(/^0x/i, ''), networkId));
  return parseEntries(raw);
}

export async function addNftWatchEntries(
  ownerHex: string,
  networkId: string,
  entries: Array<{ collectionHex: string; tokenIdHex: string; label?: string }>
): Promise<NftWatchEntry[]> {
  const owner = ownerHex.replace(/^0x/i, '').toLowerCase();
  const key = storageKey(owner, networkId);
  const existing = parseEntries(await storageGet(key));
  const seen = new Set(existing.map((e) => `${e.collectionHex}:${e.tokenIdHex}`));
  const now = Date.now();
  for (const e of entries) {
    let collectionHex: string;
    let tokenIdHex: string;
    try {
      collectionHex = normalizeHex64(e.collectionHex);
      tokenIdHex = normalizeHex64(e.tokenIdHex);
    } catch {
      continue;
    }
    const id = `${collectionHex}:${tokenIdHex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    existing.unshift({
      collectionHex,
      tokenIdHex,
      addedAt: now,
      label: e.label?.trim() || undefined,
    });
  }
  const trimmed = existing.slice(0, MAX_ENTRIES);
  await storageSet(key, JSON.stringify(trimmed));
  return trimmed;
}

export async function removeNftWatchEntry(
  ownerHex: string,
  networkId: string,
  collectionHex: string,
  tokenIdHex: string
): Promise<NftWatchEntry[]> {
  const owner = ownerHex.replace(/^0x/i, '').toLowerCase();
  const key = storageKey(owner, networkId);
  const c = normalizeHex64(collectionHex);
  const t = normalizeHex64(tokenIdHex);
  const next = parseEntries(await storageGet(key)).filter(
    (e) => !(e.collectionHex === c && e.tokenIdHex === t)
  );
  await storageSet(key, JSON.stringify(next));
  return next;
}
