import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NFT_DISCOVERY_SCAN_WINDOW,
  __test,
  discoverNftItemsFromBlock,
} from '../src/boing/nftDiscovery';
import { referenceNftTokenIdWordFromU64 } from '../src/boing/referenceNft';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mintBatchCalldataHex(toHex64: string, tokenIds: string[]): string {
  const n = tokenIds.length;
  const bytes = new Uint8Array(96 + 64 * n);
  bytes[31] = 0x06;
  for (let i = 0; i < 32; i++) bytes[32 + i] = parseInt(toHex64.slice(i * 2, i * 2 + 2), 16);
  bytes[95] = n;
  for (let t = 0; t < n; t++) {
    const id = tokenIds[t]!;
    for (let i = 0; i < 32; i++) bytes[96 + 32 * t + i] = parseInt(id.slice(i * 2, i * 2 + 2), 16);
  }
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function transferCalldataHex(toHex64: string, tokenIdHex64: string): string {
  const bytes = new Uint8Array(96);
  bytes[31] = 0x04;
  for (let i = 0; i < 32; i++) bytes[32 + i] = parseInt(toHex64.slice(i * 2, i * 2 + 2), 16);
  for (let i = 0; i < 32; i++) bytes[64 + i] = parseInt(tokenIdHex64.slice(i * 2, i * 2 + 2), 16);
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('nftDiscovery', () => {
  it('computes cold-start window and incremental resume within cap', () => {
    expect(__test.computeScanRange(1000, null, 256)).toEqual({
      fromHeight: 1000 - 255,
      toHeight: 1000,
    });
    expect(__test.computeScanRange(1000, 990, 256)).toEqual({
      fromHeight: 991,
      toHeight: 1000,
    });
    // Large gap: only last window
    expect(__test.computeScanRange(5000, 10, 256)).toEqual({
      fromHeight: 5000 - 255,
      toHeight: 5000,
    });
    expect(NFT_DISCOVERY_SCAN_WINDOW).toBe(256);
  });

  it('finds mint_batch and transfer_nft inbound to the owner', () => {
    const owner = 'aa'.repeat(32);
    const other = 'bb'.repeat(32);
    const collection = 'cc'.repeat(32);
    const t1 = referenceNftTokenIdWordFromU64(1);
    const t2 = referenceNftTokenIdWordFromU64(2);
    const t3 = referenceNftTokenIdWordFromU64(3);

    const block = {
      transactions: [
        {
          payload: {
            ContractCall: {
              contract: `0x${collection}`,
              calldata: mintBatchCalldataHex(owner, [t1, t2]),
            },
          },
        },
        {
          payload: {
            contract: collection,
            calldata: transferCalldataHex(owner, t3),
          },
        },
        {
          payload: {
            ContractCall: {
              contract: collection,
              calldata: transferCalldataHex(other, t1),
            },
          },
        },
      ],
      receipts: [{ success: true }, { success: true }, { success: true }],
    };

    const found = discoverNftItemsFromBlock(block, owner);
    expect(found.filter((f) => f.source === 'mint_batch')).toHaveLength(2);
    expect(found.filter((f) => f.source === 'transfer_nft')).toHaveLength(1);
    expect(found.every((f) => f.collectionHex === collection)).toBe(true);
  });

  it('skips failed receipts', () => {
    const owner = 'aa'.repeat(32);
    const collection = 'cc'.repeat(32);
    const t1 = referenceNftTokenIdWordFromU64(1);
    const block = {
      transactions: [
        {
          payload: {
            ContractCall: {
              contract: collection,
              calldata: mintBatchCalldataHex(owner, [t1]),
            },
          },
        },
      ],
      receipts: [{ success: false }],
    };
    expect(discoverNftItemsFromBlock(block, owner)).toHaveLength(0);
  });
});
