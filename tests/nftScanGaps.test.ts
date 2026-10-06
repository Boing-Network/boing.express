import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNftScanLastSuccessfulHeight,
  listNftScanGaps,
  pickNftScanGapHeightsToRetry,
  recordNftScanGapFailures,
  resolveNftScanGapHeights,
  setNftScanLastSuccessfulHeight,
} from '../src/storage/nftScanGaps';

const OWNER = 'aa'.repeat(32);
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

describe('nftScanGaps', () => {
  it('records new gap failures and bumps attempts on repeat failure', async () => {
    await recordNftScanGapFailures(OWNER, NET, [100, 101]);
    let gaps = await listNftScanGaps(OWNER, NET);
    expect(gaps.map((g) => g.height)).toEqual([100, 101]);
    expect(gaps.every((g) => g.attempts === 1)).toBe(true);

    await recordNftScanGapFailures(OWNER, NET, [101]);
    gaps = await listNftScanGaps(OWNER, NET);
    const h101 = gaps.find((g) => g.height === 101);
    expect(h101?.attempts).toBe(2);
    const h100 = gaps.find((g) => g.height === 100);
    expect(h100?.attempts).toBe(1);
  });

  it('resolves (removes) recovered gap heights', async () => {
    await recordNftScanGapFailures(OWNER, NET, [5, 6, 7]);
    await resolveNftScanGapHeights(OWNER, NET, [6]);
    const gaps = await listNftScanGaps(OWNER, NET);
    expect(gaps.map((g) => g.height)).toEqual([5, 7]);
  });

  it('picks least-recently-attempted gaps first for retry', async () => {
    const t0 = 1_000;
    await recordNftScanGapFailures(OWNER, NET, [1], t0);
    await recordNftScanGapFailures(OWNER, NET, [2], t0 + 10);
    await recordNftScanGapFailures(OWNER, NET, [3], t0 + 20);

    const picked = await pickNftScanGapHeightsToRetry(OWNER, NET, 2);
    expect(picked).toEqual([1, 2]);
  });

  it('persists and reads the last successful height', async () => {
    expect(await getNftScanLastSuccessfulHeight(OWNER, NET)).toBeNull();
    await setNftScanLastSuccessfulHeight(OWNER, NET, 4242);
    expect(await getNftScanLastSuccessfulHeight(OWNER, NET)).toBe(4242);
  });

  it('caps the gap list, evicting the most-attempted (likely permanently pruned) entries first', async () => {
    const staleHeights = Array.from({ length: 20 }, (_, i) => 100_000 + i);
    const freshHeights = Array.from({ length: 300 }, (_, i) => i);

    await recordNftScanGapFailures(OWNER, NET, staleHeights); // attempts=1
    await recordNftScanGapFailures(OWNER, NET, staleHeights); // attempts=2 (retried again, still failing)
    await recordNftScanGapFailures(OWNER, NET, freshHeights); // 320 total — triggers the 300 cap

    const gaps = await listNftScanGaps(OWNER, NET);
    expect(gaps.length).toBe(300);
    expect(gaps.map((g) => g.height)).toEqual(freshHeights);
    for (const h of staleHeights) {
      expect(gaps.some((g) => g.height === h)).toBe(false);
    }
  });
});
