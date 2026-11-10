/**
 * Local watchlist of reference multi-token items (contract + item id) per account and network,
 * plus the recent-block scan cursor. Web: localStorage; extension: chrome.storage.local.
 */

import { mtHex32 } from '../boing/referenceMultiToken';

const STORAGE_KEY = 'boing-express-mt-watchlist';
const CURSOR_KEY = 'boing-express-mt-scan-cursor';
const MAX_ENTRIES = 200;

export interface MultiTokenWatchEntry {
  /** Multi-token contract AccountId — 64 hex, no 0x. */
  contractHex: string;
  /** u64 item id as a decimal string. */
  itemId: string;
  addedAt: number;
  label?: string;
}

type ChromeStorageLocal = {
  get: (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => void | Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>;
};

function chromeStorageLocal(): ChromeStorageLocal | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: ChromeStorageLocal } } };
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
  if (cs) return new Promise((resolve) => cs.set({ [key]: value }, () => resolve()));
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota / private mode
  }
  return Promise.resolve();
}

const ownerKey = (base: string, ownerHex: string, networkId: string) =>
  `${base}:${ownerHex.replace(/^0x/i, '').toLowerCase()}:${networkId}`;

function normItemId(raw: unknown): string | null {
  try {
    const n = BigInt(String(raw));
    return n >= 0n && n < 1n << 64n ? n.toString() : null;
  } catch {
    return null;
  }
}

function parseEntries(raw: string | null): MultiTokenWatchEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MultiTokenWatchEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      try {
        const contractHex = mtHex32(String(o.contractHex ?? ''));
        const itemId = normItemId(o.itemId);
        if (itemId == null) continue;
        const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined;
        out.push({ contractHex, itemId, addedAt: typeof o.addedAt === 'number' ? o.addedAt : Date.now(), label });
      } catch {
        // skip bad row
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function listMultiTokenWatchlist(ownerHex: string, networkId: string): Promise<MultiTokenWatchEntry[]> {
  return parseEntries(await storageGet(ownerKey(STORAGE_KEY, ownerHex, networkId)));
}

export async function addMultiTokenWatchEntries(
  ownerHex: string,
  networkId: string,
  entries: Array<{ contractHex: string; itemId: string | bigint | number; label?: string }>
): Promise<{ list: MultiTokenWatchEntry[]; added: number }> {
  const key = ownerKey(STORAGE_KEY, ownerHex, networkId);
  const existing = parseEntries(await storageGet(key));
  const seen = new Set(existing.map((e) => `${e.contractHex}:${e.itemId}`));
  let added = 0;
  for (const e of entries) {
    let contractHex: string;
    try {
      contractHex = mtHex32(e.contractHex);
    } catch {
      continue;
    }
    const itemId = normItemId(e.itemId);
    if (itemId == null) continue;
    const id = `${contractHex}:${itemId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    existing.unshift({ contractHex, itemId, addedAt: Date.now(), label: e.label?.trim() || undefined });
    added++;
  }
  const list = existing.slice(0, MAX_ENTRIES);
  if (added > 0) await storageSet(key, JSON.stringify(list));
  return { list, added };
}

export async function removeMultiTokenWatchEntry(
  ownerHex: string,
  networkId: string,
  contractHex: string,
  itemId: string
): Promise<MultiTokenWatchEntry[]> {
  const key = ownerKey(STORAGE_KEY, ownerHex, networkId);
  const c = mtHex32(contractHex);
  const next = parseEntries(await storageGet(key)).filter((e) => !(e.contractHex === c && e.itemId === itemId));
  await storageSet(key, JSON.stringify(next));
  return next;
}

export async function getMultiTokenScanCursor(ownerHex: string, networkId: string): Promise<number | null> {
  const raw = await storageGet(ownerKey(CURSOR_KEY, ownerHex, networkId));
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function setMultiTokenScanCursor(ownerHex: string, networkId: string, height: number): Promise<void> {
  await storageSet(ownerKey(CURSOR_KEY, ownerHex, networkId), String(Math.max(0, Math.floor(height))));
}
