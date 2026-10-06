/**
 * Durable bookkeeping for NFT discovery scan gaps.
 *
 * `nftDiscovery.ts` scans a bounded recent-block window per refresh. Heights that
 * fail to fetch after retry (pruned RPC / transient errors) must not be silently
 * dropped once the scan cursor advances past them — they are persisted here so
 * future refreshes keep retrying them, and the UI can surface an honest count
 * instead of pretending the window was fully scanned.
 */

const GAPS_STORAGE_KEY = 'boing-express-nft-scan-gaps';
const PROGRESS_STORAGE_KEY = 'boing-express-nft-scan-last-successful-height';

/** Cap on persisted open gaps per owner+network (pruned heights rarely come back). */
export const NFT_SCAN_GAP_MAX_ENTRIES = 300;

export interface NftScanGapEntry {
  height: number;
  /** First time (ms epoch) this height failed to fetch. */
  firstFailedAt: number;
  /** Total failed fetch attempts across all passes (including the first). */
  attempts: number;
  /** Most recent attempt time (ms epoch) — used to round-robin retries. */
  lastAttemptAt: number;
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

function gapsKey(ownerHex: string, networkId: string): string {
  return `${GAPS_STORAGE_KEY}:${ownerHex.replace(/^0x/i, '').toLowerCase()}:${networkId}`;
}

function progressKey(ownerHex: string, networkId: string): string {
  return `${PROGRESS_STORAGE_KEY}:${ownerHex.replace(/^0x/i, '').toLowerCase()}:${networkId}`;
}

function storageGet(k: string): Promise<string | null> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.get(k, (bag) => {
        const v = bag?.[k];
        resolve(typeof v === 'string' ? v : null);
      });
    });
  }
  try {
    return Promise.resolve(localStorage.getItem(k));
  } catch {
    return Promise.resolve(null);
  }
}

function storageSet(k: string, value: string): Promise<void> {
  const cs = chromeStorageLocal();
  if (cs) {
    return new Promise((resolve) => {
      cs.set({ [k]: value }, () => resolve());
    });
  }
  try {
    localStorage.setItem(k, value);
  } catch {
    // ignore quota / private mode
  }
  return Promise.resolve();
}

function parseGapEntries(raw: string | null): NftScanGapEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: NftScanGapEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const height = Number(o.height);
      if (!Number.isFinite(height) || height < 0) continue;
      const firstFailedAt = Number.isFinite(Number(o.firstFailedAt)) ? Number(o.firstFailedAt) : Date.now();
      const attempts = Number.isFinite(Number(o.attempts)) && Number(o.attempts) > 0 ? Math.floor(Number(o.attempts)) : 1;
      const lastAttemptAt = Number.isFinite(Number(o.lastAttemptAt)) ? Number(o.lastAttemptAt) : firstFailedAt;
      out.push({ height: Math.floor(height), firstFailedAt, attempts, lastAttemptAt });
    }
    return out;
  } catch {
    return [];
  }
}

/** Keep the cap by dropping the most-attempted (likely permanently pruned) entries first. */
function capGapEntries(entries: NftScanGapEntry[]): NftScanGapEntry[] {
  if (entries.length <= NFT_SCAN_GAP_MAX_ENTRIES) return entries;
  const sorted = [...entries].sort((a, b) => {
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    return b.firstFailedAt - a.firstFailedAt;
  });
  return sorted.slice(0, NFT_SCAN_GAP_MAX_ENTRIES);
}

export async function listNftScanGaps(ownerHex: string, networkId: string): Promise<NftScanGapEntry[]> {
  const raw = await storageGet(gapsKey(ownerHex, networkId));
  return parseGapEntries(raw).sort((a, b) => a.height - b.height);
}

/**
 * Record that the given heights failed to fetch this pass (after retry). New heights
 * are added; previously-known heights get `attempts` bumped and `lastAttemptAt` refreshed.
 */
export async function recordNftScanGapFailures(
  ownerHex: string,
  networkId: string,
  heights: number[],
  nowMs: number = Date.now()
): Promise<NftScanGapEntry[]> {
  if (heights.length === 0) return listNftScanGaps(ownerHex, networkId);
  const key = gapsKey(ownerHex, networkId);
  const existing = parseGapEntries(await storageGet(key));
  const byHeight = new Map(existing.map((e) => [e.height, e]));
  for (const h of heights) {
    const height = Math.floor(h);
    if (!Number.isFinite(height) || height < 0) continue;
    const prev = byHeight.get(height);
    if (prev) {
      byHeight.set(height, { ...prev, attempts: prev.attempts + 1, lastAttemptAt: nowMs });
    } else {
      byHeight.set(height, { height, firstFailedAt: nowMs, attempts: 1, lastAttemptAt: nowMs });
    }
  }
  const capped = capGapEntries([...byHeight.values()]);
  await storageSet(key, JSON.stringify(capped));
  return capped.sort((a, b) => a.height - b.height);
}

/** Remove heights that were successfully re-fetched (gap resolved). */
export async function resolveNftScanGapHeights(
  ownerHex: string,
  networkId: string,
  heights: number[]
): Promise<NftScanGapEntry[]> {
  const key = gapsKey(ownerHex, networkId);
  const existing = parseGapEntries(await storageGet(key));
  if (heights.length === 0) return existing.sort((a, b) => a.height - b.height);
  const resolved = new Set(heights.map((h) => Math.floor(h)));
  const next = existing.filter((e) => !resolved.has(e.height));
  await storageSet(key, JSON.stringify(next));
  return next.sort((a, b) => a.height - b.height);
}

/**
 * Pick up to `limit` open-gap heights to retry this pass — least-recently-attempted
 * first, so a large gap list gets round-robin coverage across refreshes instead of
 * always retrying (and failing on) the same few heights.
 */
export async function pickNftScanGapHeightsToRetry(
  ownerHex: string,
  networkId: string,
  limit: number
): Promise<number[]> {
  if (limit <= 0) return [];
  const entries = await listNftScanGaps(ownerHex, networkId);
  return [...entries]
    .sort((a, b) => a.lastAttemptAt - b.lastAttemptAt)
    .slice(0, limit)
    .map((e) => e.height);
}

export async function getNftScanLastSuccessfulHeight(
  ownerHex: string,
  networkId: string
): Promise<number | null> {
  const raw = await storageGet(progressKey(ownerHex, networkId));
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function setNftScanLastSuccessfulHeight(
  ownerHex: string,
  networkId: string,
  height: number
): Promise<void> {
  if (!Number.isFinite(height) || height < 0) return;
  await storageSet(progressKey(ownerHex, networkId), String(Math.floor(height)));
}
