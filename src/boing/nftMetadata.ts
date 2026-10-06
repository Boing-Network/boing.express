/**
 * Resolve reference NFT display metadata (name / description / image)
 * the same way boing.observer does: metadata storage word → fetch URLs → JSON.
 */

import {
  contractStorageWordToHex64,
  isZeroStorageWordHex64,
  normalizeHex64,
  referenceNftMetadataStorageKey,
} from './referenceNft';
import * as rpc from './rpc';

const MAX_URL = 2048;
const IMAGE_KEYS = [
  'image',
  'image_url',
  'imageUrl',
  'imageURI',
  'imageUri',
  'logo',
  'logoURI',
  'logoUri',
  'logo_url',
  'icon',
  'icon_url',
  'animation_url',
  'picture',
] as const;

export type NftDisplayMeta = {
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  metadataUrl: string | null;
  /** True when we attempted fetch and got nothing usable (placeholder UI). */
  unresolved: boolean;
};

function ipfsUriToGateway(uri: string): string | null {
  const m = /^ipfs:\/\/(.+)$/i.exec(uri.trim());
  if (!m) return null;
  let path = m[1]!.replace(/^\/+/, '').replace(/^ipfs\//i, '');
  if (!path || path.length > MAX_URL) return null;
  return `https://ipfs.io/ipfs/${path}`;
}

export function extractHttpOrIpfsUrl(...sources: (string | null | undefined)[]): string | null {
  for (const raw of sources) {
    if (raw == null) continue;
    const text = raw.trim();
    if (!text) continue;
    const ipfsWord = /\bipfs:\/\/[^\s"'<>]+/i.exec(text);
    if (ipfsWord) {
      const g = ipfsUriToGateway(ipfsWord[0]);
      if (g && g.length <= MAX_URL) return g;
    }
    const httpsWord = /\bhttps:\/\/[^\s"'<>]{4,2048}/i.exec(text);
    if (httpsWord && httpsWord[0]!.length <= MAX_URL) return httpsWord[0]!;
    const httpWord = /\bhttp:\/\/[^\s"'<>]{4,2048}/i.exec(text);
    if (httpWord && httpWord[0]!.length <= MAX_URL) return httpWord[0]!;
  }
  return null;
}

function readMetadataImageField(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return extractHttpOrIpfsUrl(value.trim()) ?? value.trim();
}

function imageUrlFromJsonObject(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  for (const key of IMAGE_KEYS) {
    const u = readMetadataImageField(o[key]);
    if (u) {
      const g = extractHttpOrIpfsUrl(u);
      if (g) return g;
      if (/^https?:\/\//i.test(u) && u.length <= MAX_URL) return u;
    }
  }
  return null;
}

/**
 * Candidate fetch URLs for a 32-byte on-chain metadata commitment.
 * Tries embedded URI text in the word, then `ipfs.io/ipfs/{hex}`.
 */
export function metadataHashWordToFetchUrls(metadataHashHex32: string): string[] {
  let hex: string;
  try {
    hex = normalizeHex64(metadataHashHex32);
  } catch {
    return [];
  }
  if (isZeroStorageWordHex64(hex)) return [];

  const out: string[] = [];
  try {
    const bytes = Uint8Array.from(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    const ascii = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0+$/g, '').trim();
    const fromAscii = extractHttpOrIpfsUrl(ascii);
    if (fromAscii) out.push(fromAscii);
  } catch {
    /* ignore */
  }

  const ipfsPath = `https://ipfs.io/ipfs/${hex}`;
  if (!out.includes(ipfsPath)) out.push(ipfsPath);
  return out.slice(0, 4);
}

export async function fetchFirstMetadataJson(
  urls: readonly string[],
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<{ ok: true; url: string; json: unknown; imageUrl: string | null } | null> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return null;
  const timeoutMs = options?.timeoutMs ?? 6_000;

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      let imageUrl: string | null = null;
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        const o = json as Record<string, unknown>;
        imageUrl = imageUrlFromJsonObject(o);
      }
      return { ok: true, url, json, imageUrl };
    } catch {
      continue;
    }
  }
  return null;
}

function displayMetaFromJson(
  json: unknown,
  metadataUrl: string | null,
  imageUrl: string | null
): NftDisplayMeta {
  let name: string | null = null;
  let description: string | null = null;
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim()) name = o.name.trim();
    else if (typeof o.title === 'string' && o.title.trim()) name = o.title.trim();
    if (typeof o.description === 'string' && o.description.trim()) {
      description = o.description.trim();
    }
  }
  return {
    name,
    description,
    imageUrl,
    metadataUrl,
    unresolved: !name && !description && !imageUrl,
  };
}

