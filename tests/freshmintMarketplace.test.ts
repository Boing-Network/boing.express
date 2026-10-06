import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findFreshmintCollectionLink,
  freshmintCollectionsIndexUrl,
  resolveFreshmintMarketplaceBaseUrl,
} from '../src/boing/freshmintMarketplace';

const COLLECTION = 'bb'.repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('freshmintMarketplace', () => {
  it('is unset by default (feature hidden until configured)', () => {
    expect(resolveFreshmintMarketplaceBaseUrl()).toBeNull();
  });

  it('reads VITE_FRESHMINT_MARKETPLACE_URL when configured', () => {
    vi.stubEnv('VITE_FRESHMINT_MARKETPLACE_URL', 'https://freshmint.example/');
    expect(resolveFreshmintMarketplaceBaseUrl()).toBe('https://freshmint.example');
  });

  it('ignores a non-http value', () => {
    vi.stubEnv('VITE_FRESHMINT_MARKETPLACE_URL', 'not-a-url');
    expect(resolveFreshmintMarketplaceBaseUrl()).toBeNull();
  });

  it('builds the generic collections index url', () => {
    expect(freshmintCollectionsIndexUrl('https://freshmint.example/')).toBe(
      'https://freshmint.example/collections'
    );
  });

  it('matches a collection by on-chain contract address and returns a deep link', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        collections: [
          { id: 'c1', slug: 'goon-squad', chain: 'boing', contractAddress: `0x${COLLECTION}` },
          { id: 'c2', chain: 'evm', contractAddress: '0xdead' },
        ],
      }),
    })) as unknown as typeof fetch;

    const link = await findFreshmintCollectionLink('https://freshmint.example', COLLECTION, { fetchImpl });
    expect(link.matched).toBe(true);
    expect(link.url).toBe('https://freshmint.example/collections/goon-squad');
  });

  it('falls back to the generic index when no collection matches', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ collections: [] }),
    })) as unknown as typeof fetch;

    const link = await findFreshmintCollectionLink('https://freshmint.example', COLLECTION, { fetchImpl });
    expect(link.matched).toBe(false);
    expect(link.url).toBe('https://freshmint.example/collections');
  });

  it('falls back on fetch failure instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const link = await findFreshmintCollectionLink('https://freshmint.example', COLLECTION, { fetchImpl });
    expect(link.matched).toBe(false);
    expect(link.url).toBe('https://freshmint.example/collections');
  });
});
