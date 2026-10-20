import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/boing/rpc', () => ({
  listDexTokens: vi.fn(),
  listDexPools: vi.fn(),
  getContractStorage: vi.fn(),
  getDexToken: vi.fn(),
  chainHeight: vi.fn(),
  getBlockByHeight: vi.fn(),
}));

vi.mock('../src/boing/fungibleDeployCandidates', () => ({
  collectFungibleDeployCandidates: vi.fn(async () => ({
    candidates: [],
    fromHeight: null,
    toHeight: null,
    scanned: 0,
  })),
}));

import * as rpc from '../src/boing/rpc';
import { clearTokenHoldingsCache, loadTokenHoldings, parseEnvTokenCandidates } from '../src/boing/tokenHoldings';
import { collectFungibleDeployCandidates } from '../src/boing/fungibleDeployCandidates';

const ME = 'aa'.repeat(32);
const T1 = '01'.repeat(32);
const T2 = '02'.repeat(32);
const T3 = '03'.repeat(32);
const T4 = '04'.repeat(32);

beforeEach(() => {
  clearTokenHoldingsCache();
  vi.mocked(rpc.listDexPools).mockResolvedValue({ pools: [], nextCursor: null });
  vi.mocked(collectFungibleDeployCandidates).mockResolvedValue({
    candidates: [],
    fromHeight: null,
    toHeight: null,
    scanned: 0,
  });
});

afterEach(() => vi.resetAllMocks());

describe('loadTokenHoldings', () => {
  it('merges watchlist + DEX directory, hides zero directory balances, keeps watched zeros', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [
        { id: `0x${T2}`, symbol: 'USDB', name: 'USD Boing', decimals: 2 },
        { id: `0x${T3}`, symbol: 'ZERO', decimals: 0 },
      ],
      nextCursor: null,
    });
    vi.mocked(rpc.getContractStorage).mockImplementation(async (_url, contract) => {
      if (contract === T2) return `0x${(12345).toString(16).padStart(64, '0')}`;
      return `0x${'0'.repeat(64)}`;
    });
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [{ tokenHex: T1, symbol: 'MINE', addedAt: 0 }],
      includeDeployScan: false,
    });
    expect(h.map((x) => [x.symbol, x.balanceDisplay, x.watched])).toEqual([
      ['MINE', '0', true],
      ['USDB', '123.45', false],
    ]);
  });

  it('paginates DEX directory pages until cap or end', async () => {
    vi.mocked(rpc.listDexTokens)
      .mockResolvedValueOnce({
        tokens: [{ id: `0x${T2}`, symbol: 'A', decimals: 0 }],
        nextCursor: `0x${T2}`,
      })
      .mockResolvedValueOnce({
        tokens: [{ id: `0x${T3}`, symbol: 'B', decimals: 0 }],
        nextCursor: null,
      });
    vi.mocked(rpc.getContractStorage).mockImplementation(async (_url, contract) => {
      if (contract === T2) return `0x${(5).toString(16).padStart(64, '0')}`;
      if (contract === T3) return `0x${(7).toString(16).padStart(64, '0')}`;
      return `0x${'0'.repeat(64)}`;
    });
    const { holdings: h, meta } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [],
      includeDeployScan: false,
      includePoolLegs: false,
    });
    expect(meta.dexTokenPages).toBe(2);
    expect(meta.dexTokenRows).toBe(2);
    expect(h.map((x) => x.symbol).sort()).toEqual(['A', 'B']);
  });

  it('includes pool leg candidates with non-zero balance', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({ tokens: [], nextCursor: null });
    vi.mocked(rpc.listDexPools).mockResolvedValue({
      pools: [{ poolHex: `0x${'ff'.repeat(32)}`, tokenAHex: `0x${T4}`, tokenBHex: `0x${T2}` }],
      nextCursor: null,
    });
    vi.mocked(rpc.getContractStorage).mockImplementation(async (_url, contract) => {
      if (contract === T4) return `0x${(9).toString(16).padStart(64, '0')}`;
      return `0x${'0'.repeat(64)}`;
    });
    const { holdings: h, meta } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [],
      includeDeployScan: false,
    });
    expect(meta.poolLegCount).toBe(2);
    expect(h).toHaveLength(1);
    expect(h[0]!.tokenHex).toBe(T4);
    expect(h[0]!.balanceDisplay).toBe('9');
  });

  it('survives a missing DEX directory', async () => {
    vi.mocked(rpc.listDexTokens).mockRejectedValue(new Error('Method not found'));
    vi.mocked(rpc.getContractStorage).mockRejectedValue(new Error('down'));
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [{ tokenHex: T1, addedAt: 0 }],
      includeDeployScan: false,
    });
    expect(h).toHaveLength(1);
    expect(h[0]!.balanceRaw).toBeNull();
    expect(h[0]!.error).toBe('down');
  });

  it('serves a short-lived cache on repeat load', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({ tokens: [], nextCursor: null });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(`0x${'0'.repeat(64)}`);
    await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [{ tokenHex: T1, symbol: 'MINE', addedAt: 0 }],
      includeDeployScan: false,
      includeDexDirectory: false,
    });
    const second = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [{ tokenHex: T1, symbol: 'MINE', addedAt: 0 }],
      includeDeployScan: false,
      includeDexDirectory: false,
    });
    expect(second.meta.fromCache).toBe(true);
    expect(vi.mocked(rpc.getContractStorage).mock.calls.length).toBe(1);
  });
});