/** Resolve display fields from an already-known metadata storage word. */
export async function resolveNftDisplayMetaFromHash(
  metadataHashHex: string | null | undefined,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<NftDisplayMeta> {
  if (!metadataHashHex || isZeroStorageWordHex64(metadataHashHex)) {
    return { name: null, description: null, imageUrl: null, metadataUrl: null, unresolved: true };
  }
  const urls = metadataHashWordToFetchUrls(metadataHashHex);
  if (urls.length === 0) {
    return { name: null, description: null, imageUrl: null, metadataUrl: null, unresolved: true };
  }
  const fetched = await fetchFirstMetadataJson(urls, options);
  if (!fetched) {
    // Last resort: treat the word itself as an embedded media URL.
    const direct = extractHttpOrIpfsUrl(
      (() => {
        try {
          const hex = normalizeHex64(metadataHashHex);
          const bytes = Uint8Array.from(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
          return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0+$/g, '');
        } catch {
          return null;
        }
      })()
    );
    return {
      name: null,
      description: null,
      imageUrl: direct,
      metadataUrl: null,
      unresolved: !direct,
    };
  }
  return displayMetaFromJson(fetched.json, fetched.url, fetched.imageUrl);
}

/**
 * Optional observer API enrichment when client-side IPFS/JSON fetch fails
 * (CORS / gateway issues). Same payload as `/api/asset/nft`.
 */
export async function fetchNftDisplayMetaFromObserverApi(
  explorerBase: string,
  collectionHex: string,
  tokenIdHex: string,
  networkIsTestnet: boolean,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<NftDisplayMeta | null> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return null;
  const base = explorerBase.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  let collection: string;
  let tokenId: string;
  try {
    collection = normalizeHex64(collectionHex);
    tokenId = normalizeHex64(tokenIdHex);
  } catch {
    return null;
  }
  const network = networkIsTestnet ? 'testnet' : 'mainnet';
  const url = `${base}/api/asset/nft?network=${network}&collection=${collection}&tokenId=${tokenId}`;
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options?.timeoutMs ?? 8_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      found?: boolean;
      imageUrl?: string | null;
      metadataUrl?: string | null;
      metadataName?: string | null;
      description?: string | null;
    };
    if (j.found !== true) return null;
    const name =
      typeof j.metadataName === 'string' && j.metadataName.trim() ? j.metadataName.trim() : null;
    const description =
      typeof j.description === 'string' && j.description.trim() ? j.description.trim() : null;
    const imageUrl =
      typeof j.imageUrl === 'string' && j.imageUrl.trim() ? j.imageUrl.trim() : null;
    const metadataUrl =
      typeof j.metadataUrl === 'string' && j.metadataUrl.trim() ? j.metadataUrl.trim() : null;
    return {
      name,
      description,
      imageUrl,
      metadataUrl,
      unresolved: !name && !description && !imageUrl,
    };
  } catch {
    return null;
  }
}

/** Load metadata hash from chain when the probe did not already provide it. */
export async function loadNftMetadataHash(
  rpcUrl: string,
  collectionHex: string,
  tokenIdHex: string
): Promise<string | null> {
  const collection = normalizeHex64(collectionHex);
  const tokenId = normalizeHex64(tokenIdHex);
  const key = referenceNftMetadataStorageKey(tokenId);
  const word = await rpc.getContractStorage(rpcUrl, collection, key);
  const hex = contractStorageWordToHex64(word);
  return isZeroStorageWordHex64(hex) ? null : hex;
}

export async function resolveNftDisplayMeta(options: {
  rpcUrl: string;
  collectionHex: string;
  tokenIdHex: string;
  metadataHashHex?: string | null;
  explorerBase?: string;
  networkIsTestnet?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<NftDisplayMeta> {
  let hash = options.metadataHashHex ?? null;
  if (!hash) {
    try {
      hash = await loadNftMetadataHash(options.rpcUrl, options.collectionHex, options.tokenIdHex);
    } catch {
      hash = null;
    }
  }

  let meta = await resolveNftDisplayMetaFromHash(hash, { fetchImpl: options.fetchImpl });
  if (!meta.unresolved) return meta;

  if (options.explorerBase) {
    const fromApi = await fetchNftDisplayMetaFromObserverApi(
      options.explorerBase,
      options.collectionHex,
      options.tokenIdHex,
      Boolean(options.networkIsTestnet),
      { fetchImpl: options.fetchImpl }
    );
    if (fromApi && !fromApi.unresolved) return fromApi;
  }

  return meta;
}

/** Bounded concurrency hydrate for a list of holdings. */
export async function hydrateNftDisplayMetaList<
  T extends { collectionHex: string; tokenIdHex: string; metadataHashHex?: string | null },
>(
  items: T[],
  options: {
    rpcUrl: string;
    explorerBase?: string;
    networkIsTestnet?: boolean;
    concurrency?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<Map<string, NftDisplayMeta>> {
  const concurrency = Math.min(6, Math.max(1, options.concurrency ?? 3));
  const out = new Map<string, NftDisplayMeta>();
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx]!;
      const key = `${item.collectionHex}:${item.tokenIdHex}`;
      try {
        out.set(
          key,
          await resolveNftDisplayMeta({
            rpcUrl: options.rpcUrl,
            collectionHex: item.collectionHex,
            tokenIdHex: item.tokenIdHex,
            metadataHashHex: item.metadataHashHex,
            explorerBase: options.explorerBase,
            networkIsTestnet: options.networkIsTestnet,
            fetchImpl: options.fetchImpl,
          })
        );
      } catch {
        out.set(key, {
          name: null,
          description: null,
          imageUrl: null,
          metadataUrl: null,
          unresolved: true,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker())
  );
  return out;
}
