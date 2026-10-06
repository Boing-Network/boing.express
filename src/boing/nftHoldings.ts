/**
 * Resolve reference NFT ownership via `boing_getContractStorage` + owner XOR key.
 */

import type { AccountId } from './types';
import * as rpc from './rpc';
import {
  accountHexMatchesStorageOwner,
  contractStorageWordToHex64,
  isZeroStorageWordHex64,
  normalizeHex64,
  referenceNftMetadataStorageKey,
  referenceNftOwnerStorageKey,
} from './referenceNft';
import type { NftWatchEntry } from '../storage/nftWatchlist';

export interface NftHoldingStatus {
  collectionHex: string;
  tokenIdHex: string;
  label?: string;
  /** True when owner storage word equals the unlocked account. */
  owned: boolean;
  /** True when owner or metadata slot is non-zero (item exists on-chain). */
  exists: boolean;
  ownerHex: string | null;
  metadataHashHex: string | null;
  error?: string;
}

export async function probeNftHolding(
  rpcUrl: string,
  owner: AccountId,
  collectionHex: string,
  tokenIdHex: string,
  label?: string
): Promise<NftHoldingStatus> {
  const collection = normalizeHex64(collectionHex);
  const tokenId = normalizeHex64(tokenIdHex);
  const ownerKey = referenceNftOwnerStorageKey(tokenId);
  const metaKey = referenceNftMetadataStorageKey(tokenId);
  try {
    const [ownerWord, metaWord] = await Promise.all([
      rpc.getContractStorage(rpcUrl, collection, ownerKey),
      rpc.getContractStorage(rpcUrl, collection, metaKey),
    ]);
    const ownerHex = contractStorageWordToHex64(ownerWord);
    const metadataHashHex = contractStorageWordToHex64(metaWord);
    const ownerEmpty = isZeroStorageWordHex64(ownerHex);
    const metaEmpty = isZeroStorageWordHex64(metadataHashHex);
    const exists = !ownerEmpty || !metaEmpty;
    const owned = accountHexMatchesStorageOwner(owner, ownerHex);
    return {
      collectionHex: collection,
      tokenIdHex: tokenId,
      label,
      owned,
      exists,
      ownerHex: ownerEmpty ? null : ownerHex,
      metadataHashHex: metaEmpty ? null : metadataHashHex,
    };
  } catch (e) {
    return {
      collectionHex: collection,
      tokenIdHex: tokenId,
      label,
      owned: false,
      exists: false,
      ownerHex: null,
      metadataHashHex: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Probe all watchlist rows for the unlocked account (bounded concurrency). */
export async function probeNftWatchlist(
  rpcUrl: string,
  owner: AccountId,
  entries: NftWatchEntry[],
  options?: { concurrency?: number }
): Promise<NftHoldingStatus[]> {
  const concurrency = Math.min(8, Math.max(1, options?.concurrency ?? 4));
  const results: NftHoldingStatus[] = new Array(entries.length);
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      const e = entries[idx]!;
      results[idx] = await probeNftHolding(
        rpcUrl,
        owner,
        e.collectionHex,
        e.tokenIdHex,
        e.label
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
  return results;
}

export function filterOwnedHoldings(statuses: NftHoldingStatus[]): NftHoldingStatus[] {
  return statuses.filter((s) => s.owned);
}

/** Group holdings by collection for UI. */
export function groupHoldingsByCollection(
  statuses: NftHoldingStatus[]
): Array<{ collectionHex: string; items: NftHoldingStatus[] }> {
  const map = new Map<string, NftHoldingStatus[]>();
  for (const s of statuses) {
    const list = map.get(s.collectionHex) ?? [];
    list.push(s);
    map.set(s.collectionHex, list);
  }
  return [...map.entries()].map(([collectionHex, items]) => ({ collectionHex, items }));
}