describe('loadTokenHoldings with light directory rows', () => {
  const FV2C = '31357854f6371c8bafac0ff20296608d87db532bef06de8066d1fdd32c824b4e';
  const balanceWord = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

  beforeEach(() => {
    clearTokenHoldingsCache();
    vi.mocked(rpc.listDexPools).mockResolvedValue({ pools: [], nextCursor: null });
  });

  it('replaces placeholder labels with deploy metadata and uses the token decimals (0 for v2), not 18', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [
        {
          id: `0x${FV2C}`,
          symbol: '0x31357854…824b4e',
          name: 'Pool token 0x31357854f6',
          decimals: 0,
          metadataSource: 'abbrev',
        },
      ],
      nextCursor: null,
    });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(997766));
    vi.mocked(rpc.getDexToken).mockResolvedValue({
      id: `0x${FV2C}`,
      symbol: 'FV2C',
      name: 'FinV2Check',
      decimals: 0,
      decimalsSource: 'template',
      metadataSource: 'deploy',
    });
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [],
      includeDeployScan: false,
      includePoolLegs: false,
    });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      symbol: 'FV2C',
      name: 'FinV2Check',
      decimals: 0,
      balanceRaw: '997766',
      balanceDisplay: '997766',
    });
    expect(vi.mocked(rpc.getDexToken)).toHaveBeenCalledWith('x', [{ id: `0x${FV2C}` }]);
  });

  it('unknown decimals (null) show whole units instead of dividing by a guessed 18', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [{ id: `0x${FV2C}`, symbol: '0x31357854…824b4e', decimals: null, metadataSource: 'abbrev' }],
      nextCursor: null,
    });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(1234));
    vi.mocked(rpc.getDexToken).mockResolvedValue({
      id: `0x${FV2C}`,
      symbol: 'NEW',
      name: 'New',
      decimals: null,
      metadataSource: 'deploy',
    });
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [],
      includeDeployScan: false,
      includePoolLegs: false,
    });
    expect(h[0]).toMatchObject({ symbol: 'NEW', decimals: 0, balanceDisplay: '1234' });
  });

  it('keeps the watchlist symbol and decimals and does not hit the node for them', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({ tokens: [], nextCursor: null });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(500));
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [{ tokenHex: FV2C, symbol: 'MINE', decimals: 2, addedAt: 0 }],
      includeDeployScan: false,
      includeDexDirectory: false,
    });
    expect(h[0]).toMatchObject({ symbol: 'MINE', balanceDisplay: '5' });
    expect(vi.mocked(rpc.getDexToken)).not.toHaveBeenCalled();
  });

  it('tolerates a failing getDexToken', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [{ id: `0x${FV2C}`, symbol: '0x31357854…824b4e', metadataSource: 'abbrev' }],
      nextCursor: null,
    });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(7));
    vi.mocked(rpc.getDexToken).mockRejectedValue(new Error('down'));
    const { holdings: h } = await loadTokenHoldings({
      rpcUrl: 'x',
      ownerHex: ME,
      watchlist: [],
      includeDeployScan: false,
      includePoolLegs: false,
    });
    expect(h[0]).toMatchObject({ decimals: 0, balanceDisplay: '7' });
    expect(h[0]!.symbol).not.toContain('Pool token');
  });
});

describe('parseEnvTokenCandidates', () => {
  it('returns empty when unset', () => {
    expect(parseEnvTokenCandidates()).toEqual([]);
  });
});
