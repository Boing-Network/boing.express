import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { loadTokenHoldings, type TokenHolding, type TokenHoldingsLoadMeta } from '../boing/tokenHoldings';
import { listTokenWatchlist } from '../storage/tokenWatchlist';
import { mergeWithDefaultTokens } from '../boing/defaultTokens';
import type { NetworkAdapter } from '../networks/types';

/** Fungible holdings (watchlist + DEX directory pages + recent/env/deploy candidates) for the active account. */
export function useTokenHoldings(accountId: AccountId | null, network: NetworkAdapter) {
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [meta, setMeta] = useState<TokenHoldingsLoadMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(
    async (opts?: { bypassCache?: boolean }) => {
      if (!accountId) return;
      setLoading(true);
      setError('');
      try {
        const ownerHex = accountIdToHex(accountId);
        const watch = mergeWithDefaultTokens(await listTokenWatchlist(ownerHex, network.config.id), network.config.chainId);
        const result = await loadTokenHoldings({
          rpcUrl: network.config.rpcUrl,
          ownerHex,
          watchlist: watch,
          networkId: network.config.id,
          bypassCache: opts?.bypassCache,
        });
        setHoldings(result.holdings);
        setMeta(result.meta);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [accountId, network.config.id, network.config.rpcUrl, network.config.chainId]
  );
  useEffect(() => {
    setHoldings([]);
    setMeta(null);
    void refresh();
  }, [refresh]);
  return {
    holdings,
    meta,
    loading,
    error,
    refresh: () => refresh({ bypassCache: true }),
  };
}
