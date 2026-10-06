/**
 * Discover reference NFTs for an account by scanning recent blocks for
 * mint_batch / transfer_nft calldata (same decode model as boing.observer).
 *
 * This is a bounded RPC window — not a durable planet-scale indexer.
 */

import type { AccountId } from './types';
import { accountIdFromHex } from './types';
import * as rpc from './rpc';
import {
  calldataBytesFromRpc,
  normalizeHex64,
  parseReferenceMintBatchTokenIds,
  parseReferenceTransferNftCalldata,
  referenceNftTokenIdWordFromU64,
} from './referenceNft';
import { probeNftHolding } from './nftHoldings';
import { addNftWatchEntries, listNftWatchlist, type NftWatchEntry } from '../storage/nftWatchlist';
import { getNftScanCursor, setNftScanCursor } from '../storage/nftScanCursor';

/** Inclusive recent-block window scanned on a cold start (matches observer-ish deploy scans). */
export const NFT_DISCOVERY_SCAN_WINDOW = 256;

/** Cap parallel `boing_getBlockByHeight` calls. */
export const NFT_DISCOVERY_MAX_CONCURRENT = 6;

/** Cap new (collection, tokenId) pairs accepted from one scan pass. */
export const NFT_DISCOVERY_MAX_ITEMS = 64;

/** Sequential token ids 1..N probed per already-watched collection (opaque hash ids skip this). */
export const NFT_DISCOVERY_SEQUENTIAL_PROBE = 8;

/** Max watched collections to sequential-probe per refresh. */
export const NFT_DISCOVERY_MAX_COLLECTIONS_TO_PROBE = 6;

export interface DiscoveredNftItem {
  collectionHex: string;
  tokenIdHex: string;
  source: 'mint_batch' | 'transfer_nft' | 'sequential_probe';
}

export interface NftDiscoveryResult {
  tipHeight: number;
  fromHeight: number;
  toHeight: number;
  blocksScanned: number;
  discovered: DiscoveredNftItem[];
  /** New rows written to the watchlist this pass. */
  persistedCount: number;
  truncated: boolean;
  error?: string;
}

function unwrapTaggedPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const p = payload as Record<string, unknown>;
  const keys = Object.keys(p);
  if (keys.length === 1) {
    const key = keys[0]!;
    const val = p[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const lower = key.toLowerCase();
      if (lower === 'contractcall' || lower === 'transfer' || lower === 'bond') {
        return val as Record<string, unknown>;
      }
      // Any single-key tagged enum body
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        return val as Record<string, unknown>;
      }
    }
  }
  return p;
}

function isContractCallPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const keys = Object.keys(p);
  if (keys.length === 1 && keys[0]!.toLowerCase() === 'contractcall') return true;
  const inner = unwrapTaggedPayload(payload);
  return typeof inner.contract === 'string' || typeof inner.Contract === 'string';
}

function normalizeAccountHexLoose(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return normalizeHex64(raw);
  } catch {
    return null;
  }
}

function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  return Promise.all(Array.from({ length: n }, () => worker())).then(() => out);
}

/**
 * Pure helper: extract owner-inbound NFT items from one block JSON
 * (`boing_getBlockByHeight` with receipts).
 */
export function discoverNftItemsFromBlock(
  block: unknown,
  ownerHex64: string
): DiscoveredNftItem[] {
  const owner = ownerHex64.replace(/^0x/i, '').toLowerCase();
  if (!block || typeof block !== 'object') return [];
  const b = block as { transactions?: unknown; receipts?: unknown };
  const txs = Array.isArray(b.transactions) ? b.transactions : [];
  const receipts = Array.isArray(b.receipts) ? b.receipts : [];
  const out: DiscoveredNftItem[] = [];

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    if (!tx || typeof tx !== 'object') continue;
    const receipt = receipts[i];
    if (receipt && typeof receipt === 'object' && (receipt as { success?: unknown }).success === false) {
      continue;
    }
    const payload = (tx as { payload?: unknown }).payload;
    if (!isContractCallPayload(payload)) continue;
    const inner = unwrapTaggedPayload(payload);
    const contractRaw = inner.contract ?? inner.Contract;
    const collectionHex = normalizeAccountHexLoose(contractRaw);
    if (!collectionHex) continue;
    const calldata = calldataBytesFromRpc(inner.calldata ?? inner.Calldata);
    if (!calldata) continue;

    const mint = parseReferenceMintBatchTokenIds(calldata);
    if (mint && mint.toHex === owner) {
      for (const tokenIdHex of mint.tokenIds) {
        out.push({ collectionHex, tokenIdHex, source: 'mint_batch' });
      }
      continue;
    }

    const xfer = parseReferenceTransferNftCalldata(calldata);
    if (xfer && xfer.toHex === owner) {
      out.push({
        collectionHex,
        tokenIdHex: xfer.tokenIdHex,
        source: 'transfer_nft',
      });
    }
  }

  return out;
}

function computeScanRange(
  tipHeight: number,
  lastCursor: number | null,
  window: number
): { fromHeight: number; toHeight: number } {
  const tip = Math.max(0, Math.floor(tipHeight));
  const win = Math.max(1, window);
  if (lastCursor == null || lastCursor < 0) {
    return { fromHeight: Math.max(0, tip - win + 1), toHeight: tip };
  }
  // Resume after last cursor, but never scan more than `window` (honest catch-up bound).
  const resume = lastCursor + 1;
  const fromHeight = Math.max(resume, tip - win + 1);
  return { fromHeight: Math.min(fromHeight, tip), toHeight: tip };
}

