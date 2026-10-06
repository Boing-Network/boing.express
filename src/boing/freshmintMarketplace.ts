/**
 * Best-effort link-out to the FreshMint marketplace (chiku524/FreshMint-Marketplace) —
 * the only marketplace/collection-listing UX for reference NFT collections today.
 * Express does not implement a marketplace backend: this module only consumes
 * FreshMint's own public `GET /api/collections` list to resolve a deep link when
 * possible, and otherwise falls back to the generic collections index.
 *
 * Hidden entirely unless an operator sets `VITE_FRESHMINT_MARKETPLACE_URL` —
 * FreshMint has no published production URL yet.
 */

import { normalizeHex64 } from './referenceNft';

export interface FreshmintCollectionLink {
  url: string;
  /** True when a specific collection (by on-chain contract address) was found. */
  matched: boolean;
}

/** Reads `VITE_FRESHMINT_MARKETPLACE_URL`; `null` when unset (feature hidden). */
export function resolveFreshmintMarketplaceBaseUrl(): string | null {
  const candidates: unknown[] = [];
  try {
    const env =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: Record<string, unknown> }).env
        : undefined;
    candidates.push(env?.VITE_FRESHMINT_MARKETPLACE_URL);
  } catch {
    /* not in a Vite context */
  }
  try {
    // Vite build-time `process.env` replacement, Node test runners, and the
    // extension service worker build may expose it here instead of import.meta.env.
    candidates.push(
      typeof process !== 'undefined' ? process.env?.VITE_FRESHMINT_MARKETPLACE_URL : undefined
    );
  } catch {
    /* no process global (browser) */
  }
  for (const raw of candidates) {
    if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) {
      return raw.trim().replace(/\/$/, '');
    }
  }
  return null;
}

/** Generic "browse collections" link — always resolvable with just the base URL. */
export function freshmintCollectionsIndexUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/collections`;
}

function addressesMatch(a: string | null, b: string): boolean {
  if (!a) return false;
  try {
    return normalizeHex64(a) === normalizeHex64(b);
  } catch {
    return false;
  }
}

function extractAddressCandidate(row: Record<string, unknown>): string | null {
  const candidates = [row.contractAddress, row.address, row.collectionAddress];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Best-effort lookup: fetch FreshMint's public collections list and find a row whose
 * on-chain contract address matches `collectionHex` (Boing chain). Never throws —
 * falls back to the generic collections index on any mismatch, timeout, or error.
 */
export async function findFreshmintCollectionLink(
  baseUrl: string,
  collectionHex: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<FreshmintCollectionLink> {
  const base = baseUrl.replace(/\/$/, '');
  const fallback: FreshmintCollectionLink = { url: freshmintCollectionsIndexUrl(base), matched: false };
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl || !/^https?:\/\//i.test(base)) return fallback;

  let normalizedCollection: string;
  try {
    normalizedCollection = normalizeHex64(collectionHex);
  } catch {
    return fallback;
  }

  try {
    const res = await fetchImpl(`${base}/api/collections`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options?.timeoutMs ?? 8_000),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as unknown;
    const rows = Array.isArray((body as { collections?: unknown })?.collections)
      ? ((body as { collections: unknown[] }).collections as unknown[])
      : Array.isArray(body)
        ? (body as unknown[])
        : [];

    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      if (typeof row.chain === 'string' && row.chain !== 'boing') continue;
      const candidate = extractAddressCandidate(row);
      if (!addressesMatch(candidate, normalizedCollection)) continue;
      const slug = typeof row.slug === 'string' && row.slug.trim() ? row.slug.trim() : null;
      const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
      const segment = slug ?? id;
      if (!segment) continue;
      return { url: `${base}/collections/${encodeURIComponent(segment)}`, matched: true };
    }
  } catch {
    /* network error / CORS / timeout — fall back below */
  }
  return fallback;
}
