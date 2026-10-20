/**
 * Recently observed non-zero fungible holdings (per owner + network).
 * Re-probed on Wallet refresh so tokens that left the first DEX directory page
 * (or were never in it) still show while the balance stays > 0.
 * Does not sync with boing.finance "my tokens" localStorage.
 */

import { normalizeHex64 } from '../boing/referenceNft';

const STORAGE_KEY = 'boing-express-token-recent-holdings';
const MAX_ENTRIES = 40;

export interface TokenRecentHolding {
  tokenHex: string;
  symbol?: string;
  decimals?: number;
  lastSeenAt: number;
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

function parse(raw: string | null): TokenRecentHolding[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: TokenRecentHolding[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      try {
        const tokenHex = normalizeHex64(String(o.tokenHex ?? ''));
        const decimals =
          typeof o.decimals === 'number' && o.decimals >= 0 && o.decimals <= 38 ? Math.floor(o.decimals) : undefined;
        const symbol = typeof o.symbol === 'string' && o.symbol.trim() ? o.symbol.trim().slice(0, 16) : undefined;
        out.push({
          tokenHex,
          symbol,
          decimals,
          lastSeenAt: typeof o.lastSeenAt === 'number' ? o.lastSeenAt : Date.now(),
        });
      } catch {
        // skip bad row
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function listTokenRecentHoldings(ownerHex: string, networkId: string): Promise<TokenRecentHolding[]> {
  return parse(await storageGet(key(ownerHex, networkId)));
}

/** Upsert non-zero holdings; drop ids that fell to zero (or were never held). Cap at MAX_ENTRIES. */
export async function rememberTokenRecentHoldings(
  ownerHex: string,
  networkId: string,
  held: Array<{ tokenHex: string; symbol?: string; decimals?: number }>,
  droppedHexes: string[] = []
): Promise<TokenRecentHolding[]> {
  const k = key(ownerHex, networkId);
  const drop = new Set(droppedHexes.map((h) => normalizeHex64(h)));
  const byId = new Map<string, TokenRecentHolding>();
  for (const e of parse(await storageGet(k))) {
    if (!drop.has(e.tokenHex)) byId.set(e.tokenHex, e);
  }
  const now = Date.now();
  for (const h of held) {
    const tokenHex = normalizeHex64(h.tokenHex);
    const prev = byId.get(tokenHex);
    byId.set(tokenHex, {
      tokenHex,
      symbol: h.symbol?.trim() || prev?.symbol,
      decimals: h.decimals ?? prev?.decimals,
      lastSeenAt: now,
    });
  }
  const next = [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_ENTRIES);
  await storageSet(k, JSON.stringify(next));
  return next;
}
