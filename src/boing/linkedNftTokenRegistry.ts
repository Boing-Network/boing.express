/**
 * Read-only helpers for the on-chain linked NFT collection ↔ fungible token registry.
 * Authority is the registry (selectors 0xE3 links_count / 0xE4 get_link_at); skip tombstones.
 * Prefer boing-sdk encode/decode; local fallbacks match selectors until the pin is current.
 *
 * Spec: boing.network docs/BOING-LINKED-NFT-TOKEN.md
 */

import {
  CANONICAL_BOING_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX,
  decodeLinkedNftTokenGetLinkAtReturnData,
  decodeLinkedNftTokenLinksCountReturnData,
  encodeLinkedNftTokenGetLinkAtCalldataHex,
  encodeLinkedNftTokenLinksCountCalldataHex,
  LINKED_NFT_TOKEN_REGISTRY_MAX_LINKS,
} from 'boing-sdk';
import { simulateContractCall } from './rpc';
import { normalizeHex64 } from './referenceNft';

const ZERO32 = `0x${'0'.repeat(64)}`;

export const DEFAULT_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX =
  CANONICAL_BOING_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX;

export interface LinkedNftTokenLink {
  index: number;
  collectionHex: string;
  tokenHex: string;
}

export interface ListLinkedNftTokenLinksResult {
  ok: boolean;
  links: LinkedNftTokenLink[];
  count: number;
  registryId: string | null;
  error?: string;
}

function envRegistryHex(): string {
  const candidates: Array<string | undefined> = [];
  try {
    const env = import.meta.env as Record<string, string | undefined> | undefined;
    candidates.push(env?.VITE_BOING_LINKED_NFT_TOKEN_REGISTRY);
  } catch {
    /* import.meta may be unavailable in some test runners */
  }
  if (typeof process !== 'undefined') {
    candidates.push(process.env?.VITE_BOING_LINKED_NFT_TOKEN_REGISTRY);
  }
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t) return t;
  }
  return '';
}

/** Normalize to `0x` + 64 lowercase hex for registry RPC params. */
function normalizeRegistryId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  try {
    const n = normalizeHex64(hex);
    if (n === ZERO32.slice(2)) return null;
    return `0x${n}`;
  } catch {
    return null;
  }
}

/** Bare 64-hex (no 0x), matching NFT holdings `collectionHex` keys. */
function bareHex64(hex: string): string {
  return normalizeHex64(hex);
}

/**
 * Resolve registry AccountId: env override, else canonical public-testnet id when on testnet.
 */
export function resolveLinkedNftTokenRegistryId(opts: {
  networkIsTestnet?: boolean;
  explicitHex?: string | null;
} = {}): { registryId: string | null; source: 'env' | 'explicit' | 'canonical_testnet' | null } {
  const fromExplicit = normalizeRegistryId(opts.explicitHex ?? null);
  if (fromExplicit) return { registryId: fromExplicit, source: 'explicit' };

  const fromEnv = normalizeRegistryId(envRegistryHex());
  if (fromEnv) return { registryId: fromEnv, source: 'env' };

  if (opts.networkIsTestnet) {
    return {
      registryId: DEFAULT_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX.toLowerCase(),
      source: 'canonical_testnet',
    };
  }
  return { registryId: null, source: null };
}

function extractReturnData(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.success === false) return null;
  const rd = r.return_data ?? r.returnData;
  return typeof rd === 'string' && rd.length > 0 ? rd : null;
}

async function simulateReturnData(
  rpcUrl: string,
  registryId: string,
  calldataHex: string
): Promise<string> {
  const result = await simulateContractCall(rpcUrl, [registryId, calldataHex]);
  const rd = extractReturnData(result);
  if (!rd) {
    const err =
      result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
        ? String((result as { error: string }).error)
        : 'simulateContractCall returned no return_data';
    throw new Error(err);
  }
  return rd;
}

/**
 * Scan registry slots; return active (non-tombstone) links. Optionally filter by collection.
 */
export async function listLinkedNftTokenLinks(
  rpcUrl: string,
  opts: {
    networkIsTestnet?: boolean;
    registryHex?: string | null;
    filterCollectionHex?: string | null;
    maxScan?: number;
  } = {}
): Promise<ListLinkedNftTokenLinksResult> {
  const { registryId } = resolveLinkedNftTokenRegistryId({
    networkIsTestnet: opts.networkIsTestnet,
    explicitHex: opts.registryHex,
  });
  if (!registryId) {
    return {
      ok: false,
      links: [],
      count: 0,
      registryId: null,
      error: 'Linked NFT↔token registry not configured for this network',
    };
  }

  const maxScan = Math.min(
    opts.maxScan ?? LINKED_NFT_TOKEN_REGISTRY_MAX_LINKS,
    LINKED_NFT_TOKEN_REGISTRY_MAX_LINKS
  );

  try {
    const countData = await simulateReturnData(
      rpcUrl,
      registryId,
      encodeLinkedNftTokenLinksCountCalldataHex()
    );
    let count = Number(decodeLinkedNftTokenLinksCountReturnData(countData));
    if (!Number.isFinite(count) || count < 0) count = 0;
    if (count > maxScan) count = maxScan;

    const filterC = opts.filterCollectionHex ? bareHex64(opts.filterCollectionHex) : null;

    const links: LinkedNftTokenLink[] = [];
    for (let i = 0; i < count; i += 1) {
      const atData = await simulateReturnData(
        rpcUrl,
        registryId,
        encodeLinkedNftTokenGetLinkAtCalldataHex(i)
      );
      let decoded: ReturnType<typeof decodeLinkedNftTokenGetLinkAtReturnData>;
      try {
        decoded = decodeLinkedNftTokenGetLinkAtReturnData(atData);
      } catch {
        continue;
      }
      if (!decoded.active) continue;
      const collectionHex = bareHex64(decoded.collectionHex);
      const tokenHex = bareHex64(decoded.tokenHex);
      if (filterC && collectionHex !== filterC) continue;
      links.push({ index: i, collectionHex, tokenHex });
    }

    return { ok: true, links, count, registryId };
  } catch (e) {
    return {
      ok: false,
      links: [],
      count: 0,
      registryId,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Map collection AccountId → unique companion fungible token AccountIds (active links only). */
export function companionsByCollection(
  links: LinkedNftTokenLink[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const c = bareHex64(link.collectionHex);
    const t = bareHex64(link.tokenHex);
    const prev = map.get(c) ?? [];
    if (!prev.includes(t)) prev.push(t);
    map.set(c, prev);
  }
  return map;
}

/** Observer account page for a companion token AccountId (same shape as wallet account links). */
export function observerCompanionAccountUrl(
  explorerBase: string,
  accountHex64: string,
  networkIsTestnet: boolean
): string {
  const base = explorerBase.replace(/\/$/, '');
  const id = bareHex64(accountHex64);
  const network = networkIsTestnet ? 'testnet' : 'mainnet';
  return `${base}/account/${id}?network=${network}`;
}
