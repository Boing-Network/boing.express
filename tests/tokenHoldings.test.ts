import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/boing/rpc', () => ({ listDexTokens: vi.fn(), getContractStorage: vi.fn() }));

import * as rpc from '../src/boing/rpc';
import { loadTokenHoldings } from '../src/boing/tokenHoldings';

const ME = 'aa'.repeat(32);
const T1 = '01'.repeat(32);
const T2 = '02'.repeat(32);
const T3 = '03'.repeat(32);

afterEach(() => vi.resetAllMocks());

describe('loadTokenHoldings', () => {
  it('merges watchlist + DEX directory, hides zero directory balances, keeps watched zeros', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [
        { id: `0x${T2}`, symbol: 'USDB', name: 'USD Boing', decimals: 2 },
        { id: `0x${T3}`, symbol: 'ZERO', decimals: 0 },
      ],
    });
    vi.mocked(rpc.getContractStorage).mockImplementation(async (_url, contract) => {
      if (contract === T2) return `0x${(12345).toString(16).padStart(64, '0')}`;
      return `0x${'0'.repeat(64)}`;
    });
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [{ tokenHex: T1, symbol: 'MINE', addedAt: 0 }] });
    expect(h.map((x) => [x.symbol, x.balanceDisplay, x.watched])).toEqual([
      ['MINE', '0', true],
      ['USDB', '123.45', false],
    ]);
  });
  it('survives a missing DEX directory', async () => {
    vi.mocked(rpc.listDexTokens).mockRejectedValue(new Error('Method not found'));
    vi.mocked(rpc.getContractStorage).mockRejectedValue(new Error('down'));
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [{ tokenHex: T1, addedAt: 0 }] });
    expect(h).toHaveLength(1);
    expect(h[0]!.balanceRaw).toBeNull();
    expect(h[0]!.error).toBe('down');
  });
});
