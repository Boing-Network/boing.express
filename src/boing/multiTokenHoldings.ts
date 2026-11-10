/**
 * Reference multi-token holdings for the unlocked account: exact balance-slot reads per watched
 * (contract, item id), template identity by runtime bytes, and a bounded recent-block scan that
 * finds item contracts the account received from or sent to (no durable indexer needed).
 */

import * as rpc from './rpc';
import {
  contractCodeHexFromRpc,
  decodeMultiTokenCalldata,
  decodeMultiTokenTransferLog,
  isReferenceMultiTokenBytecode,
  mtHex32,
  multiTokenAmountFromStorageWord,
  multiTokenBalanceStorageKey,
  multiTokenCallMoves,
  multiTokenMetadataStorageKey,
  multiTokenSupplyStorageKey,
  multiTokenWordFromStorage,
} from './referenceMultiToken';
import { calldataBytesFromRpc } from './referenceNft';
import {
  addMultiTokenWatchEntries,
  getMultiTokenScanCursor,
  setMultiTokenScanCursor,
  type MultiTokenWatchEntry,
} from '../storage/multiTokenWatchlist';

export const MT_DISCOVERY_SCAN_WINDOW = 256;
export const MT_DISCOVERY_MAX_CONCURRENT = 6;
export const MT_DISCOVERY_MAX_ITEMS = 64;

export interface MultiTokenHolding {
  contractHex: string;
  itemId: bigint;
  label?: string;
  balance: bigint;
  totalSupply: bigint;
  /** 64 hex, zero word when unset. */
  metadataHash: string;
  error?: string;
}

const codeCache = new Map<string, boolean>();

/** True when the contract's installed code is the pinned reference multi-token runtime (cached per session). */
export async function isReferenceMultiTokenContract(rpcUrl: string, contractHex: string): Promise<boolean> {
  const c = mtHex32(contractHex);
  const key = `${rpcUrl}|${c}`;
  const hit = codeCache.get(key);
  if (hit != null) return hit;
  try {
    const res = await rpc.rpcCall<unknown>(rpcUrl, 'boing_getContractCode', [`0x${c}`]);
    const ok = isReferenceMultiTokenBytecode(contractCodeHexFromRpc(res));
    codeCache.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}

export async function probeMultiTokenHolding(
  rpcUrl: string,
  ownerHex: string,
  entry: Pick<MultiTokenWatchEntry, 'contractHex' | 'itemId' | 'label'>
): Promise<MultiTokenHolding> {
  const contractHex = mtHex32(entry.contractHex);
  const itemId = BigInt(entry.itemId);
  try {
    const [bal, sup, meta] = await Promise.all([
      rpc.getContractStorage(rpcUrl, contractHex, multiTokenBalanceStorageKey(ownerHex, itemId)),
      rpc.getContractStorage(rpcUrl, contractHex, multiTokenSupplyStorageKey(itemId)),
      rpc.getContractStorage(rpcUrl, contractHex, multiTokenMetadataStorageKey(itemId)),
    ]);
    return {
      contractHex,
      itemId,
      label: entry.label,
      balance: multiTokenAmountFromStorageWord(bal),
      totalSupply: multiTokenAmountFromStorageWord(sup),
      metadataHash: multiTokenWordFromStorage(meta),
    };
  } catch (e) {
    return {
      contractHex,
      itemId,
      label: entry.label,
      balance: 0n,
      totalSupply: 0n,
      metadataHash: '00'.repeat(32),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function probeMultiTokenWatchlist(
  rpcUrl: string,
  ownerHex: string,
  entries: MultiTokenWatchEntry[],
  concurrency = 4
): Promise<MultiTokenHolding[]> {
  const out: MultiTokenHolding[] = new Array(entries.length);
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      out[idx] = await probeMultiTokenHolding(rpcUrl, ownerHex, entries[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), entries.length) }, () => worker()));
  return out;
}

/** Group holdings by contract (UI), keeping item order. */
export function groupMultiTokenHoldings(
  holdings: MultiTokenHolding[]
): Array<{ contractHex: string; items: MultiTokenHolding[] }> {
  const map = new Map<string, MultiTokenHolding[]>();
  for (const h of holdings) {
    const list = map.get(h.contractHex) ?? [];
    list.push(h);
    map.set(h.contractHex, list);
  }
  return [...map.entries()].map(([contractHex, items]) => ({
    contractHex,
    items: items.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
  }));
}

export interface DiscoveredMultiTokenItem {
  contractHex: string;
  itemId: bigint;
  source: 'calldata' | 'log';
}

function hexLoose(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return mtHex32(raw);
  } catch {
    return null;
  }
}

function contractCallBody(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const keys = Object.keys(p);
  if (keys.length === 1) {
    const k = keys[0]!;
    const v = p[k];
    if (k.toLowerCase() === 'contractcall' && v && typeof v === 'object') return v as Record<string, unknown>;
  }
  return typeof p.contract === 'string' ? p : null;
}

