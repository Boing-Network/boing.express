import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNftWatchEntries, listNftWatchlist, removeNftWatchEntry } from '../src/storage/nftWatchlist';

const OWNER = 'aa'.repeat(32);
const NET = 'boing-testnet';
const COLLECTION = 'bb'.repeat(32);
const TOKEN = 'cc'.repeat(32);

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

describe('nftWatchlist', () => {
  it('adds unique collection+token rows and removes them', async () => {
    await addNftWatchEntries(OWNER, NET, [
      { collectionHex: COLLECTION, tokenIdHex: TOKEN },
      { collectionHex: `0x${COLLECTION}`, tokenIdHex: `0x${TOKEN}` },
    ]);
    const listed = await listNftWatchlist(OWNER, NET);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.collectionHex).toBe(COLLECTION);
    expect(listed[0]?.tokenIdHex).toBe(TOKEN);
    await removeNftWatchEntry(OWNER, NET, COLLECTION, TOKEN);
    expect(await listNftWatchlist(OWNER, NET)).toHaveLength(0);
  });
});
