import { describe, expect, it, vi } from 'vitest';
import { fetchOwnerIndexHoldings, formatOwnerIndexNote } from '../src/boing/nftOwnerIndex';

const OWNER = 'aa'.repeat(32);
const COLLECTION = 'bb'.repeat(32);
const TOKEN = 'cc'.repeat(32);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('nftOwnerIndex', () => {
  it('reports unavailable when the indexer is not configured (503)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, {
        error: 'NFT owner indexer is not configured',
        owner: `0x${OWNER}`,
        items: [],
      })
    ) as unknown as typeof fetch;

    const result = await fetchOwnerIndexHoldings('https://boing.observer', OWNER, true, { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.reason).toMatch(/not configured/i);
  });

  it('reports available with zero items when the indexer is live but empty', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        owner: `0x${OWNER}`,
        items: [],
        nextCursor: null,
        indexer: { lastCommittedHeight: 500, lastCommittedBlockHash: '0x' + '00'.repeat(32), chainId: 'boing-testnet' },
      })
    ) as unknown as typeof fetch;

    const result = await fetchOwnerIndexHoldings('https://boing.observer', OWNER, true, { fetchImpl });
    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.indexer?.lastCommittedHeight).toBe(500);
    expect(formatOwnerIndexNote(result)).toMatch(/no backfilled/i);
  });

  it('normalizes items and follows pagination to a second page', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      call++;
      expect(url).toContain('/api/account/nfts?');
      if (call === 1) {
        expect(url).not.toContain('cursor=');
        return jsonResponse(200, {
          owner: `0x${OWNER}`,
          items: [
            {
              collection: `0x${COLLECTION}`,
              tokenId: `0x${TOKEN}`,
              owner: `0x${OWNER}`,
              metadataHash: null,
              lastBlockHeight: 42,
              lastTxId: '0xabc',
              lastEventKind: 'mint_batch',
            },
          ],
          nextCursor: `${COLLECTION}:${TOKEN}`,
          indexer: { lastCommittedHeight: 1000, lastCommittedBlockHash: '0x' + '11'.repeat(32), chainId: 'boing-testnet' },
        });
      }
      expect(url).toContain(`cursor=${COLLECTION}%3A${TOKEN}`);
      return jsonResponse(200, {
        owner: `0x${OWNER}`,
        items: [],
        nextCursor: null,
        indexer: { lastCommittedHeight: 1000, lastCommittedBlockHash: '0x' + '11'.repeat(32), chainId: 'boing-testnet' },
      });
    }) as unknown as typeof fetch;

    const result = await fetchOwnerIndexHoldings('https://boing.observer/', OWNER, true, { fetchImpl });
    expect(result.available).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.collectionHex).toBe(COLLECTION);
    expect(result.items[0]?.tokenIdHex).toBe(TOKEN);
    expect(result.items[0]?.lastEventKind).toBe('mint_batch');
    const note = formatOwnerIndexNote(result, 1005);
    expect(note).toMatch(/1 item/);
    expect(note).toMatch(/lag 5/);
  });

  it('treats a network/CORS failure as unavailable instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const result = await fetchOwnerIndexHoldings('https://boing.observer', OWNER, true, { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/failed to fetch/i);
  });

  it('is unavailable when no base URL is configured', async () => {
    const result = await fetchOwnerIndexHoldings('', OWNER, true, { fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(result.available).toBe(false);
  });
});