/**
 * Pure helper: candidate (contract, item) pairs touching `ownerHex` in one block JSON
 * (`boing_getBlockByHeight(h, true)`). Candidates still need the runtime-bytes check.
 */
export function discoverMultiTokenItemsFromBlock(block: unknown, ownerHex: string): DiscoveredMultiTokenItem[] {
  const owner = mtHex32(ownerHex);
  if (!block || typeof block !== 'object') return [];
  const b = block as { transactions?: unknown; receipts?: unknown };
  const txs = Array.isArray(b.transactions) ? b.transactions : [];
  const receipts = Array.isArray(b.receipts) ? b.receipts : [];
  const out: DiscoveredMultiTokenItem[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i] as Record<string, unknown> | null;
    if (!tx || typeof tx !== 'object') continue;
    const receipt = receipts[i] as Record<string, unknown> | undefined;
    if (receipt && receipt.success === false) continue;
    const body = contractCallBody(tx.payload);
    if (!body) continue;
    const contractHex = hexLoose(body.contract);
    if (!contractHex) continue;
    const sender = hexLoose(tx.sender ?? tx.from);
    const calldata = calldataBytesFromRpc(body.calldata);
    const decoded = calldata ? decodeMultiTokenCalldata(calldata) : null;
    if (decoded) {
      for (const m of multiTokenCallMoves(decoded)) {
        if (m.to === owner || (!m.isMint && sender === owner)) {
          out.push({ contractHex, itemId: m.itemId, source: 'calldata' });
        }
      }
    }
    const logs = receipt && Array.isArray(receipt.logs) ? receipt.logs : [];
    for (const raw of logs) {
      if (!raw || typeof raw !== 'object') continue;
      const log = decodeMultiTokenTransferLog(raw as { topics?: unknown[]; data?: unknown });
      if (log && (log.to === owner || log.from === owner)) {
        out.push({ contractHex, itemId: log.itemId, source: 'log' });
      }
    }
  }
  return out;
}

export interface MultiTokenDiscoveryResult {
  fromHeight: number;
  toHeight: number;
  blocksScanned: number;
  blocksFailed: number;
  candidates: number;
  persisted: number;
  error?: string;
}

/** Scan recent blocks (bounded window, resumes from the stored cursor) and watch verified items. */
export async function discoverAndPersistMultiTokens(
  rpcUrl: string,
  ownerHex: string,
  networkId: string,
  options?: { scanWindow?: number; maxConcurrent?: number; persistCursor?: boolean }
): Promise<MultiTokenDiscoveryResult> {
  const owner = mtHex32(ownerHex);
  const window = Math.max(1, options?.scanWindow ?? MT_DISCOVERY_SCAN_WINDOW);
  const concurrency = Math.max(1, options?.maxConcurrent ?? MT_DISCOVERY_MAX_CONCURRENT);
  let tip: number;
  try {
    tip = Math.max(0, Math.floor(await rpc.chainHeight(rpcUrl)));
  } catch (e) {
    return { fromHeight: 0, toHeight: 0, blocksScanned: 0, blocksFailed: 0, candidates: 0, persisted: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const cursor = await getMultiTokenScanCursor(owner, networkId);
  const fromHeight = Math.min(tip, Math.max(cursor == null ? 0 : cursor + 1, tip - window + 1));
  const heights: number[] = [];
  for (let h = fromHeight; h <= tip; h++) heights.push(h);

  const found = new Map<string, DiscoveredMultiTokenItem>();
  let scanned = 0;
  let failed = 0;
  let idx = 0;
  async function worker() {
    while (idx < heights.length) {
      const h = heights[idx++]!;
      try {
        const block = await rpc.getBlockByHeight(rpcUrl, h, true);
        if (block == null) {
          failed++;
          continue;
        }
        scanned++;
        for (const it of discoverMultiTokenItemsFromBlock(block, owner)) {
          const k = `${it.contractHex}:${it.itemId}`;
          if (!found.has(k) && found.size < MT_DISCOVERY_MAX_ITEMS) found.set(k, it);
        }
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, heights.length) }, () => worker()));

  const verified: { contractHex: string; itemId: bigint }[] = [];
  for (const it of found.values()) {
    if (await isReferenceMultiTokenContract(rpcUrl, it.contractHex)) verified.push(it);
  }
  const { added } = verified.length
    ? await addMultiTokenWatchEntries(owner, networkId, verified)
    : { added: 0 };
  if (options?.persistCursor !== false && failed === 0) await setMultiTokenScanCursor(owner, networkId, tip);
  return { fromHeight, toHeight: tip, blocksScanned: scanned, blocksFailed: failed, candidates: found.size, persisted: added };
}
