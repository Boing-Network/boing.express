/**
 * Bounded recent-block scan for fungible-style contract deploys (portable subset of
 * boing.finance `nativeFungibleDeployDiscovery`). Wallet refresh only — not a full history index.
 */

import { extractUniversalContractDeploymentsFromBlock } from '@boing-network/boing-sdk';
import * as rpc from './rpc';
import { normalizeHex64 } from './referenceNft';

/** Inclusive recent-block window for fungible deploy candidates (cold / max). */
export const FUNGIBLE_DEPLOY_SCAN_WINDOW = 128;

/** Cap parallel `boing_getBlockByHeight` calls during the deploy scan. */
export const FUNGIBLE_DEPLOY_SCAN_CONCURRENCY = 4;

export interface FungibleDeployCandidate {
  tokenHex: string;
  symbol?: string;
  name?: string;
}

function isFungibleStyleDeployRow(row: Record<string, unknown>): boolean {
  const kind = row.payloadKind;
  if (kind === 'ContractDeployWithPurposeAndMetadata') {
    const pc = String(row.purposeCategory || '')
      .trim()
      .toLowerCase();
    if (pc === 'nft') return false;
    if (pc === 'token' || pc === 'meme') return true;
    if (typeof row.assetSymbol === 'string' && row.assetSymbol.trim()) return true;
    return false;
  }
  if (kind === 'ContractDeployWithPurpose') {
    const pc = String(row.purposeCategory || '')
      .trim()
      .toLowerCase();
    return pc === 'token' || pc === 'meme';
  }
  return false;
}

function deployScanEnabled(): boolean {
  try {
    const env = (import.meta as ImportMeta).env;
    const raw = (env?.VITE_BOING_FUNGIBLE_DEPLOY_SCAN ?? '1').trim().toLowerCase();
    return raw !== '0' && raw !== 'off' && raw !== 'false' && raw !== 'no';
  } catch {
    return true;
  }
}

function scanWindow(): number {
  try {
    const env = (import.meta as ImportMeta).env;
    const raw = (env?.VITE_BOING_FUNGIBLE_DEPLOY_SCAN_BLOCKS ?? '').trim();
    if (!raw) return FUNGIBLE_DEPLOY_SCAN_WINDOW;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return FUNGIBLE_DEPLOY_SCAN_WINDOW;
    return Math.min(512, Math.max(1, n));
  } catch {
    return FUNGIBLE_DEPLOY_SCAN_WINDOW;
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
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Scan tip-back `window` blocks for token/meme deploys. Best-effort: missing heights are skipped.
 */
export async function collectFungibleDeployCandidates(
  rpcUrl: string,
  options?: { tipHeight?: number; window?: number; concurrency?: number }
): Promise<{ candidates: FungibleDeployCandidate[]; fromHeight: number | null; toHeight: number | null; scanned: number }> {
  if (!deployScanEnabled()) {
    return { candidates: [], fromHeight: null, toHeight: null, scanned: 0 };
  }
  let tip = options?.tipHeight;
  if (tip == null) {
    try {
      tip = await rpc.chainHeight(rpcUrl);
    } catch {
      return { candidates: [], fromHeight: null, toHeight: null, scanned: 0 };
    }
  }
  const toH = Math.floor(tip);
  if (!Number.isFinite(toH) || toH < 0) {
    return { candidates: [], fromHeight: null, toHeight: null, scanned: 0 };
  }
  const window = options?.window ?? scanWindow();
  const fromH = Math.max(0, toH - window + 1);
  const heights: number[] = [];
  for (let h = fromH; h <= toH; h++) heights.push(h);
  const concurrency = options?.concurrency ?? FUNGIBLE_DEPLOY_SCAN_CONCURRENCY;
  const byId = new Map<string, FungibleDeployCandidate>();
  let scanned = 0;
  await mapPool(heights, concurrency, async (h) => {
    try {
      const block = await rpc.getBlockByHeight(rpcUrl, h, true);
      if (!block) return;
      scanned += 1;
      const deploys = extractUniversalContractDeploymentsFromBlock(block);
      for (const d of deploys) {
        const row = d as unknown as Record<string, unknown>;
        if (!isFungibleStyleDeployRow(row)) continue;
        let tokenHex: string;
        try {
          tokenHex = normalizeHex64(String(row.contractHex || ''));
        } catch {
          continue;
        }
        const symRaw = typeof row.assetSymbol === 'string' ? row.assetSymbol.trim() : '';
        const nmRaw = typeof row.assetName === 'string' ? row.assetName.trim() : '';
        byId.set(tokenHex, {
          tokenHex,
          symbol: symRaw ? symRaw.slice(0, 16) : undefined,
          name: nmRaw ? nmRaw.slice(0, 80) : undefined,
        });
      }
    } catch {
      // pruned / transient — skip
    }
  });
  return { candidates: [...byId.values()], fromHeight: fromH, toHeight: toH, scanned };
}
