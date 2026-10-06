/**
 * Durable NFT-by-owner index — consumes the observer proxy
 * (`GET /api/account/nfts`) to boing.network `workers/nft-owner-indexer`, so the
 * wallet can show holdings older than the bounded RPC scan window
 * (`nftDiscovery.ts`). Falls back gracefully — the caller should still run the
 * scan window when this reports `available: false` or an empty item list,
 * since the indexer can be unconfigured, not yet deployed, or still catching up.
 *
 * Docs: boing.network docs/HANDOFF_NFT_OWNER_INDEX.md.
 */

import { normalizeHex64 } from './referenceNft';

export interface OwnerIndexItem {
  collectionHex: string;
  tokenIdHex: string;
  ownerHex: string;
  metadataHashHex: string | null;
  lastBlockHeight: number;
  lastTxId: string | null;
  lastEventKind: string | null;
}

export interface OwnerIndexMeta {
  lastCommittedHeight: number;
  lastCommittedBlockHash: string;
  chainId: string;
}

export interface OwnerIndexResult {
  /**
   * True when the observer proxy responded with ownership rows (even zero —
   * the indexer may simply not have backfilled anything for this owner yet).
   * False means not configured, unreachable, or an upstream error.
   */
  available: boolean;
  items: OwnerIndexItem[];
  indexer: OwnerIndexMeta | null;
  /** Human-readable reason when `available` is false. */
  reason?: string;
  pagesFetched: number;
  truncated: boolean;
}

const DEFAULT_PAGE_LIMIT = 200;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeMaybeHex64(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return normalizeHex64(raw);
  } catch {
    return null;
  }
}

function normalizeItem(raw: unknown): OwnerIndexItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const collectionHex = normalizeMaybeHex64(o.collection);
  const tokenIdHex = normalizeMaybeHex64(o.tokenId);
  if (!collectionHex || !tokenIdHex) return null;
  const ownerHex = normalizeMaybeHex64(o.owner) ?? '';
  const metadataHashHex = normalizeMaybeHex64(o.metadataHash);
  const heightRaw = o.lastBlockHeight;
  const lastBlockHeight =
    typeof heightRaw === 'number' && Number.isFinite(heightRaw)
      ? heightRaw
      : Number.isFinite(Number(heightRaw))
        ? Number(heightRaw)
        : -1;
  const lastTxId = typeof o.lastTxId === 'string' && o.lastTxId ? o.lastTxId : null;
  const lastEventKind = typeof o.lastEventKind === 'string' && o.lastEventKind ? o.lastEventKind : null;
  return { collectionHex, tokenIdHex, ownerHex, metadataHashHex, lastBlockHeight, lastTxId, lastEventKind };
}

function parseIndexerMeta(raw: unknown): OwnerIndexMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const lastCommittedHeight =
    typeof o.lastCommittedHeight === 'number' ? o.lastCommittedHeight : -1;
  const lastCommittedBlockHash =
    typeof o.lastCommittedBlockHash === 'string' ? o.lastCommittedBlockHash : '';
  const chainId = typeof o.chainId === 'string' ? o.chainId : '';
  return { lastCommittedHeight, lastCommittedBlockHash, chainId };
}

/**
 * Fetch every page of `GET {observerBaseUrl}/api/account/nfts` for `ownerHex`
 * (bounded by `maxPages`). Never throws — reports failures via `available: false`.
 */
export async function fetchOwnerIndexHoldings(
  observerBaseUrl: string,
  ownerHex: string,
  networkIsTestnet: boolean,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxPages?: number;
    pageLimit?: number;
  }
): Promise<OwnerIndexResult> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const base = observerBaseUrl.replace(/\/$/, '');
  if (!fetchImpl || !/^https?:\/\//i.test(base)) {
    return {
      available: false,
      items: [],
      indexer: null,
      reason: 'Observer base URL not configured',
      pagesFetched: 0,
      truncated: false,
    };
  }

  let owner: string;
  try {
    owner = normalizeHex64(ownerHex);
  } catch (e) {
    return {
      available: false,
      items: [],
      indexer: null,
      reason: e instanceof Error ? e.message : String(e),
      pagesFetched: 0,
      truncated: false,
    };
  }

  const network = networkIsTestnet ? 'testnet' : 'mainnet';
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = Math.max(1, options?.maxPages ?? DEFAULT_MAX_PAGES);
  const pageLimit = Math.max(1, Math.min(200, options?.pageLimit ?? DEFAULT_PAGE_LIMIT));

  const items: OwnerIndexItem[] = [];
  let indexer: OwnerIndexMeta | null = null;
  let cursor: string | null = null;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ network, id: `0x${owner}`, limit: String(pageLimit) });
    if (cursor) qs.set('cursor', cursor);

    let res: Response;
    try {
      res = await fetchImpl(`${base}/api/account/nfts?${qs.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return {
        available: false,
        items,
        indexer,
        reason: e instanceof Error ? e.message : String(e),
        pagesFetched,
        truncated,
      };
    }
    pagesFetched++;

    if (res.status === 503) {
      // Observer proxy is deployed but NFT_OWNER_INDEXER_URL is unset (indexer not live yet).
      return {
        available: false,
        items: [],
        indexer: null,
        reason: 'NFT owner indexer is not configured yet',
        pagesFetched,
        truncated: false,
      };
    }

    if (!res.ok) {
      let reason = `Owner index HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) reason = body.error.trim();
      } catch {
        /* ignore non-JSON error body */
      }
      return { available: false, items, indexer, reason, pagesFetched, truncated };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        available: false,
        items,
        indexer,
        reason: 'Invalid response from owner index',
        pagesFetched,
        truncated,
      };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(b.items) ? b.items : [];
    for (const r of rawItems) {
      const it = normalizeItem(r);
      if (it) items.push(it);
    }
    const meta = parseIndexerMeta(b.indexer);
    if (meta) indexer = meta;

    const next = typeof b.nextCursor === 'string' && b.nextCursor ? b.nextCursor : null;
    if (!next || rawItems.length === 0) break;
    if (page === maxPages - 1) {
      truncated = true;
      break;
    }
    cursor = next;
  }

  return { available: true, items, indexer, pagesFetched, truncated };
}

/** Build a short, honest status line for the UI. */
export function formatOwnerIndexNote(result: OwnerIndexResult, tipHeight?: number): string {
  if (!result.available) {
    return `Durable index: ${result.reason ?? 'unavailable'} — showing scan-window results only.`;
  }
  if (result.items.length === 0) {
    return 'Durable index: live, no backfilled holdings yet for this account — showing scan-window results.';
  }
  const parts = [`Durable index: ${result.items.length} item(s)`];
  if (result.indexer && result.indexer.lastCommittedHeight >= 0) {
    parts.push(`indexed to height ${result.indexer.lastCommittedHeight}`);
    if (tipHeight != null && tipHeight > result.indexer.lastCommittedHeight) {
      parts.push(`lag ${tipHeight - result.indexer.lastCommittedHeight} block(s)`);
    }
  }
  if (result.truncated) parts.push('hit page cap');
  return parts.join(' · ');
}
