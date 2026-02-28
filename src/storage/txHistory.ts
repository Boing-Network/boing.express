/**
 * Store recent transaction hashes for display and explorer links.
 * Persisted in localStorage; keyed by address+network for multi-wallet support.
 */

const STORAGE_KEY = 'boing-express-tx-history';
const MAX_ENTRIES = 20;

export interface TxHistoryEntry {
  txHash: string;
  type: 'send' | 'bond' | 'unbond';
  networkId: string;
  addressHint: string; // first 8 + last 8 of address
  timestamp: number;
}

function getStorageKey(addressHint: string, networkId: string): string {
  return `${STORAGE_KEY}:${addressHint}:${networkId}`;
}

export function addTxHistory(
  addressHint: string,
  networkId: string,
  txHash: string,
  type: TxHistoryEntry['type']
): void {
  try {
    const key = getStorageKey(addressHint, networkId);
    const raw = localStorage.getItem(key);
    const entries: TxHistoryEntry[] = raw ? JSON.parse(raw) : [];
    entries.unshift({
      txHash,
      type,
      networkId,
      addressHint,
      timestamp: Date.now(),
    });
    const trimmed = entries.slice(0, MAX_ENTRIES);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}

export function getTxHistory(addressHint: string, networkId: string): TxHistoryEntry[] {
  try {
    const key = getStorageKey(addressHint, networkId);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
