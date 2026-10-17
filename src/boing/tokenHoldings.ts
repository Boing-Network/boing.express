/**
 * Fungible token holdings for the Wallet tab.
 * Discovery: the user's token watchlist plus the first page of the node's DEX token directory
 * (`boing_listDexTokens`). Each candidate's balance is read from contract storage; zero balances from the
 * directory are hidden, watched tokens are always shown. There is no on-chain "tokens held by X" index.
 *
 * The directory page is read `light` (cheap), so its symbol / name are hex placeholders. For tokens actually
 * shown, the real deploy name / symbol / decimals come from a full `boing_getDexToken`. Decimals the node
 * cannot tell come back `null`; those are shown as whole units (Boing reference tokens have 0 decimals),
 * never divided by a guessed 18.
 */

import * as rpc from './rpc';
import { formatBalance } from './amount';
import { fetchReferenceFungibleBalance } from './referenceFungible';
import { normalizeHex64, shortHexLabel } from './referenceNft';
import { contractTokenName, contractTokenSymbol } from './defaultTokens';
import type { TokenWatchEntry } from '../storage/tokenWatchlist';

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

interface DexTokenRow {
  id: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** `deploy` = real deploy metadata; `abbrev` (always on light rows) = hex placeholder labels. */
  metadataSource?: string;
}

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
        typeof o.decimals === 'number' && Number.isInteger(o.decimals) && o.decimals >= 0 && o.decimals <= 38 ? o.decimals : undefined,
      metadataSource: typeof o.metadataSource === 'string' ? o.metadataSource : undefined,
    };
  } catch {
    return null;
  }
}

function parseDexTokenRows(raw: unknown): DexTokenRow[] {
  const list = raw && typeof raw === 'object' ? (raw as { tokens?: unknown }).tokens : null;
  if (!Array.isArray(list)) return [];
  return list.map(parseDexTokenRow).filter((r): r is DexTokenRow => r != null);
}

/** Full (non-light) directory row for one token; null when unavailable. */
async function fetchFullDexToken(rpcUrl: string, tokenHex: string): Promise<DexTokenRow | null> {
  try {
    return parseDexTokenRow(await rpc.getDexToken(rpcUrl, [{ id: `0x${tokenHex}` }]));
  } catch {
    return null;
  }
}

export async function loadTokenHoldings(options: {
  rpcUrl: string;
  ownerHex: string;
  watchlist: TokenWatchEntry[];
  /** Also probe the DEX token directory (default true). */
  includeDexDirectory?: boolean;
  dexLimit?: number;
}): Promise<TokenHolding[]> {
  const owner = normalizeHex64(options.ownerHex);
  type Meta = { symbol?: string; name?: string; decimals?: number; watched: boolean; placeholder?: boolean; watchSymbol?: boolean; watchDecimals?: boolean };
  const meta = new Map<string, Meta>();
  for (const w of options.watchlist) {
    meta.set(w.tokenHex, { symbol: w.symbol, decimals: w.decimals, watched: true, watchSymbol: !!w.symbol?.trim(), watchDecimals: w.decimals != null });
  }
  if (options.includeDexDirectory !== false) {
    try {
      const rows = parseDexTokenRows(await rpc.listDexTokens(options.rpcUrl, [{ limit: options.dexLimit ?? 50, light: true }]));
      for (const r of rows) {
        const prev = meta.get(r.id);
        const placeholder = r.metadataSource === 'abbrev';
        meta.set(r.id, {
          symbol: prev?.symbol ?? (placeholder ? undefined : r.symbol),
          name: placeholder ? undefined : r.name,
          decimals: prev?.decimals ?? r.decimals,
          watched: prev?.watched ?? false,
          placeholder,
          watchSymbol: prev?.watchSymbol,
          watchDecimals: prev?.watchDecimals,
        });
      }
    } catch {
      // directory is optional (node may not index DEX tokens)
    }
  }
  const entries = [...meta.entries()];
  const results = await Promise.all(
    entries.map(async ([tokenHex, m]): Promise<TokenHolding | null> => {
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
      return { tokenHex, symbol, name, decimals, balanceRaw: bal.toString(), balanceDisplay: formatBalance(bal.toString(), decimals), watched: m.watched };
    })
  );
  return results.filter((x): x is TokenHolding => x != null).sort((a, b) => Number(b.watched) - Number(a.watched) || a.symbol.localeCompare(b.symbol));
}