/**
 * Scan recent blocks for mint_batch / transfer_nft to `ownerHex`, persist into watchlist,
 * and optionally sequential-probe known collections.
 */
export async function discoverAndPersistOwnedNfts(
  rpcUrl: string,
  ownerHex: string,
  networkId: string,
  options?: {
    scanWindow?: number;
    maxConcurrent?: number;
    maxItems?: number;
    sequentialProbe?: number;
    /** When false, skip writing the scan cursor (tests). Default true. */
    persistCursor?: boolean;
  }
): Promise<NftDiscoveryResult> {
  const owner = normalizeHex64(ownerHex);
  const scanWindow = options?.scanWindow ?? NFT_DISCOVERY_SCAN_WINDOW;
  const maxConcurrent = options?.maxConcurrent ?? NFT_DISCOVERY_MAX_CONCURRENT;
  const maxItems = options?.maxItems ?? NFT_DISCOVERY_MAX_ITEMS;
  const sequentialProbe = options?.sequentialProbe ?? NFT_DISCOVERY_SEQUENTIAL_PROBE;
  const persistCursor = options?.persistCursor !== false;

  let tipHeight = 0;
  try {
    tipHeight = await rpc.chainHeight(rpcUrl);
  } catch (e) {
    return {
      tipHeight: 0,
      fromHeight: 0,
      toHeight: 0,
      blocksScanned: 0,
      discovered: [],
      persistedCount: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const lastCursor = await getNftScanCursor(owner, networkId);
  const { fromHeight, toHeight } = computeScanRange(tipHeight, lastCursor, scanWindow);

  const discovered: DiscoveredNftItem[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let blocksScanned = 0;

  const heights: number[] = [];
  for (let h = fromHeight; h <= toHeight; h++) heights.push(h);

  try {
    const blocks = await mapWithConcurrency(heights, maxConcurrent, async (h) => {
      try {
        return await rpc.getBlockByHeight(rpcUrl, h, true);
      } catch {
        return null;
      }
    });

    for (const block of blocks) {
      if (block == null) continue;
      blocksScanned++;
      for (const item of discoverNftItemsFromBlock(block, owner)) {
        const id = `${item.collectionHex}:${item.tokenIdHex}`;
        if (seen.has(id)) continue;
        seen.add(id);
        discovered.push(item);
        if (discovered.length >= maxItems) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
  } catch (e) {
    return {
      tipHeight,
      fromHeight,
      toHeight,
      blocksScanned,
      discovered,
      persistedCount: 0,
      truncated,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Persist calldata-discovered items first (mint_batch / transfer_nft to this account).
  let before: NftWatchEntry[] = [];
  try {
    before = await listNftWatchlist(owner, networkId);
  } catch {
    before = [];
  }
  const beforeKeys = new Set(before.map((e) => `${e.collectionHex}:${e.tokenIdHex}`));
  const calldataFinds = discovered.map((d) => ({
    collectionHex: d.collectionHex,
    tokenIdHex: d.tokenIdHex,
  }));
  if (calldataFinds.length > 0) {
    await addNftWatchEntries(owner, networkId, calldataFinds);
  }

  // Optional: sequential probe on known collections — only persist when owner slot matches.
  if (sequentialProbe > 0 && discovered.length < maxItems) {
    let ownerAccount: AccountId;
    try {
      ownerAccount = accountIdFromHex(owner);
    } catch {
      ownerAccount = new Uint8Array(32);
    }
    const existing = await listNftWatchlist(owner, networkId);
    const collections = new Set<string>();
    for (const e of existing) collections.add(e.collectionHex);
    for (const d of discovered) collections.add(d.collectionHex);
    let probedCollections = 0;
    for (const collectionHex of collections) {
      if (probedCollections >= NFT_DISCOVERY_MAX_COLLECTIONS_TO_PROBE) break;
      probedCollections++;
      for (let id = 1; id <= sequentialProbe; id++) {
        const tokenIdHex = referenceNftTokenIdWordFromU64(id);
        const key = `${collectionHex}:${tokenIdHex}`;
        if (seen.has(key)) continue;
        const status = await probeNftHolding(rpcUrl, ownerAccount, collectionHex, tokenIdHex);
        if (!status.owned) {
          seen.add(key); // avoid re-probing empties in this pass
          continue;
        }
        seen.add(key);
        discovered.push({
          collectionHex,
          tokenIdHex,
          source: 'sequential_probe',
        });
        await addNftWatchEntries(owner, networkId, [{ collectionHex, tokenIdHex }]);
        if (discovered.length >= maxItems) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
  }

  const after = await listNftWatchlist(owner, networkId);
  const persistedCount = after.filter(
    (e) => !beforeKeys.has(`${e.collectionHex}:${e.tokenIdHex}`)
  ).length;

  if (persistCursor) {
    await setNftScanCursor(owner, networkId, tipHeight);
  }

  return {
    tipHeight,
    fromHeight,
    toHeight,
    blocksScanned,
    discovered,
    persistedCount,
    truncated,
  };
}

/** Exported for unit tests. */
export const __test = { computeScanRange, unwrapTaggedPayload, isContractCallPayload };
