/**
 * Fungible token holdings for the Wallet tab.
 * Discovery: the user's token watchlist plus the first page of the node's DEX token directory
 * (`boing_listDexTokens`). Each candidate's balance is read from contract storage; zero balances from the
 * directory are hidden, watched tokens are always shown. There is no on-chain "tokens held by X" index.
 */

import * as rpc from './rpc';
import { formatBalance } from './amount';
import { fetchReferenceFungibleBalance } from './referenceFungible';
import { normalizeHex64, shortHexLabel } from './referenceNft';
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
}

function parseDexTokenRows(raw: unknown): DexTokenRow[] {
  const list = raw && typeof raw === 'object' ? (raw as { tokens?: unknown }).tokens : null;
  if (!Array.isArray(list)) return [];
  const out: DexTokenRow[] = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    try {
      out.push({
        id: normalizeHex64(String(o.id ?? '')),
        symbol: typeof o.symbol === 'string' ? o.symbol : undefined,
        name: typeof o.name === 'string' ? o.name : undefined,
        decimals: typeof o.decimals === 'number' && o.decimals >= 0 && o.decimals <= 38 ? o.decimals : undefined,
      });
    } catch {
      // skip
    }
  }
  return out;
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
  const meta = new Map<string, { symbol?: string; name?: string; decimals?: number; watched: boolean }>();
  for (const w of options.watchlist) meta.set(w.tokenHex, { symbol: w.symbol, decimals: w.decimals, watched: true });
  if (options.includeDexDirectory !== false) {
    try {
      const rows = parseDexTokenRows(await rpc.listDexTokens(options.rpcUrl, [{ limit: options.dexLimit ?? 50, light: true }]));
      for (const r of rows) {
        const prev = meta.get(r.id);
        meta.set(r.id, {
          symbol: prev?.symbol ?? r.symbol,
          name: r.name,
          decimals: prev?.decimals ?? r.decimals,
          watched: prev?.watched ?? false,
        });
      }
    } catch {
      // directory is optional (node may not index DEX tokens)
    }
  }
  const entries = [...meta.entries()];
  const results = await Promise.all(
    entries.map(async ([tokenHex, m]): Promise<TokenHolding | null> => {
      const decimals = m.decimals ?? 0;
      const symbol = m.symbol?.trim() || shortHexLabel(tokenHex);
      try {
        const bal = await fetchReferenceFungibleBalance(options.rpcUrl, tokenHex, owner);
        if (bal === 0n && !m.watched) return null;
        return { tokenHex, symbol, name: m.name, decimals, balanceRaw: bal.toString(), balanceDisplay: formatBalance(bal.toString(), decimals), watched: m.watched };
      } catch (e) {
        if (!m.watched) return null;
        return { tokenHex, symbol, name: m.name, decimals, balanceRaw: null, balanceDisplay: '—', watched: true, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  return results.filter((x): x is TokenHolding => x != null).sort((a, b) => Number(b.watched) - Number(a.watched) || a.symbol.localeCompare(b.symbol));
}
