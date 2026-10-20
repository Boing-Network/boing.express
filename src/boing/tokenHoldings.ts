/**
 * Fungible token holdings for the Wallet tab.
 *
 * Candidate universe (bounded, no planet-scale ownership index):
 * 1. Local watchlist (+ curated defaults / env candidates)
 * 2. Recent non-zero holdings remembered in this browser
 * 3. Paginated L1 `boing_listDexTokens` (light)
 * 4. Token legs from paginated `boing_listDexPools` (light)
 * 5. Optional recent fungible-style deploy scan (bounded blocks)
 *
 * Each candidate's balance is read from contract storage with a concurrency limit.
 * Zero balances from discovery sources are hidden; watchlist entries are always shown.
 * Brief in-memory cache avoids repeat RPC storms on tab re-entry.
 */

import * as rpc from './rpc';
import { formatBalance } from './amount';
import { fetchReferenceFungibleBalance } from './referenceFungible';
import { normalizeHex64, shortHexLabel } from './referenceNft';
import { contractTokenName, contractTokenSymbol } from './defaultTokens';
import type { TokenWatchEntry } from '../storage/tokenWatchlist';
import {
  listTokenRecentHoldings,
  rememberTokenRecentHoldings,
  type TokenRecentHolding,
} from '../storage/tokenRecentHoldings';
import { collectFungibleDeployCandidates } from './fungibleDeployCandidates';

/** Page size for `boing_listDexTokens` / `boing_listDexPools`. */
export const DEX_DISCOVERY_PAGE_LIMIT = 50;
/** Max token directory pages per refresh (50 × 8 = 400 ids). */
export const DEX_TOKEN_MAX_PAGES = 8;
/** Max pool directory pages used for leg candidates. */
export const DEX_POOL_MAX_PAGES = 4;
/** Parallel balance / getDexToken probes. */
export const BALANCE_PROBE_CONCURRENCY = 8;
/** In-memory holdings cache TTL. */
export const HOLDINGS_CACHE_TTL_MS = 20_000;

export interface TokenHolding {
  tokenHex: string;
  symbol: string;
  name?: string;
  decimals: number;
  /** Raw balance (smallest units) as a decimal string, or null if the read failed. */
  balanceRaw: string | null;
  balanceDisplay: string;
  watched: boolean;
  error?: string;
}

export interface TokenHoldingsLoadMeta {
  candidateCount: number;
  dexTokenPages: number;
  dexTokenRows: number;
  poolLegCount: number;
  deployCandidateCount: number;
  recentHistoryCount: number;
  envCandidateCount: number;
  probed: number;
  heldNonZero: number;
  fromCache: boolean;
  truncatedDirectory: boolean;
}

interface DexTokenRow {
  id: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** `deploy` = real deploy metadata; `abbrev` (always on light rows) = hex placeholder labels. */
  metadataSource?: string;
}

type Meta = {
  symbol?: string;
  name?: string;
  decimals?: number;
  watched: boolean;
  placeholder?: boolean;
  watchSymbol?: boolean;
  watchDecimals?: boolean;
  source: 'watch' | 'recent' | 'env' | 'dex' | 'pool' | 'deploy';
};

/** One `boing_listDexTokens` / `boing_getDexToken` row; `decimals: null` (unknown) maps to undefined. */
export function parseDexTokenRow(t: unknown): DexTokenRow | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  try {
    return {
      id: normalizeHex64(String(o.id ?? '')),
      symbol: typeof o.symbol === 'string' ? o.symbol : undefined,
      name: typeof o.name === 'string' ? o.name : undefined,
      decimals:
        typeof o.decimals === 'number' && Number.isInteger(o.decimals) && o.decimals >= 0 && o.decimals <= 38
          ? o.decimals
          : undefined,
      metadataSource: typeof o.metadataSource === 'string' ? o.metadataSource : undefined,
    };
  } catch {
    return null;
  }
}

function parseDexTokenPage(raw: unknown): { rows: DexTokenRow[]; nextCursor: string | null } {
  if (!raw || typeof raw !== 'object') return { rows: [], nextCursor: null };
  const o = raw as { tokens?: unknown; nextCursor?: unknown };
  const list = Array.isArray(o.tokens) ? o.tokens : [];
  const rows = list.map(parseDexTokenRow).filter((r): r is DexTokenRow => r != null);
  const next = typeof o.nextCursor === 'string' && o.nextCursor.trim() ? o.nextCursor.trim() : null;
  return { rows, nextCursor: next };
}

function parsePoolLegIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const pools = (raw as { pools?: unknown }).pools;
  if (!Array.isArray(pools)) return [];
  const out: string[] = [];
  for (const p of pools) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    for (const key of ['tokenAHex', 'tokenBHex', 'token_a', 'token_b'] as const) {
      const v = o[key];
      if (typeof v !== 'string') continue;
      try {
        out.push(normalizeHex64(v));
      } catch {
        // skip
      }
    }
  }
  return out;
}

/** Operator / build-time extra candidates: `VITE_BOING_TOKEN_CANDIDATES_JSON` = JSON array of `{id,symbol?,name?,decimals?}`. */
export function parseEnvTokenCandidates(): Array<{ tokenHex: string; symbol?: string; name?: string; decimals?: number }> {
  let raw = '';
  try {
    raw = ((import.meta as ImportMeta).env?.VITE_BOING_TOKEN_CANDIDATES_JSON ?? '').trim();
  } catch {
    raw = '';
  }
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: Array<{ tokenHex: string; symbol?: string; name?: string; decimals?: number }> = [];
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      try {
        const tokenHex = normalizeHex64(String(o.id ?? o.address ?? o.tokenHex ?? ''));
        const decimals =
          typeof o.decimals === 'number' && Number.isInteger(o.decimals) && o.decimals >= 0 && o.decimals <= 38
            ? o.decimals
            : undefined;
        const symbol = typeof o.symbol === 'string' && o.symbol.trim() ? o.symbol.trim().slice(0, 16) : undefined;
        const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : undefined;
        out.push({ tokenHex, symbol, name, decimals });
      } catch {
        // skip
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

/** Full (non-light) directory row for one token; null when unavailable. */
async function fetchFullDexToken(rpcUrl: string, tokenHex: string): Promise<DexTokenRow | null> {
  try {
    return parseDexTokenRow(await rpc.getDexToken(rpcUrl, [{ id: `0x${tokenHex}` }]));
  } catch {
    return null;
  }
}

async function collectDexTokenDirectory(
  rpcUrl: string,
  opts: { pageLimit: number; maxPages: number }
): Promise<{ rows: DexTokenRow[]; pages: number; truncated: boolean }> {
  const rows: DexTokenRow[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;
  for (let page = 0; page < opts.maxPages; page++) {
    let raw: unknown;
    try {
      raw = await rpc.listDexTokens(rpcUrl, [
        { limit: opts.pageLimit, light: true, ...(cursor ? { cursor } : {}) },
      ]);
    } catch {
      break;
    }
    pages += 1;
    const parsed = parseDexTokenPage(raw);
    for (const r of parsed.rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
    if (!parsed.nextCursor || parsed.rows.length === 0) {
      truncated = false;
      break;
    }
    cursor = parsed.nextCursor;
    if (page === opts.maxPages - 1) truncated = true;
  }
  return { rows, pages, truncated };
}

async function collectPoolLegCandidates(
  rpcUrl: string,
  opts: { pageLimit: number; maxPages: number }
): Promise<string[]> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < opts.maxPages; page++) {
    let raw: unknown;
    try {
      raw = await rpc.listDexPools(rpcUrl, [
        { limit: opts.pageLimit, light: true, ...(cursor ? { cursor } : {}) },
      ]);
    } catch {
      break;
    }
    const legs = parsePoolLegIds(raw);
    for (const id of legs) seen.add(id);
    const next =
      raw && typeof raw === 'object' && typeof (raw as { nextCursor?: unknown }).nextCursor === 'string'
        ? String((raw as { nextCursor: string }).nextCursor).trim()
        : '';
    if (!next || legs.length === 0) break;
    cursor = next;
  }
  return [...seen];
}

function mergeMeta(
  meta: Map<string, Meta>,
  tokenHex: string,
  patch: Partial<Meta> & { source: Meta['source'] }
): void {
  const prev = meta.get(tokenHex);
  if (!prev) {
    meta.set(tokenHex, {
      symbol: patch.symbol,
      name: patch.name,
      decimals: patch.decimals,
      watched: patch.watched ?? false,
      placeholder: patch.placeholder,
      watchSymbol: patch.watchSymbol,
      watchDecimals: patch.watchDecimals,
      source: patch.source,
    });
    return;
  }
  // Prefer watchlist labels; otherwise fill gaps. Keep watched sticky.
  const watched = prev.watched || !!patch.watched;
  meta.set(tokenHex, {
    symbol: prev.watchSymbol ? prev.symbol : prev.symbol ?? patch.symbol,
    name: prev.name ?? patch.name,
    decimals: prev.watchDecimals ? prev.decimals : prev.decimals ?? patch.decimals,
    watched,
    placeholder: prev.placeholder && patch.placeholder !== false ? prev.placeholder : patch.placeholder,
    watchSymbol: prev.watchSymbol,
    watchDecimals: prev.watchDecimals,
    source: prev.watched ? 'watch' : prev.source === 'recent' ? 'recent' : patch.source,
  });
}

type CacheEntry = { at: number; holdings: TokenHolding[]; meta: TokenHoldingsLoadMeta };
const holdingsCache = new Map<string, CacheEntry>();

function cacheKey(rpcUrl: string, ownerHex: string, networkId: string): string {
  return `${rpcUrl}|${ownerHex}|${networkId}`;
}

/** Test helper: clear the short-lived holdings cache. */
export function clearTokenHoldingsCache(): void {
  holdingsCache.clear();
}

export async function loadTokenHoldings(options: {
  rpcUrl: string;
  ownerHex: string;
  watchlist: TokenWatchEntry[];
  /** Network id for recent-holdings persistence (optional → skip remember/list). */
  networkId?: string;
  /** Also probe the DEX token directory (default true). */
  includeDexDirectory?: boolean;
  /** Also probe pool legs (default true when directory is on). */
  includePoolLegs?: boolean;
  /** Also run bounded deploy scan (default true; honor env kill-switch). */
  includeDeployScan?: boolean;
  dexLimit?: number;
  dexMaxPages?: number;
  poolMaxPages?: number;
  probeConcurrency?: number;
  /** Skip cache read (still writes). */
  bypassCache?: boolean;
  extraCandidates?: Array<{ tokenHex: string; symbol?: string; name?: string; decimals?: number }>;
}): Promise<{ holdings: TokenHolding[]; meta: TokenHoldingsLoadMeta }> {
  const owner = normalizeHex64(options.ownerHex);
  const networkId = options.networkId ?? '';
  const ck = cacheKey(options.rpcUrl, owner, networkId || '_');
  if (!options.bypassCache) {
    const hit = holdingsCache.get(ck);
    if (hit && Date.now() - hit.at < HOLDINGS_CACHE_TTL_MS) {
      return { holdings: hit.holdings, meta: { ...hit.meta, fromCache: true } };
    }
  }

  const meta = new Map<string, Meta>();

  for (const w of options.watchlist) {
    mergeMeta(meta, w.tokenHex, {
      symbol: w.symbol,
      decimals: w.decimals,
      watched: true,
      watchSymbol: !!w.symbol?.trim(),
      watchDecimals: w.decimals != null,
      source: 'watch',
    });
  }

  const envCandidates = parseEnvTokenCandidates();
  for (const e of envCandidates) {
    mergeMeta(meta, e.tokenHex, {
      symbol: e.symbol,
      name: e.name,
      decimals: e.decimals,
      watched: false,
      source: 'env',
    });
  }
  for (const e of options.extraCandidates ?? []) {
    try {
      const tokenHex = normalizeHex64(e.tokenHex);
      mergeMeta(meta, tokenHex, {
        symbol: e.symbol,
        name: e.name,
        decimals: e.decimals,
        watched: false,
        source: 'env',
      });
    } catch {
      // skip
    }
  }

  let recentHistoryCount = 0;
  let recent: TokenRecentHolding[] = [];
  if (networkId) {
    try {
      recent = await listTokenRecentHoldings(owner, networkId);
      recentHistoryCount = recent.length;
      for (const r of recent) {
        mergeMeta(meta, r.tokenHex, {
          symbol: r.symbol,
          decimals: r.decimals,
          watched: false,
          source: 'recent',
        });
      }
    } catch {
      // optional
    }
  }

  let dexTokenPages = 0;
  let dexTokenRows = 0;
  let truncatedDirectory = false;
  let poolLegCount = 0;
  let deployCandidateCount = 0;

  const includeDex = options.includeDexDirectory !== false;
  if (includeDex) {
    const pageLimit = options.dexLimit ?? DEX_DISCOVERY_PAGE_LIMIT;
    const maxPages = options.dexMaxPages ?? DEX_TOKEN_MAX_PAGES;
    const dir = await collectDexTokenDirectory(options.rpcUrl, { pageLimit, maxPages });
    dexTokenPages = dir.pages;
    dexTokenRows = dir.rows.length;
    truncatedDirectory = dir.truncated;
    for (const r of dir.rows) {
      const placeholder = r.metadataSource === 'abbrev';
      mergeMeta(meta, r.id, {
        symbol: placeholder ? undefined : r.symbol,
        name: placeholder ? undefined : r.name,
        decimals: r.decimals,
        watched: false,
        placeholder,
        source: 'dex',
      });
    }

    if (options.includePoolLegs !== false) {
      const legs = await collectPoolLegCandidates(options.rpcUrl, {
        pageLimit,
        maxPages: options.poolMaxPages ?? DEX_POOL_MAX_PAGES,
      });
      poolLegCount = legs.length;
      for (const id of legs) {
        mergeMeta(meta, id, { watched: false, source: 'pool' });
      }
    }
  }

  if (options.includeDeployScan !== false) {
    try {
      const deploy = await collectFungibleDeployCandidates(options.rpcUrl);
      deployCandidateCount = deploy.candidates.length;
      for (const c of deploy.candidates) {
        mergeMeta(meta, c.tokenHex, {
          symbol: c.symbol,
          name: c.name,
          watched: false,
          source: 'deploy',
        });
      }
    } catch {
      // optional
    }
  }

  const entries = [...meta.entries()];
  const concurrency = options.probeConcurrency ?? BALANCE_PROBE_CONCURRENCY;
  const results = await mapPool(entries, concurrency, async ([tokenHex, m]): Promise<TokenHolding | null> => {
    let bal: bigint | null = null;
    let error: string | undefined;
    try {
      bal = await fetchReferenceFungibleBalance(options.rpcUrl, tokenHex, owner);
    } catch (e) {
      if (!m.watched) return null;
      error = e instanceof Error ? e.message : String(e);
    }
    if (bal === 0n && !m.watched) return null;
    // Shown token without real labels or decimals: ask the node for its deploy metadata.
    if ((!m.watchSymbol && (m.placeholder || !m.symbol)) || (!m.watchDecimals && m.decimals == null)) {
      const full = await fetchFullDexToken(options.rpcUrl, tokenHex);
      if (full) {
        if (!m.watchSymbol && full.metadataSource === 'deploy' && full.symbol?.trim()) m.symbol = full.symbol;
        if (full.metadataSource === 'deploy' && full.name?.trim()) m.name = m.name ?? full.name;
        if (!m.watchDecimals && full.decimals != null) m.decimals = full.decimals;
      }
    }
    const decimals = m.decimals ?? 0;
    const symbol = contractTokenSymbol(m.symbol?.trim() || shortHexLabel(tokenHex));
    const name = contractTokenName(tokenHex) ?? m.name;
    if (bal == null) {
      return { tokenHex, symbol, name, decimals, balanceRaw: null, balanceDisplay: '—', watched: true, error };
    }
    return {
      tokenHex,
      symbol,
      name,
      decimals,
      balanceRaw: bal.toString(),
      balanceDisplay: formatBalance(bal.toString(), decimals),
      watched: m.watched,
    };
  });

  const holdings = results
    .filter((x): x is TokenHolding => x != null)
    .sort((a, b) => Number(b.watched) - Number(a.watched) || a.symbol.localeCompare(b.symbol));

  const heldNonZero = holdings.filter((h) => h.balanceRaw != null && h.balanceRaw !== '0');
  if (networkId) {
    // Drop from recent history when we successfully probed zero (hidden from the list).
    const probedZero = new Set(
      entries
        .filter(([id, m]) => {
          if (m.watched) return false;
          const h = holdings.find((x) => x.tokenHex === id);
          return !h || h.balanceRaw === '0';
        })
        .map(([id]) => id)
    );
    try {
      await rememberTokenRecentHoldings(
        owner,
        networkId,
        heldNonZero.map((h) => ({ tokenHex: h.tokenHex, symbol: h.symbol, decimals: h.decimals })),
        [...probedZero].filter((id) => recent.some((r) => r.tokenHex === id))
      );
    } catch {
      // optional
    }
  }

  const loadMeta: TokenHoldingsLoadMeta = {
    candidateCount: entries.length,
    dexTokenPages,
    dexTokenRows,
    poolLegCount,
    deployCandidateCount,
    recentHistoryCount,
    envCandidateCount: envCandidates.length,
    probed: entries.length,
    heldNonZero: heldNonZero.length,
    fromCache: false,
    truncatedDirectory,
  };

  holdingsCache.set(ck, { at: Date.now(), holdings, meta: loadMeta });
  return { holdings, meta: loadMeta };
}
