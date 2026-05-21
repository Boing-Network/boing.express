import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTxHistory, getTxHistory } from '../src/storage/txHistory';

const HINT = 'abcd1234…ef567890';
const NET = 'boing-testnet';

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

describe('txHistory', () => {
  it('ignores non-string tx hashes when saving', () => {
    addTxHistory(HINT, NET, { tx_hash: 'ok' } as unknown as string, 'bond');
    expect(getTxHistory(HINT, NET)).toHaveLength(0);
  });

  it('filters corrupt entries loaded from localStorage', () => {
    const key = `boing-express-tx-history:${HINT}:${NET}`;
    localStorage.setItem(
      key,
      JSON.stringify([
        { txHash: { tx_hash: 'ok' }, type: 'bond', networkId: NET, addressHint: HINT, timestamp: 1 },
        { txHash: '0xdeadbeef', type: 'bond', networkId: NET, addressHint: HINT, timestamp: 2 },
      ])
    );
    const entries = getTxHistory(HINT, NET);
    expect(entries).toHaveLength(1);
    expect(entries[0].txHash).toBe('0xdeadbeef');
  });
});
