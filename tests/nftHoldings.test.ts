import { describe, expect, it, vi } from 'vitest';
import * as rpc from '../src/boing/rpc';
import { probeNftHolding } from '../src/boing/nftHoldings';
import { referenceNftOwnerStorageKey, referenceNftTokenIdWordFromU64 } from '../src/boing/referenceNft';

describe('nftHoldings', () => {
  it('marks owned when owner XOR slot equals the unlocked account', async () => {
    const owner = new Uint8Array(32).fill(0x11);
    const ownerHex = '11'.repeat(32);
    const collection = '22'.repeat(32);
    const tokenId = referenceNftTokenIdWordFromU64(1);
    vi.spyOn(rpc, 'getContractStorage').mockImplementation(async (_url, _c, key) => {
      const ownerKey = referenceNftOwnerStorageKey(tokenId);
      if (key.replace(/^0x/i, '').toLowerCase() === ownerKey) {
        return { value: `0x${ownerHex}` };
      }
      return { value: `0x${'00'.repeat(32)}` };
    });
    const status = await probeNftHolding('https://rpc.example', owner, collection, tokenId);
    expect(status.owned).toBe(true);
    expect(status.exists).toBe(true);
    expect(status.ownerHex).toBe(ownerHex);
  });
});
