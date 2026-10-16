/**
 * Fungible tokens shown by default (always listed, like watched tokens) per EIP-155-style chain id.
 * Ids come from boing-sdk's canonical public-testnet constants (reference token v2, whole units).
 */
import { CANONICAL_BOING_TESTNET_BOING_TOKEN_HEX, CANONICAL_BOING_TESTNET_USDC_TOKEN_HEX } from 'boing-sdk';
import { BOING_TESTNET_CHAIN_ID_DECIMAL, chainIdHexToDecimal } from '../networks/chainIds';
import { normalizeHex64 } from './referenceNft';
import type { TokenWatchEntry } from '../storage/tokenWatchlist';

const BY_CHAIN: Record<number, Array<Omit<TokenWatchEntry, 'addedAt'>>> = {
  [BOING_TESTNET_CHAIN_ID_DECIMAL]: [
    { tokenHex: normalizeHex64(CANONICAL_BOING_TESTNET_USDC_TOKEN_HEX), symbol: 'USDC', decimals: 0 },
    { tokenHex: normalizeHex64(CANONICAL_BOING_TESTNET_BOING_TOKEN_HEX), symbol: 'BOING', decimals: 0 },
  ],
};

/** Default tokens for a network `chainId` (hex like `0x1b01`, or decimal); empty when none / unknown. */
export function defaultTokensForChainId(chainId: string | number | undefined | null): TokenWatchEntry[] {
  if (chainId == null || chainId === '') return [];
  const dec = typeof chainId === 'number' ? chainId : Number(/^0x/i.test(chainId) ? chainIdHexToDecimal(chainId) : chainId);
  return (BY_CHAIN[dec] ?? []).map((t) => ({ ...t, addedAt: 0 }));
}

/** User watchlist first (its symbol/decimals win), then defaults not already watched. */
export function mergeWithDefaultTokens(watchlist: TokenWatchEntry[], chainId: string | number | undefined | null): TokenWatchEntry[] {
  const seen = new Set(watchlist.map((w) => w.tokenHex));
  return [...watchlist, ...defaultTokensForChainId(chainId).filter((d) => !seen.has(d.tokenHex))];
}