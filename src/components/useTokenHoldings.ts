import { useCallback, useEffect, useState } from 'react';
import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { loadTokenHoldings, type TokenHolding } from '../boing/tokenHoldings';
import { listTokenWatchlist } from '../storage/tokenWatchlist';
import type { NetworkAdapter } from '../networks/types';

/** Fungible holdings (watchlist + DEX directory) for the active account/network. */
export function useTokenHoldings(accountId: AccountId | null, network: NetworkAdapter) {
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError('');
    try {
      const ownerHex = accountIdToHex(accountId);
      const watch = await listTokenWatchlist(ownerHex, network.config.id);
      setHoldings(await loadTokenHoldings({ rpcUrl: network.config.rpcUrl, ownerHex, watchlist: watch }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, network.config.id, network.config.rpcUrl]);
  useEffect(() => {
    setHoldings([]);
    void refresh();
  }, [refresh]);
  return { holdings, loading, error, refresh };
}
